import type { AppEnv } from "./env";
import { isAdmin } from "./env";
import { HttpError } from "./errors";
import { signJson, verifyJson, randomId } from "./crypto";
import { getSession } from "./db";

export const SESSION_COOKIE = "zi_session";
export const STATE_COOKIE = "zi_oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// Reserved identity for guest sessions; never an admin since isAdmin() checks ALLOWED_EMAILS.
export const GUEST_EMAIL = "guest@zee.local";

export type Session = { email: string; name: string; picture?: string; iat: number; jti: string };

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`];
  if (opts.maxAge <= 0) parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  else parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function newSession(email: string, name: string, picture?: string): Session {
  return { email, name, picture, iat: Math.floor(Date.now() / 1000), jti: randomId(24) };
}

export function signSession(session: Session, secret: string): Promise<string> {
  return signJson(session, secret);
}

export async function verifySession(
  token: string | undefined,
  env: AppEnv,
): Promise<Session | null> {
  if (!token) return null;
  const session = await verifyJson<Session>(token, env.SESSION_SECRET);
  if (!session || typeof session.email !== "string" || typeof session.jti !== "string") return null;
  if (Date.now() / 1000 - session.iat > SESSION_MAX_AGE + 60) return null;
  // Stateless cookie alone is not revocable: also check the database so logout
  // really kills an old cookie, not just drop it on the client side.
  const row = await getSession(env.DB, session.jti);
  if (!row || row.revoked === 1 || row.email !== session.email) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return session;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export function buildAuthUrl(env: AppEnv, origin: string, state: string): string {
  const redirectUri = env.OAUTH_REDIRECT_URI || `${origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(
  env: AppEnv,
  code: string,
  origin: string,
): Promise<{ access_token: string }> {
  const redirectUri = env.OAUTH_REDIRECT_URI || `${origin}/auth/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new HttpError(502, "Google menolak kode login.");
  return (await response.json()) as { access_token: string };
}

export type GoogleUser = {
  email: string;
  name?: string;
  picture?: string;
  verified_email?: boolean;
};

export async function fetchUserInfo(accessToken: string): Promise<GoogleUser> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new HttpError(502, "Gagal membaca profil Google.");
  return (await response.json()) as GoogleUser;
}

export function newState(): string {
  return randomId(16);
}

export function requireAdminEmail(email: string, env: AppEnv): void {
  if (!isAdmin(email, env)) throw new HttpError(403, "Email tidak ada di daftar yang diizinkan.");
}

export function newGuestSession(): Session {
  return newSession(GUEST_EMAIL, "Tamu");
}
