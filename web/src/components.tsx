import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Plyr from "plyr";
import { formatBytes, kindOf } from "./api";
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
export function MediaPlayer({ src, kind, poster }: { src: string; kind: "video" | "audio"; poster?: string }) {
  const elRef = useRef<HTMLElement | null>(null);
  const setEl = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const player = new Plyr(el, {
      controls: ["play-large", "play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"],
    });
    return () => player.destroy();
  }, [src, kind]);
  if (kind === "video") {
    return <video ref={(el) => setEl(el)} src={src} playsInline preload="metadata" poster={poster ?? undefined} />;
  }
  return <audio ref={(el) => setEl(el)} src={src} preload="metadata" />;
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