import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLDER_MIME, listFolder, proxyFile, searchDrive } from "../src/drive";
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

  it("rejects folder ids with characters outside drive id charset", async () => {
    stubDriveFetch(1);
    await expect(listFolder(driveEnv as never, "1AbC' OR 1=1")).rejects.toMatchObject({ status: 400 });
  });
});

describe("proxyFile XSS hardening", () => {
  function stubMediaFetch(mime: string) {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("alt=media")) {
        return new Response("<payload/>", {
          status: 200,
          headers: { "content-type": mime, "content-length": "13", "accept-ranges": "bytes" },
        });
      }
      // getMeta: single file endpoint.
      const id = url.includes("/files/") ? url.split("/files/")[1]!.split("?")[0] : "F1";
      return new Response(JSON.stringify({ id, name: `f.${mime.split("/")[1]}`, mimeType: mime, parents: ["P"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves text/html as attachment even when preview is requested", async () => {
    stubMediaFetch("text/html");
    const res = await proxyFile(driveEnv as never, "H1", { inline: true });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves svg as attachment even when preview is requested", async () => {
    stubMediaFetch("image/svg+xml");
    const res = await proxyFile(driveEnv as never, "S1", { inline: true });
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("keeps pdf inline for preview", async () => {
    stubMediaFetch("application/pdf");
    const res = await proxyFile(driveEnv as never, "P1", { inline: true });
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sets frame-protection headers so external sites cannot frame bytes", async () => {
    stubMediaFetch("application/pdf");
    const res = await proxyFile(driveEnv as never, "P2", { inline: true });
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });
});

describe("searchDrive", () => {
  function stubSearch(searchFiles: object[], metaByParent: Record<string, string[]>) {
    const hits: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      hits.push(url);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("drive/v3/files?") && url.includes("q=")) {
        return new Response(JSON.stringify({ files: searchFiles }), { status: 200 });
      }
      if (url.includes("/files/")) {
        const id = url.split("/files/")[1]!.split("?")[0];
        return new Response(
          JSON.stringify({ id, name: `f-${id}`, mimeType: "text/plain", parents: metaByParent[id] ?? ["root"] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    return hits;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries Drive by name contains with single-quote escaping", async () => {
    const hits = stubSearch([{ id: "f1", name: "Catatan.txt", mimeType: "text/plain" }], { f1: ["root"] });
    const out = await searchDrive(driveEnv as never, "it's", "root");
    expect(out).toHaveLength(1);
    expect(out[0].file.name).toBe("Catatan.txt");
    const q = new URL(hits.find((h) => h.includes("q="))!).searchParams.get("q");
    expect(q).toBe("name contains 'it\\'s' and trashed = false");
  });

  it("keeps hits whose ancestor chain reaches the archive root", async () => {
    stubSearch([{ id: "f1", name: "Catatan.txt", mimeType: "text/plain" }], { f1: ["mid"], mid: ["root"] });
    const out = await searchDrive(driveEnv as never, "cat", "root");
    expect(out).toHaveLength(1);
    expect(out[0].crumbs.map((c) => c.id)).toEqual(["root", "mid", "f1"]);
  });

  it("drops hits outside the archive root", async () => {
    stubSearch([{ id: "f1", name: "Catatan.txt", mimeType: "text/plain" }], { f1: ["X"], X: [] });
    const out = await searchDrive(driveEnv as never, "cat", "root");
    expect(out).toHaveLength(0);
  });

  it("excludes the root folder itself from results", async () => {
    stubSearch(
      [
        { id: "root", name: "Home Base", mimeType: "application/vnd.google-apps.folder" },
        { id: "f1", name: "Homebase.txt", mimeType: "text/plain" },
      ],
      { f1: ["root"] },
    );
    const out = await searchDrive(driveEnv as never, "home", "root");
    expect(out).toHaveLength(1);
    expect(out[0].file.id).toBe("f1");
  });
});