import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import * as db from "../src/db";
import * as drive from "../src/drive";
import { hashPassword, signJson } from "../src/crypto";
import { hashUnlockToken } from "../src/unlock";
import { newSession } from "../src/auth";
import type { AppEnv } from "../src/env";

vi.mock("../src/db", async () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  createShareLink: vi.fn().mockResolvedValue(undefined),
  getFolderPassword: vi.fn().mockResolvedValue(null),
  getSession: vi.fn(),
  getShareLink: vi.fn().mockResolvedValue(null),
  getSetting: vi.fn().mockResolvedValue(null),
  hitRateLimit: vi.fn().mockResolvedValue(true),
  listActivity: vi.fn().mockResolvedValue([]),
  listFolderPasswords: vi.fn().mockResolvedValue([]),
  listShareLinks: vi.fn().mockResolvedValue([]),
  logActivity: vi.fn().mockResolvedValue(undefined),
  pruneActivity: vi.fn().mockResolvedValue(0),
  pruneRateLimits: vi.fn().mockResolvedValue(0),
  pruneSessions: vi.fn().mockResolvedValue(0),
  pruneShareLinks: vi.fn().mockResolvedValue(0),
  removeFolderPassword: vi.fn().mockResolvedValue(false),
  revokeSession: vi.fn().mockResolvedValue(true),
  revokeShareLink: vi.fn().mockResolvedValue(false),
  setFolderPassword: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  touchShareLink: vi.fn().mockResolvedValue(1),
}));

vi.mock("../src/drive", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/drive")>();
  return {
    FOLDER_MIME: real.FOLDER_MIME,
    getAccessToken: vi.fn().mockResolvedValue("token"),
    getAncestors: vi.fn().mockResolvedValue(["root"]),
    getBreadcrumb: vi.fn().mockResolvedValue([]),
    getMeta: vi.fn().mockResolvedValue({
      id: "root",
      name: "Home",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
    }),
    getStorageQuota: vi.fn().mockResolvedValue({}),
    isFolder: real.isFolder,
    listFolder: vi.fn().mockResolvedValue({ files: [], truncated: false }),
    proxyFile: vi.fn().mockResolvedValue(new Response("bytes", { status: 200 })),
    searchDrive: vi.fn().mockResolvedValue([]),
  };
});

const getSetting = vi.mocked(db.getSetting);
const getFolderPassword = vi.mocked(db.getFolderPassword);
const getSession = vi.mocked(db.getSession);
const getShareLink = vi.mocked(db.getShareLink);
const hitRateLimit = vi.mocked(db.hitRateLimit);
const getAncestors = vi.mocked(drive.getAncestors);
const getBreadcrumb = vi.mocked(drive.getBreadcrumb);
const getMeta = vi.mocked(drive.getMeta);
const listFolder = vi.mocked(drive.listFolder);
const logActivity = vi.mocked(db.logActivity);

const DEFAULT_META = {
  id: "root",
  name: "Home",
  mimeType: "application/vnd.google-apps.folder",
  parents: [],
};

const SECRETS = {
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csec",
  GOOGLE_REFRESH_TOKEN: "refresh",
  SESSION_SECRET: "session-secret",
  SHARE_SECRET_KEY: "share-secret",
  ROOT_FOLDER_ID: "root",
  ALLOWED_EMAILS: "admin@example.com",
  DB: {},
} as const;

const ADMIN_DB = "admin@example.com";

function env(over: Record<string, unknown> = {}): AppEnv {
  return { ...SECRETS, ASSETS: {}, ...over } as never;
}

function get(path: string, over: Record<string, unknown> = {}, init: RequestInit = {}) {
  const fetcher = worker.fetch!;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  return fetcher(new Request(`http://localhost${path}`, init) as never, env(over), ctx as never);
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function cookieFor(email: string, name: string, e = env()) {
  const token = await signJson(newSession(email, name), e.SESSION_SECRET);
  return `zi_session=${token}`;
}

function shareRow(id: string, over: Record<string, unknown>) {
  return {
    id,
    file_id: "f",
    file_name: "f",
    created_by: ADMIN_DB,
    created_at: 0,
    expires_at: null,
    max_uses: null,
    uses: 0,
    download_only: 0,
    revoked: 0,
    password: null,
    ...over,
  };
}

// The session actor defaults to admin; tests override it per scenario.
let activeSessionEmail = ADMIN_DB;

beforeEach(() => {
  vi.clearAllMocks();
  getSetting.mockResolvedValue(null);
  getFolderPassword.mockResolvedValue(null);
  // Reset the once-queue too: a test that queues mockResolvedValueOnce but never
  // reaches getShareLink (e.g. an invalid-token 410) would otherwise leak that
  // value into the next test that does call it.
  getShareLink.mockReset();
  getShareLink.mockResolvedValue(null);
  hitRateLimit.mockReset();
  hitRateLimit.mockResolvedValue(true);
  getSession.mockImplementation(async (_db: D1Database, jti: string) => ({
    jti,
    email: activeSessionEmail,
    created_at: 0,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    revoked: 0,
  }));
  getBreadcrumb.mockResolvedValue([]);
  getAncestors.mockResolvedValue(["root"]);
  getMeta.mockResolvedValue(DEFAULT_META);
  listFolder.mockResolvedValue({ files: [], truncated: false });
  activeSessionEmail = ADMIN_DB;
});

describe("missing env guard", () => {
  it("answers 500 on /api/* before calling any handler", async () => {
    const res = await get("/api/config", { GOOGLE_CLIENT_ID: undefined });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Konfigurasi server belum lengkap"),
    });
  });

  it("does not leak internal env var names to client", async () => {
    const res = await get("/api/config", { GOOGLE_CLIENT_ID: undefined });
    const body = await res.json();
    // Should not expose which exact vars are missing in production
    expect(JSON.stringify(body)).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(JSON.stringify(body)).not.toContain("SESSION_SECRET");
    expect(JSON.stringify(body)).not.toContain("SHARE_SECRET_KEY");
  });
});

describe("public config", () => {
  it("returns app name + guest disabled by default", async () => {
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ appName: "Zee-Drive", guestLogin: false });
  });

  it("enables guest login only when explicitly set to 1", async () => {
    getSetting.mockResolvedValueOnce("0").mockResolvedValueOnce("1");
    const res = await get("/api/config");
    expect(await res.json()).toMatchObject({ guestLogin: true });
  });
});

describe("session", () => {
  it("reports user null without a cookie", async () => {
    const res = await get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it("recognizes an active session", async () => {
    const cookie = await cookieFor(ADMIN_DB, "Admin");
    const res = await get("/api/auth/me", {}, { headers: { cookie } });
    expect(await res.json()).toMatchObject({
      user: { email: ADMIN_DB, admin: true },
    });
  });

  it("treats a revoked session as logged out", async () => {
    const cookie = await cookieFor(ADMIN_DB, "Admin");
    getSession.mockResolvedValueOnce({
      jti: "x",
      email: ADMIN_DB,
      created_at: 0,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      revoked: 1,
    });
    const res = await get("/api/auth/me", {}, { headers: { cookie } });
    expect(await res.json()).toEqual({ user: null });
  });

  it("rejects sessions missing from the database", async () => {
    const cookie = await cookieFor(ADMIN_DB, "Admin");
    getSession.mockResolvedValueOnce(null);
    const res = await get("/api/files", {}, { headers: { cookie } });
    expect(res.status).toBe(401);
  });

  it("revokes the session row on logout", async () => {
    const cookie = await cookieFor(ADMIN_DB, "Admin");
    const res = await get("/logout", {}, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(302);
    expect(db.revokeSession).toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: ADMIN_DB, action: "logout" }),
    );
  });

  it("registers a session row for guest logins", async () => {
    getSetting.mockResolvedValue("1");
    const res = await get("/auth/guest");
    expect(res.status).toBe(302);
    expect(db.createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "guest@zee.local",
      expect.any(Number),
    );
  });

  it("blocks guest login by default without an explicit setting", async () => {
    const res = await get("/auth/guest");
    expect(res.status).toBe(403);
    expect(db.createSession).not.toHaveBeenCalled();
  });

  it("sets the session cookie with SameSite=Strict", async () => {
    getSetting.mockResolvedValue("1");
    const res = await get("/auth/guest");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Strict");
  });

  it("keeps the oauth state cookie SameSite=Lax", async () => {
    const res = await get("/auth/login");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
  });
});

describe("local admin login", () => {
  const adminHash = () => hashPassword("zee343212");

  function post(body: unknown, over: Record<string, unknown> = {}) {
    return get("/auth/admin", over, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects when local admin is not configured", async () => {
    const res = await post({ username: "zee", password: "zee343212" });
    expect(res.status).toBe(404);
  });

  it("rejects wrong credentials with 401", async () => {
    const res = await post(
      { username: "zee", password: "salah" },
      { ADMIN_USER: "zee", ADMIN_PASSWORD_HASH: await adminHash() },
    );
    expect(res.status).toBe(401);
    expect(db.createSession).not.toHaveBeenCalled();
  });

  it("rejects when the username does not match", async () => {
    const res = await post(
      { username: "admin", password: "zee343212" },
      { ADMIN_USER: "zee", ADMIN_PASSWORD_HASH: await adminHash() },
    );
    expect(res.status).toBe(401);
  });

  it("logs in as the first allowed email and sets a Strict cookie", async () => {
    const res = await post(
      { username: "zee", password: "zee343212" },
      { ADMIN_USER: "zee", ADMIN_PASSWORD_HASH: await adminHash() },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(db.createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      ADMIN_DB,
      expect.any(Number),
    );
    expect(db.logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: ADMIN_DB, action: "login.local" }),
    );
  });

  it("rate limits per IP and fails closed on limiter errors", async () => {
    const creds = { ADMIN_USER: "zee", ADMIN_PASSWORD_HASH: await adminHash() };
    hitRateLimit.mockResolvedValueOnce(false);
    const limited = await post({ username: "zee", password: "zee343212" }, creds);
    expect(limited.status).toBe(429);

    hitRateLimit.mockRejectedValueOnce(new Error("db down"));
    const failed = await post({ username: "zee", password: "zee343212" }, creds);
    expect(failed.status).toBe(500);
    expect(db.createSession).not.toHaveBeenCalled();
  });
});

describe("maintenance mode", () => {
  it("blocks non-admin requests with 503", async () => {
    getSetting.mockResolvedValue("1");
    const res = await get("/api/files");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("pemeliharaan") });
  });

  it("blocks guest sessions too", async () => {
    getSetting.mockResolvedValue("1");
    const res = await get("/api/files", {}, { headers: { cookie: await cookieFor("guest@zee.local", "Tamu") } });
    expect(res.status).toBe(503);
  });

  it("lets admin sessions through", async () => {
    getSetting.mockResolvedValue("1");
    const res = await get("/api/files", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [], crumbs: [], truncated: false });
  });
});

describe("activity logging on file access", () => {
  it("logs a download with the session actor", async () => {
    const cookie = await cookieFor(ADMIN_DB, "Admin");
    const res = await get("/d/F1", {}, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: ADMIN_DB, action: "download", file_id: "F1" }),
    );
  });

  it("logs a preview with action preview", async () => {
    const cookie = await cookieFor(ADMIN_DB, "Admin");
    const res = await get("/p/F1", {}, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: ADMIN_DB, action: "preview", file_id: "F1" }),
    );
  });

  it("logs public share downloads under share:<sid>", async () => {
    getShareLink.mockResolvedValueOnce(shareRow("s1", { file_id: "F1" }));
    const token = await signJson({ sid: "s1", fid: "F1" }, SECRETS.SHARE_SECRET_KEY);
    const res = await get(`/s/${token}`);
    expect(res.status).toBe(200);
    expect(logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: "share:s1", action: "share.download", file_id: "F1" }),
    );
  });

  it("does not log partial-range previews", async () => {
    vi.mocked(drive.proxyFile).mockResolvedValueOnce(new Response("bytes", { status: 206 }));
    const res = await get("/p/F1", {}, {
      headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("rejects a client past the per-IP fetch cap", async () => {
    hitRateLimit.mockResolvedValueOnce(false);
    const res = await get("/d/F1", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(429);
  });

  it("fails open and serves downloads when the limiter errors", async () => {
    hitRateLimit.mockRejectedValueOnce(new Error("db down"));
    const res = await get("/d/F1", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
  });

  it("rejects an unlock attempt past the cap", async () => {
    hitRateLimit.mockResolvedValueOnce(false);
    const res = await get("/api/folder/unlock", {}, {
      method: "POST",
      headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), "content-type": "application/json" },
      body: JSON.stringify({ folderId: "PROT", password: "salah" }),
    });
    expect(res.status).toBe(429);
  });

  it("fails closed on unlock when the limiter errors", async () => {
    hitRateLimit.mockRejectedValueOnce(new Error("db down"));
    const res = await get("/api/folder/unlock", {}, {
      method: "POST",
      headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), "content-type": "application/json" },
      body: JSON.stringify({ folderId: "PROT", password: "salah" }),
    });
    expect(res.status).toBe(500);
  });
});

describe("root boundary", () => {
  it("denies access to folders outside ROOT_FOLDER_ID", async () => {
    getAncestors.mockResolvedValueOnce(["OUT"]);
    const res = await get("/api/files?folder=OUT", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(404);
  });

  it("denies meta lookup for files outside the root tree", async () => {
    getAncestors.mockResolvedValueOnce(["OUT"]);
    const res = await get("/api/meta/OUTID", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Berkas tidak ditemukan." });
  });

  it("keeps files inside the root tree reachable", async () => {
    getAncestors.mockResolvedValueOnce(["root"]);
    const res = await get("/api/files?folder=root", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
  });
});

describe("folder unlock", () => {
  async function lockedRow() {
    return {
      folder_id: "PROT",
      folder_name: "Prot",
      hash: await hashPassword("benar"),
      recursive: 1,
      created_by: ADMIN_DB,
      created_at: 0,
    };
  }

  it("rejects a wrong password", async () => {
    getFolderPassword.mockResolvedValue(await lockedRow());
    const res = await get(
      "/api/folder/unlock",
      {},
      {
        method: "POST",
        headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), "content-type": "application/json" },
        body: JSON.stringify({ folderId: "PROT", password: "salah" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("sets an unlock cookie for the right password", async () => {
    getFolderPassword.mockResolvedValue(await lockedRow());
    const res = await get(
      "/api/folder/unlock",
      {},
      {
        method: "POST",
        headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), "content-type": "application/json" },
        body: JSON.stringify({ folderId: "PROT", password: "benar" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("zi_unlock_PROT=");
  });

  it("locks folder content without the unlock cookie", async () => {
    getAncestors.mockResolvedValue(["root", "PROT"]);
    getFolderPassword.mockImplementation(async (_, folderId) =>
      folderId === "PROT" ? await lockedRow() : null,
    );
    const res = await get("/api/files?folder=PROT", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(423);
    const body = await json(res);
    expect(body.locked).toBe(true);
    expect(body.folderId).toBe("PROT");
  });
});

describe("share links", () => {
  describe("max_uses counter behavior", () => {
    it("increments uses only on full download (200), not on range requests (206)", async () => {
      const ckv = { get: vi.fn().mockResolvedValue("0"), put: vi.fn(), delete: vi.fn(), list: vi.fn() };

      const token = await signJson({ sid: "s_max_test", fid: "f_for_max" }, SECRETS.SHARE_SECRET_KEY);

      // Valid, non-expired, under-cap share row for every lookup in this test.
      getShareLink.mockResolvedValue(shareRow("s_max_test", { file_id: "f_for_max", max_uses: 3, uses: 0 }));
      // clearAllMocks() in beforeEach wipes the default impl; restore it.
      vi.mocked(db.touchShareLink).mockResolvedValue(1);
      const proxyFile = vi.mocked(drive.proxyFile);

      // Full download (200) -> increments once.
      proxyFile.mockResolvedValueOnce(new Response("bytes", { status: 200 }));
      const full = await get(`/s/${token}`, env({ CACHE: ckv }));
      expect(full.status).toBe(200);
      expect(db.touchShareLink).toHaveBeenCalledTimes(1);

      vi.mocked(db.touchShareLink).mockClear();

      // Range requests (206) -> never increment, no matter how many segments.
      for (const range of ["bytes=0-99", "bytes=100-199", "bytes=200-299"]) {
        proxyFile.mockResolvedValueOnce(new Response("partial", { status: 206 }));
        const partial = await get(`/s/${token}`, env({ CACHE: ckv }), { headers: { range } });
        expect(partial.status).toBe(206);
      }
      expect(db.touchShareLink).not.toHaveBeenCalled();
    });
  });

  it("rejects an expired token with 410", async () => {
    const token = await signJson(
      { sid: "s1", fid: "f1", exp: Math.floor(Date.now() / 1000) - 10 },
      SECRETS.SHARE_SECRET_KEY,
    );
    getShareLink.mockResolvedValue(
      shareRow("s1", { file_id: "f1", expires_at: Math.floor(Date.now() / 1000) - 10 }),
    );
    const res = await get(`/api/s/${token}`);
    expect(res.status).toBe(410);
  });

  it("rejects a revoked link with 410", async () => {
    const token = await signJson({ sid: "s2", fid: "f2" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(shareRow("s2", { file_id: "f2", revoked: 1 }));
    const res = await get(`/api/s/${token}`);
    expect(res.status).toBe(410);
  });

  it("serves metadata for a valid link", async () => {
    const token = await signJson({ sid: "s3", fid: "f3" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(shareRow("s3", { file_id: "f3" }));
    getMeta.mockResolvedValue({ id: "f3", name: "file.pdf", mimeType: "application/pdf", parents: [] });
    const res = await get(`/api/s/${token}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.file).toMatchObject({ name: "file.pdf" });
    expect(body.downloadOnly).toBe(false);
  });
});

describe("share password", () => {
  async function protectedRow() {
    return shareRow("s4", { file_id: "f4", password: await hashPassword("rahasia") });
  }

  it("blocks metadata until unlocked", async () => {
    const token = await signJson({ sid: "s4", fid: "f4" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(await protectedRow());
    const res = await get(`/api/s/${token}`);
    expect(res.status).toBe(403);
  });

  it("sets an unlock cookie for the right share password", async () => {
    const token = await signJson({ sid: "s4", fid: "f4" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(await protectedRow());
    const res = await get(`/api/s/${token}/unlock`, {}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "rahasia" }),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("zi_share_pw_s4=");
  });

  it("serves metadata with the unlock cookie", async () => {
    const token = await signJson({ sid: "s4", fid: "f4" }, SECRETS.SHARE_SECRET_KEY);
    const row = await protectedRow();
    getShareLink.mockResolvedValue(row);
    getMeta.mockResolvedValue({ id: "f4", name: "semester.pdf", mimeType: "application/pdf", parents: [] });
    const cookie = `zi_share_pw_s4=${await hashUnlockToken("s4", row.password!)}`;
    const res = await get(`/api/s/${token}`, {}, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.file).toMatchObject({ name: "semester.pdf" });
  });
});

describe("folder share", () => {
  it("reports kind folder in metadata", async () => {
    const token = await signJson({ sid: "s5", fid: "fdir" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(shareRow("s5", { file_id: "fdir", file_name: "Kuliah" }));
    getMeta.mockResolvedValue({ id: "fdir", name: "Kuliah", mimeType: "application/vnd.google-apps.folder", parents: [] });
    const res = await get(`/api/s/${token}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.kind).toBe("folder");
    expect(body.folder).toMatchObject({ name: "Kuliah" });
  });

  it("lists files inside the shared tree", async () => {
    const token = await signJson({ sid: "s5", fid: "fdir" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(shareRow("s5", { file_id: "fdir", file_name: "Kuliah" }));
    getBreadcrumb.mockResolvedValue([{ id: "fdir", name: "Kuliah" }]);
    listFolder.mockResolvedValue({
      files: [{ id: "c1", name: "catatan.txt", mimeType: "text/plain" }],
      truncated: false,
    });
    const res = await get(`/api/s/${token}/files`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.files).toHaveLength(1);
    expect(body.rootId).toBe("fdir");
  });

  it("rejects requests outside the shared tree", async () => {
    const token = await signJson({ sid: "s5", fid: "fdir" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(shareRow("s5", { file_id: "fdir", file_name: "Kuliah" }));
    getBreadcrumb.mockResolvedValue([{ id: "lain", name: "Lain" }]);
    const res = await get(`/api/s/${token}/files`);
    expect(res.status).toBe(404);
  });

  it("unlocks a password-protected folder through the pub share token", async () => {
    const token = await signJson({ sid: "s6", fid: "fdir" }, SECRETS.SHARE_SECRET_KEY);
    getShareLink.mockResolvedValue(shareRow("s6", { file_id: "fdir" }));
    const fp = { folder_id: "PROT", folder_name: "Prot", hash: await hashPassword("benar"), recursive: 1, created_by: ADMIN_DB, created_at: 0 };
    getFolderPassword.mockResolvedValue(fp);
    const res = await get(`/api/s/${token}/unlock`, {}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "benar", folderId: "PROT" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("zi_unlock_PROT=");
  });
});

describe("search", () => {
  it("needs at least 2 characters", async () => {
    const res = await get("/api/search?q=a", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(400);
  });

  it("returns search result shape", async () => {
    const res = await get("/api/search?q=api", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ results: [] });
  });
});

describe("admin activity csv", () => {
  it("exports a csv attachment", async () => {
    const res = await get("/api/admin/activity?format=csv", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("waktu,aktor,aksi,file,detail");
  });

  it("neutralizes spreadsheet formula injection in cells", async () => {
    vi.mocked(db.listActivity).mockResolvedValue([
      { id: 1, ts: 0, actor: "=HYPERLINK(\"https://evil\")", action: "download", file_id: "=cmd", detail: "+x" },
    ]);
    const res = await get("/api/admin/activity?format=csv", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'=cmd");
    expect(text).toContain("'+x");
  });
});

describe("folder refresh", () => {
  it("busts the folder list and meta cache for any session", async () => {
    activeSessionEmail = "guest@zee.local";
    const cacheDelete = vi.fn();
    const ckv = {
      get: vi.fn(),
      put: vi.fn(),
      delete: cacheDelete,
      list: vi.fn().mockResolvedValue({
        keys: [{ name: "search:root:pdf" }, { name: "search:root:buku" }],
      }),
    };
    const res = await get("/api/files/refresh", env({ CACHE: ckv }), {
      method: "POST",
      headers: { cookie: await cookieFor("guest@zee.local", "Tamu"), "content-type": "application/json" },
      body: JSON.stringify({ folderId: "root" }),
    });
    expect(res.status).toBe(200);
    expect(cacheDelete).toHaveBeenCalledWith("list2:root");
    expect(cacheDelete).toHaveBeenCalledWith("meta:root");
    expect(ckv.list).toHaveBeenCalledWith({ prefix: "search:" });
    expect(cacheDelete).toHaveBeenCalledWith("search:root:pdf");
    expect(cacheDelete).toHaveBeenCalledWith("search:root:buku");
  });

  it("rejects unauthenticated callers", async () => {
    const res = await get("/api/files/refresh", {}, {
      method: "POST",
      body: JSON.stringify({ folderId: "root" }),
    });
    expect(res.status).toBe(401);
  });

  it("requires a folderId", async () => {
    const res = await get("/api/files/refresh", {}, {
      method: "POST",
      headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rate limits per IP", async () => {
    activeSessionEmail = "guest@zee.local";
    hitRateLimit.mockResolvedValueOnce(false);
    const res = await get("/api/files/refresh", {}, {
      method: "POST",
      headers: { cookie: await cookieFor("guest@zee.local", "Tamu"), "content-type": "application/json" },
      body: JSON.stringify({ folderId: "root" }),
    });
    expect(res.status).toBe(429);
  });
});

describe("quota", () => {
  it("serves live storage usage for a session", async () => {
    vi.mocked(drive.getStorageQuota).mockResolvedValueOnce({ limit: "10", usage: "5" });
    const res = await get("/api/quota", {}, { headers: { cookie: await cookieFor(ADMIN_DB, "Admin") } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ limit: 10, usage: 5, percent: 0.5 });
  });

  it("rejects anonymous visitors", async () => {
    const res = await get("/api/quota");
    expect(res.status).toBe(401);
  });
});

describe("upload", () => {
  function stubDriveUploadFetch() {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("upload/drive/v3/files")) {
        return new Response(null, { status: 200, headers: { location: "https://up.example/s" } });
      }
      return new Response(JSON.stringify({ id: "f1", name: "a.txt" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  function adminInit(over: { cookie?: string } = {}): { body: FormData; init: RequestInit } {
    const fd = new FormData();
    fd.append("file", new File(["halo"], "a.txt", { type: "text/plain" }));
    return { body: fd, init: { method: "POST", headers: { cookie: over.cookie ?? "" }, body: fd } };
  }

  it("rejects guests", async () => {
    const res = await get("/api/upload?folder=root", {}, { method: "POST", body: new FormData() });
    expect(res.status).toBe(401);
  });

  it("rejects requests beyond the declared size cap", async () => {
    const fd = new FormData();
    fd.append("file", new File(["halo"], "a.txt", { type: "text/plain" }));
    const res = await get("/api/upload?folder=root", {}, {
      method: "POST",
      headers: { cookie: await cookieFor(ADMIN_DB, "Admin"), "content-length": "1000000000000" },
      body: fd,
    });
    expect(res.status).toBe(413);
  });

  it("rejects uploads into password-protected folders", async () => {
    getFolderPassword.mockResolvedValue({
      folder_id: "root", folder_name: "Secret", hash: "h", recursive: 1,
      created_by: ADMIN_DB, created_at: 0,
    });
    const { init } = adminInit({ cookie: await cookieFor(ADMIN_DB, "Admin") });
    const res = await get("/api/upload?folder=root", {}, init);
    expect(res.status).toBe(423);
  });

  it("rejects uploads when the destination is not a folder", async () => {
    getMeta.mockResolvedValue({ ...DEFAULT_META, mimeType: "text/plain" });
    const { init } = adminInit({ cookie: await cookieFor(ADMIN_DB, "Admin") });
    const res = await get("/api/upload?folder=root", {}, init);
    expect(res.status).toBe(400);
  });

  it("uploads as admin, busts the folder cache and logs the action", async () => {
    stubDriveUploadFetch();
    const cacheDelete = vi.fn();
    const ckv = { get: vi.fn(), put: vi.fn(), delete: cacheDelete, list: vi.fn() };
    const fd = new FormData();
    fd.append("file", new File(["halo"], "a.txt", { type: "text/plain" }));
    const res = await get("/api/upload?folder=root", env({ CACHE: ckv }), {
      method: "POST",
      headers: { cookie: await cookieFor(ADMIN_DB, "Admin") },
      body: fd,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ file: { id: "f1", name: "a.txt" } });
    expect(cacheDelete).toHaveBeenCalledWith("list2:root");
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "upload" }));
    vi.unstubAllGlobals();
  });
});