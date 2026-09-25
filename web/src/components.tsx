import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Plyr from "plyr";
import { formatBytes, kindOf } from "./api";
import { clearResume, formatTime, readResume, writeResume } from "./media";
import { navigate } from "./nav";
import type { DriveFile } from "./types";

/* ---------- Spinner ---------- */
export function Spinner() {
  return <div className="spinner" role="status" aria-label="Memuat" />;
}

/* ---------- Skeleton ---------- */
export function SkeletonRow() {
  return (
    <div className="filerow" aria-hidden="true">
      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="skeleton" style={{ height: 14, width: "60%", borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 10, width: "35%", borderRadius: 4 }} />
      </div>
      <div className="skeleton" style={{ height: 10, width: 80, borderRadius: 4 }} />
      <div className="skeleton" style={{ height: 10, width: 50, borderRadius: 4 }} />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="filecard" aria-hidden="true">
      <div className="shot">
        <div className="skeleton" style={{ width: "100%", height: "100%", borderRadius: 0 }} />
      </div>
      <div className="body">
        <div className="skeleton" style={{ height: 13, width: "70%", borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 10, width: "40%", borderRadius: 4, marginTop: 6 }} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div className="skeleton" style={{ height: 12, width: "25%", borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 12, width: "15%", borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 12, width: "15%", borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 12, width: "10%", borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 12, width: "12%", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

/* ---------- Notice ---------- */
export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "warn" | "ok"; children: ReactNode }) {
  const cls = kind === "info" ? "notice" : `notice ${kind}`;
  return <div className={cls} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

/* ---------- Empty ---------- */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden="true">∅</div>
      <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>{title}</div>
      {hint ? <div style={{ fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

/* ---------- FileBadge ---------- */
const KIND_BADGE: Record<string, string> = {
  folder: "DIR",
  video: "VID",
  audio: "AUD",
  image: "IMG",
  doc: "DOC",
  sheet: "XLS",
  slide: "PPT",
  pdf: "PDF",
  archive: "ZIP",
  code: "TXT",
  file: "···",
};

export function FileBadge({ mime, locked }: { mime: string; locked?: boolean }) {
  if (locked) return <span className="ficon lock" aria-hidden="true">⌐</span>;
  const kind = kindOf(mime);
  return (
    <span className={`ficon ${kind}`} aria-hidden="true">
      {KIND_BADGE[kind]}
    </span>
  );
}

/* ---------- FileCard ---------- */
export function FileCard({ file, onOpen }: { file: DriveFile; onOpen?: (file: DriveFile) => void }) {
  const folder = kindOf(file.mimeType) === "folder";
  const to = folder ? `/b/${file.id}` : `/f/${file.id}`;
  return (
    <a className="filecard" href={to} onClick={(e) => { e.preventDefault(); if (onOpen) onOpen(file); else navigate(to); }}>
      <span className="shot">
        {file.thumbnailLink && (kindOf(file.mimeType) === "image" || kindOf(file.mimeType) === "video") ? (
          <img src={file.thumbnailLink} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <FileBadge mime={file.mimeType} />
        )}
      </span>
      <span className="body">
        <span className="fname">{file.name}</span>
        <span className="fmeta">{folder ? "folder" : formatBytes(file.size)}</span>
      </span>
    </a>
  );
}

/* ---------- Modal ---------- */
export function Modal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    // Focus the dialog on mount
    const timer = requestAnimationFrame(() => {
      const el = dialogRef.current;
      if (el) {
        const focusable = el.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      }
    });

    // Focus trap
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const el = dialogRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(timer);
      window.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {sub ? <p className="sub">{sub}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* ---------- copyText ---------- */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

/* ---------- Toast ---------- */
type ToastKind = "ok" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<{ push: (kind: ToastKind, text: string) => void }>({ push: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- ErrorBoundary ---------- */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="wrap" style={{ paddingTop: 48 }}>
          <Notice kind="error">
            <strong>Terjadi kesalahan tak terduga.</strong> Tampilan ini gagal dimuat.
          </Notice>
          <button className="btn" onClick={() => this.setState({ error: null })}>Muat ulang tampilan</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------- ImageLightbox ---------- */
export function ImageLightbox({
  items,
  index: start,
  onClose,
}: {
  items: { src: string; alt: string }[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const idx = Math.max(0, Math.min(i, items.length - 1));
  const item = items[idx];
  const prev = () => setI((x) => Math.max(0, x - 1));
  const next = () => setI((x) => Math.min(items.length - 1, x + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && items.length > 1) { e.preventDefault(); prev(); }
      else if (e.key === "ArrowRight" && items.length > 1) { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item?.alt}
      onClick={() => (zoomed ? setZoomed(false) : onClose())}
    >
      {item ? <img
        src={item.src}
        alt={item.alt}
        className={zoomed ? "zoomed" : ""}
        onClick={(e) => { e.stopPropagation(); setZoomed((z) => !z); }}
      /> : null}
      {items.length > 1 ? (
        <>
          <button
            className="lb-prev"
            aria-label="Sebelumnya"
            disabled={idx === 0}
            onClick={(e) => { e.stopPropagation(); prev(); }}
          >‹</button>
          <button
            className="lb-next"
            aria-label="Berikutnya"
            disabled={idx === items.length - 1}
            onClick={(e) => { e.stopPropagation(); next(); }}
          >›</button>
          <div className="lightbox-cap">
            {idx + 1} / {items.length} · {item?.alt}
          </div>
        </>
      ) : (
        <div className="lightbox-cap">{item?.alt}</div>
      )}
      <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>Tutup ✕</button>
    </div>
  );
}

/* ---------- MediaPlayer ---------- */
/* ---------- MediaPlayer ---------- */
type MediaPlayerProps = {
  src: string;
  kind: "video" | "audio";
  poster?: string;
  /** File id + name drive resume position and the subtitle lookup label. */
  fileId?: string;
  fileName?: string;
  sizeBytes?: number;
  /** Sibling subtitle streamed through the same byte proxy. */
  subtitleSrc?: string;
};

// Big files only fetch metadata up front; anything smaller gets a head start so
// the first seconds do not stutter through the Worker/Drive hop.
const PRELOAD_FULL_LIMIT = 200 * 1024 * 1024;
const SAVE_EVERY_SEC = 5;

export function MediaPlayer({
  src,
  kind,
  poster,
  fileId,
  fileName,
  sizeBytes,
  subtitleSrc,
}: MediaPlayerProps) {
  const elRef = useRef<HTMLElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const [resumeChip, setResumeChip] = useState<number>(0);
  const setEl = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const player = new Plyr(el, {
      controls:
        kind === "video"
          ? ["play-large", "play", "progress", "current-time", "mute", "volume", "captions", "settings", "pip", "fullscreen"]
          : ["play-large", "play", "progress", "current-time", "mute", "volume", "settings"],
      settings: ["speed"],
      captions: { active: true, language: "auto", update: true },
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      resetOnEnd: true,
      // Same-host sprite from web/public. Plyr's default is cdn.plyr.io, which
      // left every control iconless whenever that CDN was unreachable.
      iconUrl: "/plyr.svg",
      clickToPlay: true,
      hideControls: false,
      tooltips: { controls: true, seek: true },
      keyboard: { focused: true, global: false },
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      storage: { enabled: true, key: "zee-plyr" },
    });
    playerRef.current = player;

    let saved = 0;
    let lastSave = 0;
    const onLoaded = () => {
      if (!fileId) return;
      const at = readResume(fileId);
      const duration = player.duration || 0;
      // Only offer a point that is meaningfully in and still inside the video.
      if (at > 0 && duration > 0 && at < duration - 10) {
        player.currentTime = at;
        saved = at;
        setResumeChip(at);
      }
    };
    const onTime = () => {
      if (!fileId) return;
      const t = player.currentTime || 0;
      const duration = player.duration || 0;
      if (t - lastSave >= SAVE_EVERY_SEC) {
        lastSave = t;
        if (duration > 0 && t < duration - 5) writeResume(fileId, t);
      }
    };
    const onEnded = () => {
      if (fileId) clearResume(fileId);
      setResumeChip(0);
    };

    player.on("loadedmetadata", onLoaded);
    player.on("timeupdate", onTime);
    player.on("ended", onEnded);
    return () => {
      player.off("loadedmetadata", onLoaded);
      player.off("timeupdate", onTime);
      player.off("ended", onEnded);
      if (fileId && saved) {
        const t = player.currentTime ?? 0;
        if (t > 0) writeResume(fileId, t);
      }
      player.destroy();
      playerRef.current = null;
    };
  }, [src, kind, fileId, subtitleSrc]);

  const startOver = () => {
    if (fileId) clearResume(fileId);
    setResumeChip(0);
    const player = playerRef.current;
    if (player) player.currentTime = 0;
  };

  const preload = sizeBytes !== undefined && sizeBytes > PRELOAD_FULL_LIMIT ? "metadata" : "auto";
  const tracks =
    subtitleSrc && fileName
      ? [<track key="sub" kind="captions" label="Indonesia" srcLang="id" src={subtitleSrc} default />]
      : null;

  if (kind === "video") {
    return (
      <div className="media-host">
        <video
          ref={(el) => setEl(el)}
          src={src}
          playsInline
          preload={preload}
          poster={poster ?? undefined}
          crossOrigin="anonymous"
        >
          {tracks}
        </video>
        {resumeChip > 0 ? (
          <div className="resume-chip">
            Lanjut dari <strong>{formatTime(resumeChip)}</strong>
            <button type="button" className="btn tiny" onClick={startOver}>
              Mulai dari awal
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return <audio ref={(el) => setEl(el)} src={src} preload={preload} />;
}

/* ---------- ShortcutHelp ---------- */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Pintasan keyboard" sub="Bekerja di halaman arsip" onClose={onClose}>
      <div className="shortcuts-list">
        <kbd>/</kbd><span className="desc">Fokus ke pencarian</span>
        <kbd>g</kbd><span className="desc">Ubah tampilan daftar / galeri</span>
        <kbd>?</kbd><span className="desc">Buka bantuan ini</span>
        <kbd>Esc</kbd><span className="desc">Tutup dialog / blok zoom</span>
      </div>
      <button className="btn primary" onClick={onClose}>Mengerti</button>
    </Modal>
  );
}