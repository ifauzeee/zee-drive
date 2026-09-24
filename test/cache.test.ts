import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMeta, listFolder } from "../src/drive";
import type { AppEnv } from "../src/env";

function fakeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (key: string, type?: "text" | "json") => {
      const v = store.get(key) ?? null;
      if (type === "json") return v ? JSON.parse(v) : null;
      return v;
    },
    put: async (key: string, value: unknown) => {
      store.set(key, String(value));
    },
  } as unknown as KVNamespace;
}

function stubDriveFetch() {
  const hit: string[] = [];
  let files = 0;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    hit.push(url);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/files/")) {
      return new Response(
        JSON.stringify({ id: "F1", name: "f.txt", mimeType: "text/plain", parents: ["P"] }),
        { status: 200 },
      );
    }
    files++;
    return new Response(
      JSON.stringify({ files: [{ id: `f${files}`, name: `f${files}` }] }),
      { status: 200 },
    );
  });
  return hit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

let hit: string[];
let store: Map<string, string>;
let driveEnv: AppEnv;

beforeEach(() => {
  hit = [];
  store = new Map();
  driveEnv = { CACHE: fakeKv(store), CACHE_TTL_SECONDS: "300" } as never;
});

describe("listFolder KV cache", () => {
  it("serves the second call from cache without hitting Drive", async () => {
    hit = stubDriveFetch();
    const driveCalls = () => hit.filter((u) => u.includes("drive/v3/files"));
    await listFolder(driveEnv, "root");
    expect(driveCalls()).toHaveLength(1);
    await listFolder(driveEnv, "root");
    expect(driveCalls()).toHaveLength(1);
    expect(store.has("list2:root")).toBe(true);
  });

  it("falls back to Drive when cache is empty", async () => {
    const emptyEnv = { CACHE: undefined, CACHE_TTL_SECONDS: "300" };
    hit = stubDriveFetch();
    const { files } = await listFolder(emptyEnv as never, "root");
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("getMeta KV cache", () => {
  it("reuses cached metadata across calls", async () => {
    hit = stubDriveFetch();
    const metaCalls = () => hit.filter((u) => u.includes("/files/F1"));
    await getMeta(driveEnv, "F1");
    await getMeta(driveEnv, "F1");
    expect(metaCalls()).toHaveLength(1);
    expect(store.has("meta:F1")).toBe(true);
  });
});