import type { DriveFile } from "./types";

// Containers browsers can actually decode. Everything else (mkv, avi, wmv,
// flv, mts...) gets a download prompt instead of a broken player.
const PLAYABLE_VIDEO = new Set([
  "mp4",
  "m4v",
  "webm",
  "ogv",
  "mov",
  "m4a",
  "mp3",
  "ogg",
  "oga",
  "wav",
  "flac",
  "aac",
  "opus",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

export function isBrowserPlayable(name: string): boolean {
  return PLAYABLE_VIDEO.has(extensionOf(name));
}

// Sibling subtitle for the same video; vtt wins because browsers parse it
// natively while srt needs a conversion Plyr does on the fly. Language-suffixed
// names are normal (Movie.2020.id.srt), so match by stem prefix.
export function pickSubtitle(siblings: DriveFile[], videoName: string): DriveFile | null {
  const want = baseName(videoName).toLowerCase();
  const match = (ext: string) =>
    siblings.find((f) => {
      if (f.mimeType.startsWith("application/vnd.google-apps")) return false;
      if (extensionOf(f.name) !== ext) return false;
      return baseName(f.name).toLowerCase().startsWith(want);
    });
  return match("vtt") ?? match("srt") ?? null;
}

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Below this the seek is noise, so a stored position is only offered later.
const RESUME_MIN_SEC = 30;
export function resumeAt(seconds: number): number {
  return Number.isFinite(seconds) && seconds > RESUME_MIN_SEC ? Math.floor(seconds) : 0;
}

// Rows rendered per page. Large folders used to mount every row at once.
export const PAGE_ROWS = 300;

export function pageSize(total: number, extra = 0): number {
  return Math.min(total, PAGE_ROWS + extra);
}

// Archives are built in the browser, so a single huge file has to be refused
// up front: client-zip otherwise yields a 0-byte entry and a broken download.
export const ZIP_MAX_BYTES = 512 * 1024 * 1024;

export function tooBigForZip(size: number): boolean {
  return Number.isFinite(size) && size > ZIP_MAX_BYTES;
}

const RESUME_KEY = "zee:resume";

// Chrome's PDF viewer inside an iframe renders pages at a fixed width, which
// looked cut off on phones. FitH plus a visible toolbar makes it match the frame.
export function pdfViewerSrc(url: string): string {
  if (!url) return url;
  const [base, fragment] = url.split("#");
  const hint = "view=FitH&toolbar=1";
  return fragment ? `${base}#${hint}&${fragment}` : `${base}#${hint}`;
}

export function readResume(fileId: string): number {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw) as Record<string, number>;
    return resumeAt(Number(map[fileId]) || 0);
  } catch {
    return 0;
  }
}

export function writeResume(fileId: string, seconds: number): void {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    const map = (raw ? (JSON.parse(raw) as Record<string, number>) : {}) ?? {};
    const next = resumeAt(seconds);
    if (next === 0) delete map[fileId];
    else map[fileId] = next;
    // Keep the map small; only the most recent handful matter.
    const trimmed = Object.fromEntries(Object.entries(map).slice(-20));
    localStorage.setItem(RESUME_KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode or quota: resume is a nicety, never a hard failure */
  }
}

export function clearResume(fileId: string): void {
  writeResume(fileId, 0);
}
