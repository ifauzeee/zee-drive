import type { AppEnv } from "./env";
import { getAncestors, getMeta, isFolder } from "./drive";
import { getFolderPassword } from "./db";
import { hashUnlockToken } from "./unlock";
import { LockedError } from "./errors";

/**
 * Folder-password gate.
 * If any ancestor (or the file/folder itself) carries a password row,
 * the caller must present an unlock cookie for at least one of them.
 * Returns the file's immediate parent folder id for convenience.
 */
export async function requireUnlocked(
  env: AppEnv,
  fileId: string,
  unlockCookies: Record<string, string>,
): Promise<void> {
  const meta = await getMeta(env, fileId);
  const anchor = isFolder(meta) ? fileId : (meta.parents?.[0] ?? env.ROOT_FOLDER_ID);
  const chain = await getAncestors(env, anchor, env.ROOT_FOLDER_ID);

  for (const folderId of chain) {
    const row = await getFolderPassword(env.DB, folderId);
    if (!row || row.recursive !== 1) continue;
    const expected = await hashUnlockToken(folderId, row.hash);
    if (unlockCookies[`zi_unlock_${folderId}`] === expected) continue;
    throw new LockedError(folderId, row.folder_name || folderId);
  }
}

export function unlockCookieName(folderId: string): string {
  return `zi_unlock_${folderId}`;
}
