import { describe, expect, it } from "vitest";
import { createShareLink, hitRateLimit, pruneRateLimits, touchShareLink } from "../src/db";

type SqlCall = { sql: string; params: unknown[] };

function fakeDb(calls: SqlCall[], changes = 1): D1Database {
  const stmt = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => {
        calls.push({ sql, params });
        return { meta: { changes } };
      },
    }),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

describe("touchShareLink", () => {
  it("increments uses atomically guarded by revoked and max_uses", async () => {
    const calls: SqlCall[] = [];
    const changes = await touchShareLink(fakeDb(calls, 1), "s1");
    expect(changes).toBe(1);
    expect(calls[0].sql).toContain("uses = uses + 1");
    expect(calls[0].sql).toContain("revoked = 0");
    expect(calls[0].sql).toContain("(max_uses IS NULL OR uses < max_uses)");
    expect(calls[0].params).toEqual(["s1"]);
  });

  it("surfaces a refused update as zero changes", async () => {
    const calls: SqlCall[] = [];
    const changes = await touchShareLink(fakeDb(calls, 0), "s1");
    expect(changes).toBe(0);
  });
});

describe("createShareLink", () => {
  it("inserts a fresh share starting at zero uses", async () => {
    const calls: SqlCall[] = [];
    await createShareLink(fakeDb(calls), {
      id: "s1",
      file_id: "f1",
      file_name: "f",
      created_by: "admin",
      created_at: 0,
      expires_at: null,
      max_uses: 5,
      download_only: 0,
      password: null,
    });
    const sql = calls[0].sql as string;
    expect(sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)");
    expect(calls[0].params).toEqual(["s1", "f1", "f", "admin", 0, null, 5, 0, null]);
  });
});

describe("hitRateLimit", () => {
  it("returns true when the atomic upsert applies", async () => {
    const calls: SqlCall[] = [];
    const ok = await hitRateLimit(fakeDb(calls, 1), "unlock", "ip:1", 12_345_600, 10);
    expect(ok).toBe(true);
    expect(calls[0].sql).toContain("INSERT INTO rate_limits");
    expect(calls[0].sql).toContain("ON CONFLICT(scope, key, window_start)");
    expect(calls[0].sql).toContain("count = count + 1");
    expect(calls[0].sql).toContain("WHERE count < ?");
    expect(calls[0].params).toEqual(["unlock", "ip:1", 12_345_600, 10]);
  });

  it("returns false when the row already hit the limit", async () => {
    const calls: SqlCall[] = [];
    const ok = await hitRateLimit(fakeDb(calls, 0), "unlock", "ip:1", 12_345_600, 10);
    expect(ok).toBe(false);
  });
});

describe("pruneRateLimits", () => {
  it("drops rate rows whose window has long passed", async () => {
    const calls: SqlCall[] = [];
    const deleted = await pruneRateLimits(fakeDb(calls, 7), 86_400);
    expect(deleted).toBe(7);
    expect(calls[0].sql).toContain("DELETE FROM rate_limits");
    expect(calls[0].sql).toContain("window_start < ?");
  });
});
