import { describe, expect, it } from "vitest";
import { checkRate } from "../src/rate";
import { HttpError } from "../src/errors";

function fakeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: unknown) => {
      store.set(key, String(value));
    },
  } as unknown as KVNamespace;
}

describe("checkRate", () => {
  it("is a no-op when CACHE is unbound", async () => {
    await expect(checkRate({ CACHE: undefined } as never, "s", "k", 1, 60)).resolves.toBeUndefined();
  });

  it("increments the counter while under the limit", async () => {
    const store = new Map<string, string>();
    const env = { CACHE: fakeKv(store) } as never;
    await checkRate(env, "s", "k", 2, 60);
    await checkRate(env, "s", "k", 2, 60);
    expect(store.get("rl:s:k")).toBe("2");
  });

  it("rejects once the limit is reached", async () => {
    const store = new Map<string, string>();
    const env = { CACHE: fakeKv(store) } as never;
    await checkRate(env, "s", "k", 2, 60);
    await checkRate(env, "s", "k", 2, 60);
    await expect(checkRate(env, "s", "k", 2, 60)).rejects.toBeInstanceOf(HttpError);
    await expect(checkRate(env, "s", "k", 2, 60)).rejects.toMatchObject({ status: 429 });
  });

  it("counts scopes and keys independently", async () => {
    const store = new Map<string, string>();
    const env = { CACHE: fakeKv(store) } as never;
    await checkRate(env, "a", "x", 1, 60);
    await expect(checkRate(env, "a", "y", 1, 60)).resolves.toBeUndefined();
    await expect(checkRate(env, "b", "x", 1, 60)).resolves.toBeUndefined();
    await expect(checkRate(env, "a", "x", 1, 60)).rejects.toMatchObject({ status: 429 });
  });
});