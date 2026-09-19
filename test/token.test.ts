import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, signJson, verifyJson } from "../src/crypto";
import { isShareExpired } from "../src/share";

describe("b64 base64url round-trip", () => {
  it("round-trips arbitrary bytes", () => {
    const input = new Uint8Array([0, 1, 2, 3, 250, 251, 255]);
    const encoded = b64urlEncode(input);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    const out = b64urlDecode(encoded);
    expect(Array.from(out)).toEqual(Array.from(input));
  });
});

describe("signJson / verifyJson", () => {
  it("signs and verifies a payload", async () => {
    const token = await signJson({ a: 1, b: "x" }, "secret");
    expect(token).toContain(".");
    const payload = await verifyJson<{ a: number; b: string }>(token, "secret");
    expect(payload).toEqual({ a: 1, b: "x" });
  });

  it("rejects wrong secret", async () => {
    const token = await signJson({ a: 1 }, "right");
    expect(await verifyJson(token, "wrong")).toBeNull();
  });

  it("rejects tampered payload", async () => {
    const token = await signJson({ a: 1 }, "secret");
    const [, sig] = token.split(".");
    const enc = new TextEncoder();
    let binary = "";
    for (const b of enc.encode('{"a":2}')) binary += String.fromCharCode(b);
    const forgedBody = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyJson(`${forgedBody}.${sig}`, "secret")).toBeNull();
  });

  it("rejects malformed token", async () => {
    expect(await verifyJson("garbage", "secret")).toBeNull();
    expect(await verifyJson("", "secret")).toBeNull();
  });
});

describe("share claims", () => {
  it("rejects expired claims", () => {
    expect(isShareExpired({ sid: "x", fid: "y", exp: Math.floor(Date.now() / 1000) - 5 })).toBe(true);
    expect(isShareExpired({ sid: "x", fid: "y", exp: Math.floor(Date.now() / 1000) + 500 })).toBe(false);
    expect(isShareExpired({ sid: "x", fid: "y" })).toBe(false);
  });
});