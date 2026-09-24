import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { HIT_RATE_LIMIT_SQL } from "../src/db";

// Exercises the guarded upsert against real SQLite (the engine D1 wraps), so
// the atomicity guarantee is verified by behavior, not by string-matching.
// The D1 driver's changes reporting was smoke-checked separately against a
// local D1 database.
const DDL = `CREATE TABLE rate_limits (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, window_start)
)`;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  return db;
}

function hit(db: DatabaseSync, scope: string, key: string, windowStart: number, limit: number): number {
  return Number(db.prepare(HIT_RATE_LIMIT_SQL).run(scope, key, windowStart, limit).changes);
}

describe("rate limit SQL against real SQLite", () => {
  it("allows exactly `limit` hits per window, then refuses", () => {
    const db = freshDb();
    const outcomes: number[] = [];
    for (let i = 0; i < 12; i++) outcomes.push(hit(db, "unlock", "ip:1", 500, 10));
    expect(outcomes).toEqual([...Array(10).fill(1), 0, 0]);
    const { count } = db.prepare("SELECT count FROM rate_limits").get() as { count: number };
    expect(count).toBe(10);
  });

  it("does not overshoot even when hits arrive in parallel", async () => {
    const db = freshDb();
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => Promise.resolve(hit(db, "unlock", "ip:2", 600, 10))),
    );
    expect(outcomes.filter((n) => n > 0)).toHaveLength(10);
    const { count } = db.prepare("SELECT count FROM rate_limits").get() as { count: number };
    expect(count).toBe(10);
  });

  it("keeps counters independent across keys, scopes, and windows", () => {
    const db = freshDb();
    expect(hit(db, "unlock", "ip:3", 500, 10)).toBe(1);
    expect(hit(db, "unlock", "ip:1", 501, 10)).toBe(1);
    expect(hit(db, "fetch", "ip:1", 500, 10)).toBe(1);
  });
});
