import { cacheTtl, type AppEnv } from "./env";
import { HttpError } from "./errors";
import type { Crumb, DriveFile, DriveFileWithParents } from "./types";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type StorageQuota = {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
};

const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,thumbnailLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)";

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(env: AppEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) return tokenCache.token;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new HttpError(502, `Google menolak refresh token: ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return tokenCache.token;
}

async function driveJson<T>(env: AppEnv, url: string): Promise<T> {
  const token = await getAccessToken(env);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const detail = await response.text();
    throw new HttpError(502, `Drive API error (${response.status}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function listFolder(env: AppEnv, folderId: string): Promise<DriveFile[]> {
  const key = `list:${folderId}`;
  const ttl = cacheTtl(env);

  if (env.CACHE) {
    const cached = await env.CACHE.get<DriveFile[]>(key, "json");
    if (cached) return cached;
  }

  const escaped = folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${escaped}' in parents and trashed = false`,
    fields: `files(${FILE_FIELDS})`,
    orderBy: "folder,name",
    pageSize: "1000",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const files: DriveFile[] = [];
  let nextToken: string | undefined;
  // ponytail: Drive caps pageSize at 1000; cap at 4 pages (~4000 items),
  // then truncate silently. Stream/`truncated` flag if real folders outgrow it.
  for (let page = 0; page < 4; page++) {
    if (nextToken) params.set("pageToken", nextToken);
    const data = await driveJson<{ files?: DriveFile[]; nextPageToken?: string }>(
      env,
      `https://www.googleapis.com/drive/v3/files?${params}`,
    );
    files.push(...(data.files ?? []));
    nextToken = data.nextPageToken;
    if (!nextToken) break;
  }

  if (env.CACHE) {
    await env.CACHE.put(key, JSON.stringify(files), { expirationTtl: ttl });
  }
  return files;
}

export async function getMeta(env: AppEnv, fileId: string): Promise<DriveFileWithParents> {
  const key = `meta:${fileId}`;
  if (env.CACHE) {
    const cached = await env.CACHE.get<DriveFileWithParents>(key, "json");
    if (cached) return cached;
  }

  const params = new URLSearchParams({
    fields: `${FILE_FIELDS},parents`,
    supportsAllDrives: "true",
  });
  const meta = await driveJson<DriveFileWithParents>(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
  );

  if (env.CACHE) {
    await env.CACHE.put(key, JSON.stringify(meta), { expirationTtl: cacheTtl(env) });
  }
  return meta;
}

export async function getBreadcrumb(
  env: AppEnv,
  folderId: string,
  rootId: string,
): Promise<Crumb[]> {
  const crumbs: Crumb[] = [];
  let current: string | undefined = folderId;

  for (let depth = 0; depth < 25 && current; depth++) {
    if (current === rootId) {
      crumbs.unshift({ id: rootId, name: "Home" });
      break;
    }
    const meta = await getMeta(env, current);
    crumbs.unshift({ id: meta.id, name: meta.name });
    current = meta.parents?.[0];
  }
  return crumbs;
}

/** Full ancestor chain from folderId up to (and including) rootId. */
export async function getAncestors(
  env: AppEnv,
  folderId: string,
  rootId: string,
): Promise<string[]> {
  return (await getBreadcrumb(env, folderId, rootId)).map((c) => c.id);
}

export type SearchResult = { file: DriveFile; crumbs: Crumb[] };

/**
 * Names the whole tree under rootId. Drive has no "descendant of" query,
 * so walk it with BFS (listFolder reuses the existing KV cache).
 * Results and visited folders are capped.
 */
export async function searchDrive(
  env: AppEnv,
  query: string,
  rootId: string,
): Promise<SearchResult[]> {
  const needle = query.trim().toLowerCase();
  const key = `search:${rootId}:${needle}`;
  const ttl = cacheTtl(env);

  if (env.CACHE) {
    const cached = await env.CACHE.get<SearchResult[]>(key, "json");
    if (cached) return cached;
  }

  const results: SearchResult[] = [];
  const queue = [rootId];
  let visited = 0;
  // ponytail: BFS capped at 20 folders / 40 hits; raise if the tree gets deep.
  while (queue.length > 0 && visited < 20 && results.length < 40) {
    const folderId = queue.shift()!;
    visited++;
    const children = await listFolder(env, folderId);
    for (const child of children) {
      if (results.length >= 40) break;
      if (child.name.toLowerCase().includes(needle)) {
        results.push({ file: child, crumbs: await getBreadcrumb(env, child.id, rootId) });
      }
      if (isFolder(child) && queue.length < 20) queue.push(child.id);
    }
  }

  if (env.CACHE) {
    await env.CACHE.put(key, JSON.stringify(results), { expirationTtl: ttl });
  }
  return results;
}

export async function getStorageQuota(env: AppEnv): Promise<StorageQuota> {
  const data = await driveJson<{ storageQuota?: StorageQuota }>(
    env,
    "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
  );
  return data.storageQuota ?? {};
}

const EXPORT_TYPES: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: ".pptx",
  },
};

export function isFolder(file: DriveFile): boolean {
  return file.mimeType === FOLDER_MIME;
}

function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function proxyFile(
  env: AppEnv,
  fileId: string,
  options: { inline?: boolean; range?: string | null } = {},
): Promise<Response> {
  const meta = await getMeta(env, fileId);

  if (isFolder(meta)) throw new HttpError(400, "Folder tidak bisa diunduh langsung.");

  const token = await getAccessToken(env);
  const exportType = EXPORT_TYPES[meta.mimeType];

  let url: string;
  let outputMime = meta.mimeType;
  let outputName = meta.name;

  if (exportType) {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportType.mime)}`;
    outputMime = exportType.mime;
    outputName = `${meta.name}${exportType.ext}`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  }

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (options.range && !exportType) headers.range = options.range;

  const upstream = await fetch(url, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    throw new HttpError(502, `Gagal mengambil file dari Drive (${upstream.status}).`);
  }

  const responseHeaders = new Headers();
  responseHeaders.set("content-type", upstream.headers.get("content-type") ?? outputMime);
  responseHeaders.set("content-disposition", contentDisposition(outputName, options.inline === true));
  responseHeaders.set("accept-ranges", "bytes");
  responseHeaders.set("cache-control", "private, max-age=3600");

  for (const header of ["content-length", "content-range"]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
