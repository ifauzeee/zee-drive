// Wire types shared between worker (src/) and SPA (web/src/).
// Single source of truth for every JSON shape crossing the API boundary.

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  parents?: string[];
  imageMediaMetadata?: { width?: number; height?: number };
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
};

export type DriveFileWithParents = DriveFile & { parents: string[] };

export type Crumb = { id: string; name: string };

export type ShareLink = {
  id: string;
  file_id: string;
  file_name: string;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  download_only: number;
  revoked: number;
  password: string | null;
};

export type Activity = {
  id: number;
  ts: number;
  actor: string;
  action: string;
  file_id: string | null;
  detail: string | null;
};

export type FolderPassword = {
  folderId: string;
  folderName: string;
  recursive: boolean;
  createdBy: string;
  createdAt: number;
};