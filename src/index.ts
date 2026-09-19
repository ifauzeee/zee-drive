import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Context } from "hono";
import type { AppEnv } from "./env";
import { isAdmin, missingEnv } from "./env";
import { HttpError, LockedError } from "./errors";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_MAX_AGE,
  GUEST_EMAIL,
  newGuestSession,
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
  newSession,
  newState,
  parseCookies,
  requireAdminEmail,
  serializeCookie,
  signSession,
  verifySession,
  type Session,
} from "./auth";
import {
  getAccessToken,
  getBreadcrumb,
  getMeta,
  getStorageQuota,
  isFolder,
  listFolder,
  proxyFile,
  searchDrive,
} from "./drive";
import {
  createShareLink,
  getFolderPassword,
  getShareLink,
  getSetting,
  listActivity,
  listFolderPasswords,
  listShareLinks,
  logActivity,
  pruneActivity,
  pruneShareLinks,
  removeFolderPassword,
  revokeShareLink,
  setFolderPassword,
  setSetting,
  touchShareLink,
  type ShareLinkRow,
} from "./db";
import { hashPassword, signJson, verifyJson, verifyPassword } from "./crypto";
import { isShareExpired, newShareId, type ShareClaims } from "./share";
import { requireUnlocked, unlockCookieName } from "./guard";
import { hashUnlockToken } from "./unlock";
import { checkRate } from "./rate";

type Vars = { session: Session };
type AppContext = Context<{ Bindings: AppEnv; Variables: Vars }>;

const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();

app.use("*", logger());

// Keep the app off mobile browsers until the responsive pass is done. The
// standalone pages (share links) are asset-free, and admins pass through. Public
// share paths (/share/, /api/s/*, and /s/* bytes) stay open: those are
// self-contained pages that must work on phones, not part of the main app.
const MOBILE_UA = /(Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini)/i;
const MOBILE_OPEN_PATHS = /^\/(share\/|api\/s\/|s\/)/;
app.use("*", async (c, next) => {
  const ua = c.req.header("user-agent") ?? "";
  if (!MOBILE_UA.test(ua)) return next();
  const path = new URL(c.req.url).pathname;
  if (MOBILE_OPEN_PATHS.test(path)) return next();
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const admin = !!cookies[SESSION_COOKIE] &&
    isAdmin((await verifySession(cookies[SESSION_COOKIE], c.env.SESSION_SECRET))?.email ?? "", c.env);
  if (admin) return next();
  return new Response(mobileMaintenanceHtml, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

const mobileMaintenanceHtml = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Zee-Drive — Under maintenance</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; padding: 32px;
    background: #0b0d10; color: #f1f2f4;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .mark {
    width: 72px; height: 72px; margin-bottom: 28px;
    background: #e8a33d;
    -webkit-mask: url("/Zee-Index-Logo.png") no-repeat center / contain;
            mask: url("/Zee-Index-Logo.png") no-repeat center / contain;
  }
  h1 { margin: 0; font-size: 26px; font-weight: 650; letter-spacing: -.02em; }
  p { margin: 14px 0 0; max-width: 30ch; font-size: 15px; line-height: 1.6; color: #9aa1ab; }
</style>
</head>
<body>
  <div class="mark" aria-hidden="true"></div>
  <h1>Zee-Drive</h1>
  <p>Versi mobile sedang dirapikan. Buka lewat perangkat desktop (laptop / PC) beberapa saat lagi.</p>
</body>
</html>`;

/* ---------- helpers ---------- */

function clientIp(c: AppContext): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
}

function secureOrigin(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function cookieOpts(c: AppContext) {
  return {
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    secure: secureOrigin(c.req.url),
    sameSite: "Lax",
  } as const;
}

function errorJson(c: AppContext, error: unknown) {
  if (error instanceof LockedError) {
    return c.json(
      { error: error.message, locked: true, folderId: error.folderId, folderName: error.folderName },
      423,
    );
  }
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status as 400);
  }
  console.error(error);
  return c.json({ error: "Kesalahan server." }, 500);
}

// JSON routes always answer JSON.
app.onError((error, c) => errorJson(c, error));

// Env sanity check for API routes only (assets must always serve).
app.use("/api/*", async (c, next) => {
  const missing = missingEnv(c.env as Partial<AppEnv>);
  if (missing.length > 0) {
    return c.json({ error: `Konfigurasi belum lengkap: ${missing.join(", ")}` }, 500);
  }
  if (await maintenanceActive(c.env) && !(await canBypassMaintenance(c))) {
    return c.json({ error: "Sedang pemeliharaan. Coba lagi nanti." }, 503);
  }
  await next();
});

async function maintenanceActive(env: AppEnv): Promise<boolean> {
  return (await getSetting(env.DB, "maintenance")) === "1";
}

async function canBypassMaintenance(c: AppContext): Promise<boolean> {
  // /api/auth/me stays open so the SPA can still render session state.
  if (new URL(c.req.url).pathname === "/api/auth/me") return true;
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const session = await verifySession(cookies[SESSION_COOKIE], c.env.SESSION_SECRET);
  return !!session && isAdmin(session.email, c.env);
}

/* ---------- public config ---------- */

app.get("/api/config", async (c) => {
  const guestSetting = await getSetting(c.env.DB, "guest");
  return c.json({
    appName: c.env.APP_NAME || "Zee-Drive",
    rootFolderId: c.env.ROOT_FOLDER_ID,
    guestLogin: guestSetting !== "0",
  });
});

/* ---------- auth ---------- */

app.get("/auth/login", (c) => {
  const origin = new URL(c.req.url).origin;
  const state = newState();
  const url = buildAuthUrl(c.env, origin, state);
  const headers = new Headers({ location: url, "cache-control": "no-store" });
  headers.append(
    "set-cookie",
    serializeCookie(STATE_COOKIE, state, { ...cookieOpts(c), maxAge: 600 }),
  );
  return new Response(null, { status: 302, headers });
});

async function finishLogin(c: AppContext): Promise<Response> {
  const origin = new URL(c.req.url).origin;
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookies = parseCookies(c.req.header("cookie") ?? null);

  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  headers.append(
    "set-cookie",
    serializeCookie(STATE_COOKIE, "", { ...cookieOpts(c), maxAge: 0 }),
  );

  if (!code || !state || state !== cookies[STATE_COOKIE]) {
    return new Response("Login tidak valid.", { status: 400, headers });
  }

  try {
    const { access_token } = await exchangeCode(c.env, code, origin);
    const user = await fetchUserInfo(access_token);
    if (user.verified_email === false) {
      return new Response("Email Google belum diverifikasi.", { status: 403, headers });
    }
    requireAdminEmail(user.email, c.env);
    const token = await signSession(
      newSession(user.email, user.name || user.email, user.picture),
      c.env.SESSION_SECRET,
    );
    headers.append("set-cookie", serializeCookie(SESSION_COOKIE, token, cookieOpts(c)));
    await logActivity(c.env.DB, { actor: user.email, action: "login" });
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Login gagal.";
    return new Response(message, { status: 500, headers });
  }
}

app.get("/auth/callback", (c) => finishLogin(c));

// Guest login: browse + download everything, no admin capabilities.
app.get("/auth/guest", async (c) => {
  const guestSetting = await getSetting(c.env.DB, "guest");
  if (guestSetting === "0") {
    return new Response("Login tamu dinonaktifkan oleh admin.", { status: 403 });
  }
  const token = await signSession(newGuestSession(), c.env.SESSION_SECRET);
  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  headers.append("set-cookie", serializeCookie(SESSION_COOKIE, token, cookieOpts(c)));
  await logActivity(c.env.DB, { actor: GUEST_EMAIL, action: "login.guest" });
  return new Response(null, { status: 302, headers });
});

app.get("/logout", (c) => {
  const headers = new Headers({ location: "/login", "cache-control": "no-store" });
  headers.append(
    "set-cookie",
    serializeCookie(SESSION_COOKIE, "", { ...cookieOpts(c), maxAge: 0 }),
  );
  return new Response(null, { status: 302, headers });
});

app.get("/api/auth/me", async (c) => {
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const session = await verifySession(cookies[SESSION_COOKIE], c.env.SESSION_SECRET);
  if (!session) return c.json({ user: null });
  return c.json({
    user: {
      email: session.email,
      name: session.name,
      picture: session.picture,
      admin: isAdmin(session.email, c.env),
    },
  });
});

const requireSession = async (c: AppContext, next: () => Promise<void>) => {
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const session = await verifySession(cookies[SESSION_COOKIE], c.env.SESSION_SECRET);
  if (!session) return c.json({ error: "Login diperlukan." }, 401);
  c.set("session", session);
  await next();
};

const requireAdmin = async (c: AppContext, next: () => Promise<void>) => {
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const session = await verifySession(cookies[SESSION_COOKIE], c.env.SESSION_SECRET);
  if (!session) return c.json({ error: "Login diperlukan." }, 401);
  try {
    requireAdminEmail(session.email, c.env);
  } catch {
    return c.json({ error: "Akses admin diperlukan." }, 403);
  }
  c.set("session", session);
  await next();
};

/* ---------- browse API ---------- */

app.get("/api/files", requireSession, async (c) => {
  try {
    const folderId = c.req.query("folder") || c.env.ROOT_FOLDER_ID;
    await requireUnlocked(c.env, folderId, parseCookies(c.req.header("cookie") ?? null));
    const [files, crumbs] = await Promise.all([
      listFolder(c.env, folderId),
      getBreadcrumb(c.env, folderId, c.env.ROOT_FOLDER_ID),
    ]);
    return c.json({ files, crumbs });
  } catch (error) {
    return errorJson(c, error);
  }
});

app.get("/api/search", requireSession, async (c) => {
  try {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2 || q.length > 80) {
      return c.json({ error: "Kata kunci minimal 2 karakter." }, 400);
    }
    await checkRate(c.env, "search", clientIp(c), 30, 60);
    const cookies = parseCookies(c.req.header("cookie") ?? null);
    const found = await searchDrive(c.env, q, c.env.ROOT_FOLDER_ID);
    // Jangan bocorkan isi folder terkunci yang belum dibuka.
    const results = [];
    for (const hit of found) {
      let locked = false;
      for (const folderId of hit.crumbs.map((crumb) => crumb.id)) {
        const row = await getFolderPassword(c.env.DB, folderId);
        if (!row || row.recursive !== 1) continue;
        const expected = await hashUnlockToken(folderId, row.hash);
        if (cookies[unlockCookieName(folderId)] !== expected) {
          locked = true;
          break;
        }
      }
      if (!locked) results.push(hit);
    }
    return c.json({ results });
  } catch (error) {
    return errorJson(c, error);
  }
});

app.get("/api/meta/:id", requireSession, async (c) => {
  try {
    const fileId = c.req.param("id") ?? "";
    await requireUnlocked(c.env, fileId, parseCookies(c.req.header("cookie") ?? null));
    return c.json({ file: await getMeta(c.env, fileId) });
  } catch (error) {
    return errorJson(c, error);
  }
});

app.post("/api/folder/unlock", requireSession, async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as {
      folderId?: string;
      password?: string;
    } | null;
    if (!body?.folderId || typeof body.password !== "string") {
      return c.json({ error: "folderId dan password diperlukan." }, 400);
    }
    await checkRate(c.env, "unlock", `${clientIp(c)}:${body.folderId}`, 10, 600);
    const row = await getFolderPassword(c.env.DB, body.folderId);
    if (!row) return c.json({ error: "Folder tidak dilindungi." }, 404);
    const ok = await verifyPassword(body.password, row.hash);
    if (!ok) return c.json({ error: "Kata sandi salah." }, 403);
    const token = await hashUnlockToken(body.folderId, row.hash);
    c.header(
      "set-cookie",
      serializeCookie(unlockCookieName(body.folderId), token, {
        ...cookieOpts(c),
        maxAge: 60 * 60 * 24,
      }),
    );
    return c.json({ ok: true });
  } catch (error) {
    return errorJson(c, error);
  }
});

/* ---------- download / preview (session-gated, unlock-checked) ---------- */

async function serveFile(c: AppContext, inline: boolean) {
  try {
    const fileId = c.req.param("id") ?? "";
    await requireUnlocked(c.env, fileId, parseCookies(c.req.header("cookie") ?? null));
    return await proxyFile(c.env, fileId, {
      inline,
      range: c.req.header("range") ?? null,
    });
  } catch (error) {
    return errorJson(c, error);
  }
}

// Download without a session only via share links (see /s/:token).
app.get("/d/:id", requireSession, (c) => serveFile(c, false));
app.get("/p/:id", requireSession, (c) => serveFile(c, true));

/* ---------- share links ---------- */

function sharePwCookie(sid: string): string {
  return `zi_share_pw_${sid}`;
}

async function sharePasswordOk(c: AppContext, row: ShareLinkRow): Promise<boolean> {
  if (!row.password) return true;
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const expected = await hashUnlockToken(row.id, row.password);
  return cookies[sharePwCookie(row.id)] === expected;
}

app.post("/api/share", requireAdmin, async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as {
      fileId?: string;
      expiresInHours?: number | null;
      maxUses?: number | null;
      downloadOnly?: boolean;
      password?: string | null;
    } | null;
    if (!body?.fileId) return c.json({ error: "fileId diperlukan." }, 400);
    if (
      body.password !== undefined &&
      body.password !== null &&
      body.password !== "" &&
      body.password.length < 4
    ) {
      return c.json({ error: "Kata sandi minimal 4 karakter." }, 400);
    }

    const meta = await getMeta(c.env, body.fileId);
    const isDir = isFolder(meta);

    const now = Math.floor(Date.now() / 1000);
    const expiresAt =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? now + Math.floor(body.expiresInHours * 3600)
        : null;
    const maxUses =
      typeof body.maxUses === "number" && body.maxUses > 0 ? Math.floor(body.maxUses) : null;
    const id = newShareId();
    const password =
      typeof body.password === "string" && body.password !== ""
        ? await hashPassword(body.password)
        : null;

    await createShareLink(c.env.DB, {
      id,
      file_id: meta.id,
      file_name: meta.name,
      created_by: c.get("session").email,
      created_at: now,
      expires_at: expiresAt,
      max_uses: maxUses,
      download_only: isDir ? 0 : body.downloadOnly === true ? 1 : 0,
      password,
    });

    const token = await signJson(
      { sid: id, fid: meta.id, dl: body.downloadOnly === true ? 1 : undefined, exp: expiresAt ?? undefined },
      c.env.SHARE_SECRET_KEY,
    );
    await logActivity(c.env.DB, {
      actor: c.get("session").email,
      action: "share.create",
      file_id: meta.id,
      detail: id,
    });
    return c.json({ id, token, url: `/share/${token}` });
  } catch (error) {
    return errorJson(c, error);
  }
});

app.get("/api/share", requireAdmin, async (c) => {
  const links = await listShareLinks(c.env.DB);
  return c.json({ links });
});

app.post("/api/share/revoke", requireAdmin, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return c.json({ error: "id diperlukan." }, 400);
  const ok = await revokeShareLink(c.env.DB, body.id);
  if (ok) {
    await logActivity(c.env.DB, {
      actor: c.get("session").email,
      action: "share.revoke",
      detail: body.id,
    });
  }
  return c.json({ ok });
});

async function resolveShare(c: AppContext, token: string) {
  const claims = await verifyJson<ShareClaims>(token, c.env.SHARE_SECRET_KEY);
  if (!claims || typeof claims.sid !== "string" || typeof claims.fid !== "string") {
    throw new HttpError(410, "Share link tidak valid.");
  }
  if (isShareExpired(claims)) throw new HttpError(410, "Share link kedaluwarsa.");
  const row = await getShareLink(c.env.DB, claims.sid);
  if (!row || row.revoked === 1 || row.file_id !== claims.fid) {
    throw new HttpError(410, "Share link tidak valid.");
  }
  if (row.expires_at !== null && Date.now() / 1000 > row.expires_at) {
    throw new HttpError(410, "Share link kedaluwarsa.");
  }
  if (row.max_uses !== null && row.uses >= row.max_uses) {
    throw new HttpError(410, "Batas unduhan share link tercapai.");
  }
  return { claims, row };
}

async function publicShareGate(c: AppContext, row: ShareLinkRow): Promise<void> {
  if (!(await sharePasswordOk(c, row))) {
    throw new HttpError(403, "Share link dilindungi kata sandi.");
  }
}

// Public: share metadata — file atau folder.
app.get("/api/s/:token", async (c) => {
  try {
    await checkRate(c.env, "share-meta", clientIp(c), 30, 60);
    const { row } = await resolveShare(c, c.req.param("token") ?? "");
    await publicShareGate(c, row);
    const meta = await getMeta(c.env, row.file_id);
    if (isFolder(meta)) {
      return c.json({ folder: meta, downloadOnly: false, kind: "folder" });
    }
    return c.json({ file: meta, downloadOnly: row.download_only === 1, kind: "file" });
  } catch (error) {
    return errorJson(c, error);
  }
});

// Public: unlock — kata sandi share (default) atau kata sandi folder (body.folderId).
app.post("/api/s/:token/unlock", async (c) => {
  try {
    await checkRate(c.env, "share-unlock", `${clientIp(c)}:${c.req.param("token")}`, 10, 300);
    const { row } = await resolveShare(c, c.req.param("token") ?? "");
    const body = (await c.req.json().catch(() => null)) as {
      password?: string;
      folderId?: string;
    } | null;
    if (!body || typeof body.password !== "string") {
      return c.json({ error: "Kata sandi diperlukan." }, 400);
    }
    if (body.folderId) {
      const fp = await getFolderPassword(c.env.DB, body.folderId);
      if (!fp) return c.json({ error: "Folder tidak dilindungi." }, 404);
      if (!(await verifyPassword(body.password, fp.hash))) {
        return c.json({ error: "Kata sandi salah." }, 403);
      }
      const token = await hashUnlockToken(body.folderId, fp.hash);
      c.header(
        "set-cookie",
        serializeCookie(unlockCookieName(body.folderId), token, { ...cookieOpts(c), maxAge: 86400 }),
      );
      return c.json({ ok: true });
    }
    if (!row.password) return c.json({ error: "Share link tidak dilindungi kata sandi." }, 400);
    if (!(await verifyPassword(body.password, row.password))) {
      return c.json({ error: "Kata sandi salah." }, 403);
    }
    const token = await hashUnlockToken(row.id, row.password);
    c.header(
      "set-cookie",
      serializeCookie(sharePwCookie(row.id), token, { ...cookieOpts(c), maxAge: 86400 }),
    );
    return c.json({ ok: true });
  } catch (error) {
    return errorJson(c, error);
  }
});

// Public: daftar isi folder di dalam folder share.
app.get("/api/s/:token/files", async (c) => {
  try {
    await checkRate(c.env, "share-files", `${clientIp(c)}:${c.req.param("token")}`, 30, 60);
    const { row } = await resolveShare(c, c.req.param("token") ?? "");
    await publicShareGate(c, row);
    const folder = c.req.query("folder") || row.file_id;
    const crumbs = await getBreadcrumb(c.env, folder, row.file_id);
    if (!crumbs.some((crumb) => crumb.id === row.file_id)) {
      throw new HttpError(404, "Folder di luar jangkauan share link.");
    }
    await requireUnlocked(c.env, folder, parseCookies(c.req.header("cookie") ?? null));
    const files = await listFolder(c.env, folder);
    return c.json({ files, crumbs, rootId: row.file_id, rootName: row.file_name });
  } catch (error) {
    return errorJson(c, error);
  }
});

// Public: byte file. Tanpa ?id token harus share file; dengan ?id file di dalam folder share.
app.get("/s/:token", async (c) => {
  try {
    await checkRate(c.env, "share-dl", `${clientIp(c)}:${c.req.param("token")}`, 10, 60);
    const { row } = await resolveShare(c, c.req.param("token") ?? "");
    await publicShareGate(c, row);
    const target = c.req.query("id");
    let fileId = row.file_id;
    if (target) {
      const crumbs = await getBreadcrumb(c.env, target, row.file_id);
      if (!crumbs.some((crumb) => crumb.id === row.file_id)) {
        throw new HttpError(404, "File di luar jangkauan share link.");
      }
      fileId = target;
    }
    await requireUnlocked(c.env, fileId, parseCookies(c.req.header("cookie") ?? null));
    await touchShareLink(c.env.DB, row.id);
    const inline = c.req.query("dl") === "1" ? false : row.download_only !== 1;
    return await proxyFile(c.env, fileId, {
      inline,
      range: c.req.header("range") ?? null,
    });
  } catch (error) {
    return errorJson(c, error);
  }
});

/* ---------- admin: folder passwords ---------- */

app.get("/api/admin/passwords", requireAdmin, async (c) => {
  const rows = await listFolderPasswords(c.env.DB);
  return c.json({
    passwords: rows.map((r) => ({
      folderId: r.folder_id,
      folderName: r.folder_name,
      recursive: r.recursive === 1,
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
  });
});

app.post("/api/admin/passwords", requireAdmin, async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as {
      folderId?: string;
      password?: string;
      recursive?: boolean;
    } | null;
    if (!body?.folderId || typeof body.password !== "string" || body.password.length < 4) {
      return c.json({ error: "folderId dan password (min 4 karakter) diperlukan." }, 400);
    }
    const meta = await getMeta(c.env, body.folderId);
    if (!isFolder(meta)) return c.json({ error: "Hanya folder yang bisa dilindungi." }, 400);
    await setFolderPassword(c.env.DB, {
      folder_id: meta.id,
      folder_name: meta.name,
      hash: await hashPassword(body.password),
      recursive: body.recursive === false ? 0 : 1,
      created_by: c.get("session").email,
      created_at: Math.floor(Date.now() / 1000),
    });
    await logActivity(c.env.DB, {
      actor: c.get("session").email,
      action: "folder.password.set",
      file_id: meta.id,
    });
    // Warm the access-token path while we are here.
    await getAccessToken(c.env).catch(() => null);
    return c.json({ ok: true });
  } catch (error) {
    return errorJson(c, error);
  }
});

app.post("/api/admin/passwords/remove", requireAdmin, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { folderId?: string } | null;
  if (!body?.folderId) return c.json({ error: "folderId diperlukan." }, 400);
  const ok = await removeFolderPassword(c.env.DB, body.folderId);
  if (ok) {
    await logActivity(c.env.DB, {
      actor: c.get("session").email,
      action: "folder.password.remove",
      file_id: body.folderId,
    });
  }
  return c.json({ ok });
});

/* ---------- admin: storage + config + activity ---------- */

app.get("/api/quota", requireSession, async (c) => {
  const key = `quota:${c.env.ROOT_FOLDER_ID}`;
  if (c.env.CACHE) {
    const cached = await c.env.CACHE.get<{ limit: number; usage: number; percent: number }>(key, "json");
    if (cached) return c.json(cached);
  }
  try {
    const quota = await getStorageQuota(c.env);
    const limit = Number(quota.limit || 0);
    const usage = Number(quota.usage || quota.usageInDrive || 0);
    const payload = { limit, usage, percent: limit > 0 ? usage / limit : 0 };
    if (c.env.CACHE) await c.env.CACHE.put(key, JSON.stringify(payload), { expirationTtl: 120 });
    return c.json(payload);
  } catch (error) {
    return errorJson(c, error);
  }
});

app.get("/api/admin/storage", requireAdmin, async (c) => {
  try {
    const quota = await getStorageQuota(c.env);
    const limit = Number(quota.limit || 0);
    const usage = Number(quota.usage || quota.usageInDrive || 0);
    return c.json({
      limit,
      usage,
      usageInDrive: Number(quota.usageInDrive || 0),
      percent: limit > 0 ? usage / limit : 0,
    });
  } catch (error) {
    return errorJson(c, error);
  }
});

app.get("/api/admin/config", requireAdmin, async (c) => {
  const [maintenance, guest] = await Promise.all([
    getSetting(c.env.DB, "maintenance"),
    getSetting(c.env.DB, "guest"),
  ]);
  return c.json({
    config: {
      appName: c.env.APP_NAME || "Zee-Drive",
      rootFolderId: c.env.ROOT_FOLDER_ID,
      cacheTtl: Number(c.env.CACHE_TTL_SECONDS ?? "300"),
      maintenance: maintenance === "1",
      guest: guest !== "0",
    },
  });
});

app.post("/api/admin/config", requireAdmin, async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    maintenance?: boolean;
    guest?: boolean;
  } | null;
  if (!body) return c.json({ error: "Body tidak valid." }, 400);
  if (typeof body.maintenance === "boolean") {
    await setSetting(c.env.DB, "maintenance", body.maintenance ? "1" : "0");
  }
  if (typeof body.guest === "boolean") {
    await setSetting(c.env.DB, "guest", body.guest ? "1" : "0");
  }
  await logActivity(c.env.DB, { actor: c.get("session").email, action: "config.update" });
  return c.json({ ok: true });
});

app.get("/api/admin/activity", requireAdmin, async (c) => {
  if (c.req.query("format") === "csv") {
    const rows = await listActivity(c.env.DB, 1000);
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      ["waktu", "aktor", "aksi", "file", "detail"],
      ...rows.map((r) => [r.ts, r.actor, r.action, r.file_id ?? "", r.detail ?? ""]),
    ]
      .map((row) => row.map(esc).join(","))
      .join("\r\n");
    return new Response(`${csv}\r\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return c.json({ activity: await listActivity(c.env.DB) });
});

/* ---------- static SPA fallback ---------- */

// Serve the built SPA for all non-API, non-auth, non-share routes.
app.get("*", async (c) => {
  const url = new URL(c.req.url);
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/d/") ||
    url.pathname.startsWith("/p/") ||
    url.pathname.startsWith("/s/")
  ) {
    return c.json({ error: "Tidak ditemukan." }, 404);
  }
  const asset = await c.env.ASSETS.fetch(new Request(`${url.origin}/index.html`));
  const headers = new Headers(asset.headers);
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https://lh3.googleusercontent.com https://drive.google.com; " +
      "media-src 'self' blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; " +
      "frame-ancestors 'none'; base-uri 'self'",
  );
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(asset.body, { status: asset.status, headers });
});

/* ---------- scheduled cron: D1 maintenance ---------- */

async function scheduled(_event: unknown, env: AppEnv) {
  const shareLinks = await pruneShareLinks(env.DB);
  const activity = await pruneActivity(env.DB, 90 * 24 * 3600);
  console.log(`scheduled cleanup: ${shareLinks} share links, ${activity} activity rows`);
}

const worker: ExportedHandler<AppEnv> = {
  fetch: (req, env, ctx) => app.fetch(req, env, ctx),
  scheduled,
};

export default worker;
