import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLDER_MIME, listFolder } from "../src/drive";
import { kindOf } from "../web/src/api";

describe("drive classification", () => {
  it("recognizes folders", () => {
    expect(FOLDER_MIME).toBe("application/vnd.google-apps.folder");
  });

  it("sorts google docs, sheets, slides as doc kinds", () => {
    expect(kindOf("application/vnd.google-apps.document")).toBe("doc");
    expect(kindOf("application/vnd.google-apps.spreadsheet")).toBe("sheet");
    expect(kindOf("application/vnd.google-apps.presentation")).toBe("slide");
    expect(kindOf(FOLDER_MIME)).toBe("folder");
    expect(kindOf("application/pdf")).toBe("pdf");
    expect(kindOf("application/zip")).toBe("archive");
    expect(kindOf("application/octet-stream")).toBe("file");
  });
});

const driveEnv = { CACHE: undefined, CACHE_TTL_SECONDS: "300" };

function stubDriveFetch(pages: number) {
  let pagesServed = 0;
  const hit: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    hit.push(url);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    pagesServed++;
    return new Response(
      JSON.stringify({
        files: [{ id: `f${pagesServed}` }],
        nextPageToken: pagesServed < pages ? `P${pagesServed}` : undefined,
      }),
      { status: 200 },
    );
  });
  return hit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listFolder pagination", () => {
  it("follows nextPageToken to the second page and stops", async () => {
    const hit = stubDriveFetch(2);
    const files = await listFolder(driveEnv as never, "root");
    expect(files.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(hit.filter((u) => u.includes("drive/v3/files"))).toHaveLength(2);
  });

  it("caps at 4 pages when Drive keeps paging", async () => {
    stubDriveFetch(10);
    const files = await listFolder(driveEnv as never, "root");
    expect(files).toHaveLength(4);
  });
});