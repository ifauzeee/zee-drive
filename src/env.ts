export type AppEnv = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  SESSION_SECRET: string;
  SHARE_SECRET_KEY: string;
  ROOT_FOLDER_ID: string;
  ALLOWED_EMAILS: string;
  ADMIN_USER?: string;
  ADMIN_PASSWORD_HASH?: string;
  OAUTH_REDIRECT_URI?: string;
  CACHE_TTL_SECONDS?: string;
  APP_NAME?: string;
  CACHE?: KVNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
};

const REQUIRED = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "SESSION_SECRET",
  "SHARE_SECRET_KEY",
  "ROOT_FOLDER_ID",
  "ALLOWED_EMAILS",
] as const;

export function missingEnv(env: Partial<AppEnv>): string[] {
  const missing: string[] = REQUIRED.filter((key) => !env[key]);
  if (!env.DB) missing.push("DB (D1 binding)");
  return missing;
}

export function cacheTtl(env: AppEnv): number {
  const parsed = Number(env.CACHE_TTL_SECONDS ?? "300");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

export function allowedEmails(env: AppEnv): string[] {
  return env.ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string, env: AppEnv): boolean {
  return allowedEmails(env).includes(email.trim().toLowerCase());
}
