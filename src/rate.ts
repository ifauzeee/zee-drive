import type { AppEnv } from "./env";
import { HttpError } from "./errors";
import { hitRateLimit } from "./db";

/**
 * Fixed-window counter, atomic via a single guarded D1 upsert — no
 * read-then-write race and no KV eventual-consistency gap.
 *
 * ponytail: one D1 write per rate-checked request. On the free tier that sits
 * against 100k writes/day; if it ever measures close, skip the counter for 206
 * range streams or raise the fetch cap rather than rebuilding on KV.
 *
 * failOpen (default true): a D1 error lets the request through — availability
 * first for downloads/browsing. Password endpoints (unlock, share-unlock) pass
 * failOpen=false and stay closed on DB errors: a partial D1 failure must never
 * become an unlimited brute-force window.
 */
export async function checkRate(
  env: AppEnv,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
  failOpen = true,
): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  let allowed: boolean;
  try {
    allowed = await hitRateLimit(env.DB, scope, key, windowStart, limit);
  } catch (error) {
    if (failOpen) {
      console.error("rate limit check failed, allowing request:", error);
      return;
    }
    throw error;
  }
  if (!allowed) {
    throw new HttpError(429, "Terlalu banyak permintaan. Coba lagi sebentar.");
  }
}
