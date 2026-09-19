import type { AppEnv } from "./env";
import { HttpError } from "./errors";

/** Fixed-window counter in KV. No-op when CACHE is unbound. */
export async function checkRate(
  env: AppEnv,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  if (!env.CACHE) return;
  const kvKey = `rl:${scope}:${key}`;
  const raw = await env.CACHE.get(kvKey);
  const count = raw ? Number(raw) : 0;
  if (count >= limit) {
    throw new HttpError(429, "Terlalu banyak permintaan. Coba lagi sebentar.");
  }
  await env.CACHE.put(kvKey, String(count + 1), { expirationTtl: windowSeconds });
}
