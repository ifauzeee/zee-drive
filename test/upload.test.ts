import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES, uploadToDrive } from "../src/upload";
import type { AppEnv } from "../src/env";

const env = {} as AppEnv;

function stubUploadFetch(over: {
  createStatus?: number;
  putStatus?: number;
  location?: string | null;
  putBody?: string;
} = {}) {
  const {
    createStatus = 200,
    putStatus = 200,
    location = "https://up.example/session",
    putBody = `{"id":"f1","name":"a.txt"}`,
  } = over;
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("upload/drive/v3/files")) {
      return new Response(location ?? "", {
        status: createStatus,
        headers: location ? { location } : {},
      });
    }
    return new Response(putBody, { status: putStatus, headers: { "content-type": "application/json" } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadToDrive", () => {
  it("creates a resumable session then PUTs the body", async () => {
    const calls = stubUploadFetch();
    const out = await uploadToDrive(env, "a.txt", "text/plain", "root", 5, "hello");
    expect(out).toEqual({ id: "f1", name: "a.txt" });
    expect(calls).toHaveLength(3);
  });

  it("throws HttpError 502 when Google rejects the session", async () => {
    stubUploadFetch({ createStatus: 403 });
    await expect(uploadToDrive(env, "a.txt", "text/plain", "root", 5, "x")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("throws HttpError 502 when Google omits the resumable URL", async () => {
    stubUploadFetch({ location: null });
    await expect(uploadToDrive(env, "a.txt", "text/plain", "root", 5, "x")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("throws HttpError 502 when the body upload fails", async () => {
    stubUploadFetch({ putStatus: 400, putBody: `{"error":{"message":"bad"}}` });
    await expect(uploadToDrive(env, "a.txt", "text/plain", "root", 5, "x")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("caps uploads at 95 MiB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(95 * 1024 * 1024);
  });
});