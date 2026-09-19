import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/crypto";
import { hashUnlockToken } from "../src/unlock";

describe("password hash / verify", () => {
  it("verifies the correct password", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("hunter2", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", stored)).toBe(false);
  });

  it("does not verify garbage hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$abc")).toBe(false);
  });
});

describe("unlock token binding", () => {
  it("differs across folders, stable per folder", async () => {
    const hash = "stored-hash";
    const a = await hashUnlockToken("f1", hash);
    const b = await hashUnlockToken("f1", hash);
    const c = await hashUnlockToken("f2", hash);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});