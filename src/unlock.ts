// Unlock-cookie token: binds folder id to its stored password hash so the
// cookie cannot be forged for another folder without knowing the hash.

import { b64urlEncode } from "./crypto";

export async function hashUnlockToken(folderId: string, storedHash: string): Promise<string> {
  const data = new TextEncoder().encode(`${folderId}:${storedHash}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return b64urlEncode(digest);
}
