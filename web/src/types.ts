// Wire types shared with the worker (src/types.ts).
import type { Crumb, DriveFile } from "../../src/types";
export type { Activity, Crumb, DriveFile, FolderPassword, ShareLink } from "../../src/types";

export type SearchResult = { file: DriveFile; crumbs: Crumb[] };

export type Me = {
  email: string;
  name: string;
  picture?: string;
  admin: boolean;
} | null;

export type LockInfo = { folderId: string; folderName: string };