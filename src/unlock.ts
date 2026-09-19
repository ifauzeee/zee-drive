// Unlock-cookie token: binds folder id to its stored password hash so the
// cookie cannot be forged for another folder without knowing the hash.

export async function hashUnlockToken(folderId: string, storedHash: string): Promise<string> {
  const data = new TextEncoder().encode(`${folderId}:${storedHash}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let binary = "";
  for (let i = 0; i < digest.length; i++) binary += String.fromCharCode(digest[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
