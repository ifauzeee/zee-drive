import type {
  Activity,
  Crumb,
  DriveFile,
  FolderPassword,
  Me,
  ShareLink,
  SearchResult,
} from "./types";

export class ApiError extends Error {
  status: number;
  locked?: { folderId: string; folderName: string };
  constructor(status: number, message: string, locked?: { folderId: string; folderName: string }) {
    super(message);
    this.status = status;
    this.locked = locked;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    locked?: boolean;
    folderId?: string;
    folderName?: string;
  } & T;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error || `Permintaan gagal (${res.status}).`,
      data.locked ? { folderId: data.folderId ?? "", folderName: data.folderName ?? "" } : undefined,
    );
  }
  return data;
}

export const api = {
  config: () => req<{ appName: string; rootFolderId: string; guestLogin: boolean }>("/api/config"),
  me: () => req<{ user: Me }>("/api/auth/me"),
  files: (folder: string) =>
    req<{ files: DriveFile[]; crumbs: Crumb[] }>(`/api/files?folder=${encodeURIComponent(folder)}`),
  search: (q: string) =>
    req<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  meta: (id: string) => req<{ file: DriveFile }>(`/api/meta/${encodeURIComponent(id)}`),
  unlock: (folderId: string, password: string) =>
    req<{ ok: boolean }>("/api/folder/unlock", {
      method: "POST",
      body: JSON.stringify({ folderId, password }),
    }),
  createShare: (input: {
    fileId: string;
    expiresInHours: number | null;
    maxUses: number | null;
    downloadOnly: boolean;
    password: string | null;
  }) => req<{ id: string; token: string; url: string }>("/api/share", { method: "POST", body: JSON.stringify(input) }),
  shares: () => req<{ links: ShareLink[] }>("/api/share"),
  revokeShare: (id: string) =>
    req<{ ok: boolean }>("/api/share/revoke", { method: "POST", body: JSON.stringify({ id }) }),
  shareMeta: (token: string) =>
    req<{ kind: "file" | "folder"; file?: DriveFile; folder?: DriveFile; downloadOnly: boolean }>(
      `/api/s/${encodeURIComponent(token)}`,
    ),
  shareUnlock: (token: string, password: string, folderId?: string) =>
    req<{ ok: boolean }>(`/api/s/${encodeURIComponent(token)}/unlock`, {
      method: "POST",
      body: JSON.stringify({ password, folderId }),
    }),
  shareFiles: (token: string, folder?: string) =>
    req<{ files: DriveFile[]; crumbs: Crumb[]; rootId: string; rootName: string }>(
      `/api/s/${encodeURIComponent(token)}/files${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
    ),
  passwords: () => req<{ passwords: FolderPassword[] }>("/api/admin/passwords"),
  setPassword: (input: { folderId: string; password: string; recursive: boolean }) =>
    req<{ ok: boolean }>("/api/admin/passwords", { method: "POST", body: JSON.stringify(input) }),
  removePassword: (folderId: string) =>
    req<{ ok: boolean }>("/api/admin/passwords/remove", {
      method: "POST",
      body: JSON.stringify({ folderId }),
    }),
  storage: () =>
    req<{ limit: number; usage: number; usageInDrive: number; percent: number }>(
      "/api/admin/storage",
    ),
  quota: () => req<{ limit: number; usage: number; percent: number }>("/api/quota"),
  adminConfig: () =>
    req<{
      config: { appName: string; rootFolderId: string; cacheTtl: number; maintenance: boolean; guest: boolean };
    }>("/api/admin/config"),
  saveConfig: (input: { maintenance?: boolean; guest?: boolean }) =>
    req<{ ok: boolean }>("/api/admin/config", { method: "POST", body: JSON.stringify(input) }),
  activity: () => req<{ activity: Activity[] }>("/api/admin/activity"),
  refresh: (folderId: string) =>
    req<{ ok: boolean }>("/api/admin/refresh", { method: "POST", body: JSON.stringify({ folderId }) }),
  upload: (file: File, folderId: string, onProgress?: (fraction: number) => void) =>
    new Promise<{ file: { id: string; name: string } }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/upload?folder=${encodeURIComponent(folderId)}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data = {} as { error?: string; locked?: boolean; folderId?: string; folderName?: string; file?: { id: string; name: string } };
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ file: data.file ?? { id: "", name: file.name } });
        } else {
          reject(
            new ApiError(
              xhr.status,
              data.error || `Upload gagal (${xhr.status}).`,
              data.locked ? { folderId: data.folderId ?? "", folderName: data.folderName ?? "" } : undefined,
            ),
          );
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "Koneksi terputus."));
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    }),
};

export function formatBytes(value?: string | number): string {
  const n = typeof value === "string" ? Number(value) : (value ?? NaN);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function formatTs(ts: number | null): string {
  if (ts === null || ts === undefined) return "tanpa batas";
  return new Date(ts * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function kindOf(mime: string): "folder" | "video" | "audio" | "image" | "doc" | "sheet" | "slide" | "pdf" | "archive" | "code" | "file" {
  if (mime === "application/vnd.google-apps.folder") return "folder";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/vnd.google-apps.document") return "doc";
  if (mime === "application/vnd.google-apps.spreadsheet") return "sheet";
  if (mime === "application/vnd.google-apps.presentation") return "slide";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/zip" || mime.includes("rar") || mime.includes("7z") || mime.includes("tar")) return "archive";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/javascript") return "code";
  return "file";
}
