import type { Activity, ShareLink } from "./types";

export type ShareLinkRow = ShareLink;

export type FolderPasswordRow = {
  folder_id: string;
  folder_name: string;
  hash: string;
  recursive: number;
  created_by: string;
  created_at: number;
};

export type ActivityRow = Activity;

export type SessionRow = {
  jti: string;
  email: string;
  created_at: number;
  expires_at: number;
  revoked: number;
};

export async function createSession(
  db: D1Database,
  jti: string,
  email: string,
  maxAgeSeconds: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`INSERT INTO sessions (jti, email, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, 0)`)
    .bind(jti, email, now, now + maxAgeSeconds)
    .run();
}

export async function getSession(db: D1Database, jti: string): Promise<SessionRow | null> {
  return db.prepare(`SELECT * FROM sessions WHERE jti = ?`).bind(jti).first<SessionRow>();
}

export async function revokeSession(db: D1Database, jti: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE sessions SET revoked = 1 WHERE jti = ? AND revoked = 0`)
    .bind(jti)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function createShareLink(
  db: D1Database,
  row: Omit<ShareLinkRow, "uses" | "revoked">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO share_links (id, file_id, file_name, created_by, created_at, expires_at, max_uses, uses, download_only, revoked, password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
    )
    .bind(
      row.id,
      row.file_id,
      row.file_name,
      row.created_by,
      row.created_at,
      row.expires_at,
      row.max_uses,
      row.download_only,
      row.password ?? null,
    )
    .run();
}

export async function getShareLink(db: D1Database, id: string): Promise<ShareLinkRow | null> {
  return db.prepare(`SELECT * FROM share_links WHERE id = ?`).bind(id).first<ShareLinkRow>();
}

export async function touchShareLink(db: D1Database, id: string): Promise<number> {
  const result = await db
    .prepare(`UPDATE share_links SET uses = uses + 1 WHERE id = ?`)
    .bind(id)
    .run();
  return result.meta.changes ?? 0;
}

export async function listShareLinks(db: D1Database, limit = 200): Promise<ShareLinkRow[]> {
  const result = await db
    .prepare(`SELECT * FROM share_links ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<ShareLinkRow>();
  return result.results ?? [];
}

export async function revokeShareLink(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE share_links SET revoked = 1 WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function setFolderPassword(
  db: D1Database,
  row: FolderPasswordRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO folder_passwords (folder_id, folder_name, hash, recursive, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(folder_id) DO UPDATE SET
         folder_name = excluded.folder_name,
         hash = excluded.hash,
         recursive = excluded.recursive,
         created_by = excluded.created_by,
         created_at = excluded.created_at`,
    )
    .bind(row.folder_id, row.folder_name, row.hash, row.recursive, row.created_by, row.created_at)
    .run();
}

export async function getFolderPassword(
  db: D1Database,
  folderId: string,
): Promise<FolderPasswordRow | null> {
  return db
    .prepare(`SELECT * FROM folder_passwords WHERE folder_id = ?`)
    .bind(folderId)
    .first<FolderPasswordRow>();
}

export async function listFolderPasswords(db: D1Database): Promise<FolderPasswordRow[]> {
  const result = await db
    .prepare(`SELECT * FROM folder_passwords ORDER BY created_at DESC`)
    .all<FolderPasswordRow>();
  return result.results ?? [];
}

export async function removeFolderPassword(db: D1Database, folderId: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM folder_passwords WHERE folder_id = ?`)
    .bind(folderId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

export async function logActivity(
  db: D1Database,
  entry: { actor: string; action: string; file_id?: string | null; detail?: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO activity_log (ts, actor, action, file_id, detail) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      Math.floor(Date.now() / 1000),
      entry.actor,
      entry.action,
      entry.file_id ?? null,
      entry.detail ?? null,
    )
    .run();
}

export async function listActivity(db: D1Database, limit = 100): Promise<ActivityRow[]> {
  const result = await db
    .prepare(`SELECT * FROM activity_log ORDER BY ts DESC, id DESC LIMIT ?`)
    .bind(limit)
    .all<ActivityRow>();
  return result.results ?? [];
}

/** Cron maintenance: drop dead/expired/used-up share links. */
export async function pruneShareLinks(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM share_links
       WHERE revoked = 1
          OR (expires_at IS NOT NULL AND expires_at < ?)
          OR (max_uses IS NOT NULL AND uses >= max_uses)`,
    )
    .bind(Math.floor(Date.now() / 1000))
    .run();
  return result.meta.changes ?? 0;
}

/** Cron maintenance: drop semua sesi yang sudah dicabut atau kedaluwarsa. */
export async function pruneSessions(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM sessions WHERE revoked = 1 OR expires_at < ?`)
    .bind(Math.floor(Date.now() / 1000))
    .run();
  return result.meta.changes ?? 0;
}

/** Cron maintenance: drop activity log older than maxAgeSeconds. */
export async function pruneActivity(db: D1Database, maxAgeSeconds: number): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM activity_log WHERE ts < ?`)
    .bind(Math.floor(Date.now() / 1000) - maxAgeSeconds)
    .run();
  return result.meta.changes ?? 0;
}
