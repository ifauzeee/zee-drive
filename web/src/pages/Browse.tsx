import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { downloadZip } from "client-zip";
import QRCode from "react-qr-code";
import { ApiError, api, formatBytes, formatDate, kindOf } from "../api";
import type { Crumb, DriveFile, LockInfo, Me, SearchResult } from "../types";
import { Empty, FileBadge, FileCard, Modal, Notice, ShortcutHelp, SkeletonCard, SkeletonRow, copyText, useToast } from "../components";
import { navigate } from "../nav";
import { PAGE_ROWS, pageSize, tooBigForZip, ZIP_MAX_BYTES } from "../media";

type View = "list" | "grid";
type Sort = "name" | "size" | "date";

const VIEW_KEY = "zi-view";

function loadStoredView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list" || v === "grid") return v;
  } catch { /* private mode */ }
  return "list";
}

function saveView(v: View) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
}

// Prev/next navigation between files: Browse stashes the peer list in sessionStorage.
const PEERS_KEY = "zi-peers";

function openFileFromFolder(folderId: string, files: DriveFile[], targetId: string) {
  const peers = files
    .filter((f) => kindOf(f.mimeType) !== "folder")
    .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }));
  try { sessionStorage.setItem(PEERS_KEY, JSON.stringify({ folderId, peers })); } catch { /* ignore */ }
  navigate(`/f/${targetId}`);
}

// Stash search context for the "back to results" chip in FileView.
function saveLastSearch(folderId: string, query: string) {
  try { sessionStorage.setItem("zi-last-search", JSON.stringify({ folderId, query })); } catch { /* ignore */ }
}

export default function Browse({
  folderId,
  me,
  onPath,
}: {
  folderId: string;
  me: Me;
  onPath?: (p: { folderId: string; crumbs: Crumb[] }) => void;
}) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockInfo | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [view, setView] = useState<View>(() => loadStoredView());
  const [sort, setSort] = useState<Sort>("name");

  const changeView = useCallback((v: View) => { setView(v); saveView(v); }, []);
  const [shareTarget, setShareTarget] = useState<DriveFile | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  // Debounce global search — cheap enough for large trees.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Server-side search across the whole archive tree.
  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api
      .search(q)
      .then((r) => { if (!cancelled) { setResults(r.results); setSearching(false); } })
      .catch(() => { if (!cancelled) { setResults([]); setSearching(false); } });
    return () => { cancelled = true; };
  }, [debounced]);

  // Keyboard shortcuts: / focuses search, g toggles view, ? opens help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key.toLowerCase() === "g") changeView(view === "list" ? "grid" : "list");
      else if (e.key === "?") setShowHelp(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, changeView]);

  const load = useCallback(async () => {
    setError(null);
    setLock(null);
    setFiles(null);
    try {
      const res = await api.files(folderId);
      setFiles(res.files);
      setTruncated(res.truncated === true);
      setCrumbs(res.crumbs);
      onPath?.({ folderId, crumbs: res.crumbs });
      // Auto view: when no explicit choice is saved and media dominates, go grid.
      try {
        if (!localStorage.getItem(VIEW_KEY)) {
          const media = res.files.filter((f) => { const k = kindOf(f.mimeType); return k === "image" || k === "video" || k === "audio"; });
          if (media.length >= 12 && media.length / Math.max(res.files.length, 1) >= 0.6) setView("grid");
        }
      } catch { /* ignore */ }
    } catch (e) {
      if (e instanceof ApiError && e.locked) {
        setLock(e.locked);
      } else {
        setError(e instanceof Error ? e.message : "Gagal memuat folder.");
      }
}
    // onPath is an inline prop from App; excluding it prevents a reload loop
    // (App re-renders set crumbs -> new onPath identity -> effect re-fires).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  // Returning from FileView via the "back to results" button: restore the old query.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("zi-last-search");
      if (raw) {
        const { folderId: f, query: q } = JSON.parse(raw) as { folderId: string; query: string };
        sessionStorage.removeItem("zi-last-search");
        if (f === folderId) { setQuery(q); setDebounced(q); }
      }
    } catch { /* ignore */ }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const list = files ?? [];
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "id"));
    else if (sort === "date") sorted.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
    else sorted.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
    // Folders first.
    sorted.sort((a, b) => Number(kindOf(b.mimeType) === "folder") - Number(kindOf(a.mimeType) === "folder"));
    return sorted;
  }, [files, sort]);

  const isSearching = debounced.trim().length >= 2;

  // Mounting thousands of rows at once is what stalls a phone, so the list
  // grows on request instead.
  const [extraRows, setExtraRows] = useState(0);
  useEffect(() => { setExtraRows(0); }, [folderId, sort, view]);
  const visibleCount = pageSize(shown.length, extraRows);
  const visible = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const hidden = shown.length - visible.length;

  // Selection for "download picked". Folders are kept whole; files are taken
  // as-is, then the same recursive collector the whole-folder zip uses.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  useEffect(() => { setPicked(new Set()); }, [folderId]);
  const pickedFiles = useMemo(
    () => (files ?? []).filter((f) => picked.has(f.id)),
    [files, picked],
  );
  const togglePick = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function zipAndSave(topLevel: DriveFile[], zipName: string) {
    if (topLevel.length === 0) {
      push("info", "Tidak ada file untuk diarsipkan.");
      return;
    }
    setZipping(true);
    try {
      const { items, skipped, tooBig, truncated } = await collectTree(topLevel);
      if (items.length === 0) {
        push("error", tooBig > 0
          ? `Tidak ada file yang bisa diarsipkan — ${tooBig} file melebihi ${Math.round(ZIP_MAX_BYTES / (1024 * 1024))} MB.`
          : "Tidak ada file yang bisa diarsipkan.");
        return;
      }
      if (tooBig > 0) push("info", `${tooBig} file terlalu besar (>${Math.round(ZIP_MAX_BYTES / (1024 * 1024))} MB) dan dilewati — unduh satu per satu.`);
      if (truncated) push("info", "Batas arsip tercapai — sebagian file dilewati.");
      const sources = await Promise.all(
        items.map(async (f) => {
          const res = await fetch(`/d/${f.id}`, { credentials: "same-origin" });
          if (!res.ok) throw new Error(`Gagal mengambil ${f.name}.`);
          return { name: f.name, input: res };
        }),
      );
      const resp = downloadZip(sources);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${zipName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      push("ok", `Arsip dibuat (${items.length} file${skipped ? `, ${skipped} folder terkunci dilewati` : ""}).`);
    } catch (e2) {
      push("error", e2 instanceof Error ? e2.message : "Gagal membuat arsip.");
    } finally {
      setZipping(false);
    }
  }

  function downloadZipFolder() {
    if (!files) return;
    void zipAndSave(files, crumbs[crumbs.length - 1]?.name ?? "arsip");
  }

  function downloadPicked() {
    void zipAndSave(pickedFiles, `terpilih-${pickedFiles.length}`);
  }

  const folders = shown.filter((f) => kindOf(f.mimeType) === "folder").length;
  const totalSize = (files ?? [])
    .filter((f) => kindOf(f.mimeType) !== "folder")
    .reduce((n, f) => n + Number(f.size || 0), 0);

  if (lock) return <UnlockGate key={lock.folderId} lock={lock} onDone={load} />;
  if (error) {
    return (
      <div className="pagehead">
        <Notice kind="error">{error}</Notice>
        <button className="btn" onClick={() => void load()}>Coba lagi</button>
      </div>
    );
  }
  if (files === null) return (
    <div>
      <div className="pagehead">
        <div className="skeleton" style={{ height: 12, width: 140, borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 28, width: "30%", borderRadius: 6, marginTop: 10 }} />
      </div>
      <div className="toolbar">
        <div className="skeleton" style={{ height: 36, flex: "1 1 220px", borderRadius: "var(--radius-sm)" }} />
        <div className="skeleton" style={{ height: 36, width: 100, borderRadius: "var(--radius-sm)" }} />
      </div>
      {view === "grid" ? (
        <div className="filegrid">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : (
        <div className="filelist">
          <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="pagehead">
        <div className="kicker">Arsip · {folders} folder · {formatBytes(totalSize)}</div>
        <h1>{crumbs.length > 0 ? crumbs[crumbs.length - 1].name : "Arsip"}</h1>
      </div>

      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.length > 5 ? (
          <>
            {crumbs.slice(0, 1).map((c) => (
              <span key={c.id} style={{ display: "contents" }}>
                <a href={`/b/${c.id}`} onClick={(e) => { e.preventDefault(); navigate(`/b/${c.id}`); }}>{c.name}</a>
                <span className="sep" aria-hidden="true">/</span>
              </span>
            ))}
            <span className="crumbs-collapse" title={`${crumbs.length - 3} folder di antaranya`}>
              ···{crumbs.length - 3}
            </span>
            {crumbs.slice(-2).map((c, i) => (
              <span key={c.id} style={{ display: "contents" }}>
                <span className="sep" aria-hidden="true">/</span>
                {i === 1 ? (
                  <span className="here" aria-current="page">{c.name}</span>
                ) : (
                  <a href={`/b/${c.id}`} onClick={(e) => { e.preventDefault(); navigate(`/b/${c.id}`); }}>{c.name}</a>
                )}
              </span>
            ))}
          </>
        ) : (
          crumbs.map((c, i) => (
            <span key={c.id} style={{ display: "contents" }}>
              {i > 0 ? <span className="sep" aria-hidden="true">/</span> : null}
              {i === crumbs.length - 1 ? (
                <span className="here" aria-current="page">{c.name}</span>
              ) : (
                <a href={`/b/${c.id}`} onClick={(e) => { e.preventDefault(); navigate(`/b/${c.id}`); }}>
                  {c.name}
                </a>
              )}
            </span>
          ))
        )}
      </nav>

      {truncated ? (
        <Notice kind="info">
          Folder ini sangat besar — hanya 4.000 item pertama yang ditampilkan. Gunakan pencarian atau navigasi subfolder untuk melihat sisanya.
        </Notice>
      ) : null}

      <div className="toolbar" role="search">
        <label className="search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            placeholder="Cari di seluruh arsip… ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Cari file"
          />
        </label>
        <div className="toolbar-actions">
        <button
          className="btn"
          onClick={() => void downloadZipFolder()}
          disabled={zipping || isSearching || (files?.length ?? 0) === 0}
          title="Arsipkan folder beserta isi subfolder"
        >
          {zipping ? "Menggabung…" : "Unduh .zip"}
        </button>
        {me?.admin ? (
          <button
            className="btn"
            onClick={() => setShowUpload(true)}
            title="Unggah file ke folder tertentu"
          >
            Unggah
          </button>
        ) : null}
        <button
          className="btn"
          onClick={() => { void (async () => {
            await api.refresh(folderId);
            void load();
          })(); }}
          title="Hapus cache folder dan muat ulang dari Drive"
        >
          <RefreshGlyph />
          Muat ulang
        </button>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Urutkan">
          <option value="name">Nama</option>
          <option value="date">Terbaru</option>
          <option value="size">Terbesar</option>
        </select>
        <div className="seg" role="group" aria-label="Tampilan">
          <button aria-pressed={view === "list"} onClick={() => changeView("list")}>Daftar</button>
          <button aria-pressed={view === "grid"} onClick={() => changeView("grid")}>Galeri</button>
        </div>
        </div>
      </div>

      {isSearching ? (
        <SearchPanel
          results={results}
          searching={searching}
          query={debounced.trim()}
          onClear={() => { setQuery(""); setDebounced(""); }}
          onOpenFile={(id) => { saveLastSearch(folderId, debounced.trim()); openFileFromFolder(folderId, files ?? [], id); }}
        />
      ) : shown.length === 0 ? (
        <Empty title="Folder kosong." />
      ) : view === "list" ? (
        <div className="filelist" role="list">
          {visible.map((f) => (
            <Row key={f.id} file={f} me={me} onShare={() => setShareTarget(f)} onOpenFile={(id) => openFileFromFolder(folderId, files ?? [], id)} selected={picked.has(f.id)} onToggle={() => togglePick(f.id)} />
          ))}
        </div>
      ) : (
        <div className="filegrid">
          {visible.map((f) => (
            <FileCard key={f.id} file={f} selected={picked.has(f.id)} onToggle={() => togglePick(f.id)} onOpen={(file) => (kindOf(file.mimeType) === "folder" ? navigate(`/b/${file.id}`) : openFileFromFolder(folderId, files ?? [], file.id))} />
          ))}
        </div>
      )}

      {picked.size > 0 ? (
        <div className="pickbar" role="region" aria-label="Pilihan file">
          <span className="pickbar-count">{picked.size} dipilih</span>
          <button className="btn primary" onClick={downloadPicked} disabled={zipping}>
            {zipping ? "Menggabung…" : "Unduh terpilih"}
          </button>
          <button className="btn" onClick={() => setPicked(new Set())} disabled={zipping}>
            Batal
          </button>
        </div>
      ) : null}

      {hidden > 0 ? (
        <div className="loadmore">
          <span className="loadmore-note">
            Menampilkan {visible.length} dari {shown.length.toLocaleString("id-ID")} item
          </span>
          <button
            className="btn"
            onClick={() => setExtraRows((n) => n + PAGE_ROWS)}
          >
            Tampilkan {Math.min(hidden, PAGE_ROWS).toLocaleString("id-ID")} lagi
          </button>
          {hidden > PAGE_ROWS ? (
            <button className="btn" onClick={() => setExtraRows(shown.length)}>
              Tampilkan semua
            </button>
          ) : null}
        </div>
      ) : null}

      {shareTarget ? <ShareDialog file={shareTarget} onClose={() => setShareTarget(null)} /> : null}
      {showUpload ? (
        <UploadModal
          initialFolderId={folderId}
          crumbs={crumbs}
          onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); void load(); }}
        />
      ) : null}
      {showHelp ? <ShortcutHelp onClose={() => setShowHelp(false)} /> : null}
    </>
  );
}

function SearchPanel({
  results,
  searching,
  query,
  onClear,
  onOpenFile,
}: {
  results: SearchResult[] | null;
  searching: boolean;
  query: string;
  onClear: () => void;
  onOpenFile: (fileId: string) => void;
}) {
  if (results === null) {
    return (
      <div className="filelist" aria-busy="true">
        <SkeletonRow /><SkeletonRow /><SkeletonRow />
      </div>
    );
  }
  if (!searching && results.length === 0) {
    return (
      <div>
        <Empty title="Tidak ditemukan." hint={`Kata kunci "${query}" tidak cocok dengan isi arsip.`} />
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button className="btn ghost" onClick={onClear}>Bersihkan pencarian</button>
        </div>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="filelist" aria-busy="true">
        <SkeletonRow />
      </div>
    );
  }
  return (
    <div className="filelist" role="list">
      {results.map((r) => {
        const folder = kindOf(r.file.mimeType) === "folder";
        const to = folder ? `/b/${r.file.id}` : `/f/${r.file.id}`;
        const loc = r.crumbs.filter((x) => x.id !== r.file.id).map((x) => x.name).join(" / ") || "Arsip";
        return (
          <div key={r.file.id} style={{ display: "contents" }} role="listitem">
            <a
              className="filerow"
              href={to}
              onClick={(e) => { e.preventDefault(); if (folder) navigate(to); else onOpenFile(r.file.id); }}
              aria-label={`Buka ${folder ? "folder" : "file"} ${r.file.name}`}
            >
              <FileBadge mime={r.file.mimeType} />
              <span className="fname">{r.file.name}</span>
              <span className="fmeta hide-sm">{folder ? "folder" : formatBytes(r.file.size)} · {loc}</span>
            </a>
          </div>
        );
      })}
    </div>
  );
}

function RefreshGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

function Row({ file, me, onShare, onOpenFile, selected, onToggle }: { file: DriveFile; me: Me; onShare: () => void; onOpenFile: (id: string) => void; selected?: boolean; onToggle?: () => void }) {
  const folder = kindOf(file.mimeType) === "folder";
  const to = folder ? `/b/${file.id}` : `/f/${file.id}`;
  const img = file.thumbnailLink && kindOf(file.mimeType) === "image";
  return (
    <div style={{ display: "contents" }} role="listitem">
      <a
        className="filerow"
        href={to}
        onClick={(e) => { e.preventDefault(); if (folder) navigate(to); else onOpenFile(file.id); }}
        aria-label={`${folder ? "Buka folder" : "Buka file"} ${file.name}`}
      >
        <input
          type="checkbox"
          className="pick"
          checked={!!selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Pilih ${file.name}`}
        />
        {img ? (
          <img className="thumb" src={file.thumbnailLink} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <FileBadge mime={file.mimeType} />
        )}
        <span className="fname">{file.name}</span>
        <span className="fmeta hide-sm">{folder ? "folder" : formatBytes(file.size)} · {formatDate(file.modifiedTime)}</span>
        <span
          className="factions"
          onClick={(e) => {
            if (!(e.target instanceof HTMLAnchorElement)) e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!folder ? (
            <a className="iconbtn" href={`/d/${file.id}`} title={`Unduh ${file.name}`} download>UNDUH</a>
          ) : null}
          {me?.admin ? <button className="iconbtn" onClick={onShare} title={`Bagikan ${file.name}`}>BAGIKAN</button> : null}
        </span>
      </a>
    </div>
  );
}

export function UnlockGate({ lock, onDone }: { lock: LockInfo; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.unlock(lock.folderId, password);
      onDone();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Gagal membuka folder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="lockmark" aria-hidden="true" />
      <div className="kicker">Folder terkunci</div>
      <h1 style={{ margin: "0 0 6px" }}>{lock.folderName}</h1>
      <p style={{ color: "var(--ink-2)" }}>Folder ini dilindungi kata sandi. Masukkan untuk melanjutkan.</p>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <form onSubmit={submit}>
        <div className="field" style={{ textAlign: "left" }}>
          <label htmlFor="unlock-pass">Kata sandi</label>
          <input
            id="unlock-pass"
            className="input"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <button className="btn primary" disabled={busy || !password} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Membuka…" : "Buka folder"}
        </button>
      </form>
    </div>
  );
}

function ShareDialog({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const { push } = useToast();
  const [hours, setHours] = useState("72");
  const [maxUses, setMaxUses] = useState("");
  const [downloadOnly, setDownloadOnly] = useState(false);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFolder = kindOf(file.mimeType) === "folder";

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createShare({
        fileId: file.id,
        expiresInHours: hours ? Number(hours) : null,
        maxUses: maxUses ? Number(maxUses) : null,
        downloadOnly,
        password: password || null,
      });
      const url = `${window.location.origin}${res.url}`;
      setResult({ url });
      push("ok", "Share link dibuat.");
      if (await copyText(url)) {
        setCopied(true);
        push("ok", "Tautan disalin otomatis.");
      }
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Gagal membuat share link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isFolder ? "Bagikan folder" : "Bagikan file"} sub={file.name} onClose={onClose}>
      {result ? (
        <>
          <Notice kind="ok">Share link dibuat. Siapa pun yang punya tautan bisa {isFolder ? "menjelajahi folder" : "mengakses file"} ini.</Notice>
          <div className="field">
            <label htmlFor="share-url">Tautan</label>
            <input id="share-url" className="input mono" readOnly value={result.url} onFocus={(e) => e.target.select()} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
            <span style={{ color: "var(--ink-1)" }}>
              <QRCode value={result.url} size={148} bgColor="transparent" fgColor="currentColor" />
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              onClick={async () => {
                const ok = await copyText(result.url);
                setCopied(ok);
                if (ok) push("ok", "Tautan tersalin.");
              }}
            >
              {copied ? "Tersalin ✓" : "Salin tautan"}
            </button>
            <button className="btn ghost" onClick={onClose}>Tutup</button>
          </div>
        </>
      ) : (
        <form onSubmit={create}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="row2">
            <div className="field">
              <label htmlFor="share-exp">Kedaluwarsa (jam)</label>
              <input
                id="share-exp"
                className="input mono"
                inputMode="numeric"
                placeholder="kosong = selamanya"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="share-max">Maks. unduhan</label>
              <input
                id="share-max"
                className="input mono"
                inputMode="numeric"
                placeholder="kosong = tanpa batas"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="share-pass">Kata sandi (opsional)</label>
            <input
              id="share-pass"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="kosong = tanpa kata sandi"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {!isFolder ? (
            <label className="checkrow">
              <input type="checkbox" checked={downloadOnly} onChange={(e) => setDownloadOnly(e.target.checked)} />
              <span>
                <strong>Hanya unduh.</strong>
                <br />
                <span style={{ color: "var(--ink-2)", fontSize: 13 }}>Penerima langsung mengunduh tanpa halaman pratinjau.</span>
              </span>
            </label>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={busy}>{busy ? "Membuat…" : "Buat tautan"}</button>
            <button type="button" className="btn ghost" onClick={onClose}>Batal</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const UPLOAD_MAX = 75 * 1024 * 1024;

// Recursive folder archive guardrails: cap items and total bytes so a big tree
// cannot exhaust browser memory, and bail early when a subfolder is locked.
const ZIP_MAX_FILES = 150;
const ZIP_MAX_DEPTH = 12;

type TreeCollect = { items: DriveFile[]; skipped: number; tooBig: number; truncated: boolean };

async function collectTree(topLevel: DriveFile[]): Promise<TreeCollect> {
  const items: DriveFile[] = [];
  let skipped = 0;
  let tooBig = 0;
  let truncated = false;
  let totalBytes = 0;
  const queue: { id: string; depth: number }[] = [];

  for (const f of topLevel) {
    if (kindOf(f.mimeType) === "folder") {
      queue.push({ id: f.id, depth: 1 });
    } else if (tooBigForZip(Number(f.size || 0))) {
      // Refused up front: a 2.3 GB entry would download as a 0-byte stub.
      tooBig++;
    } else {
      items.push(f);
    }
  }

  while (queue.length > 0 && !truncated) {
    const { id, depth } = queue.shift()!;
    if (depth > ZIP_MAX_DEPTH) continue;
    let children: DriveFile[];
    try {
      children = (await api.files(id)).files;
    } catch (e) {
      if (e instanceof ApiError && e.locked) skipped++;
      else throw e;
      continue;
    }
    for (const c of children) {
      if (kindOf(c.mimeType) === "folder") {
        if (depth < ZIP_MAX_DEPTH) queue.push({ id: c.id, depth: depth + 1 });
      } else {
        const size = Number(c.size || 0);
        if (tooBigForZip(size)) {
          tooBig++;
          continue;
        }
        totalBytes += size;
        if (items.length >= ZIP_MAX_FILES || totalBytes >= ZIP_MAX_BYTES) {
          truncated = true;
          break;
        }
        items.push(c);
      }
    }
  }

  return { items, skipped, tooBig, truncated };
}

function UploadModal({
  initialFolderId,
  crumbs,
  onClose,
  onDone,
}: {
  initialFolderId: string;
  crumbs: Crumb[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [dirId, setDirId] = useState(initialFolderId);
  const [path, setPath] = useState<Crumb[]>(crumbs);
  const [subs, setSubs] = useState<DriveFile[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSubs = useCallback(async (id: string) => {
    setSubs(null);
    try {
      const res = await api.files(id);
      setSubs(res.files.filter((f) => kindOf(f.mimeType) === "folder").sort((a, b) => a.name.localeCompare(b.name)));
      setPath(res.crumbs);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Gagal memuat folder.");
    }
  }, []);

  useEffect(() => { void loadSubs(dirId); }, [dirId, loadSubs]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0 || files.some((f) => f.size > UPLOAD_MAX)) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      let completed = 0;
      for (const f of files) {
        await api.upload(f, dirId, (p) => setProgress((completed + p) / files.length));
        completed++;
      }
      push("ok", `${files.length} file berhasil diunggah.`);
      onDone();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Upload gagal.");
    } finally {
      setBusy(false);
    }
  }

  const here = path.length > 0 ? path[path.length - 1].name : "Arsip";
  const tooBig = files.some((f) => f.size > UPLOAD_MAX);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  return (
    <Modal title="Unggah file" sub={`Tujuan: ${here}`} onClose={onClose}>
      <form onSubmit={submit}>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <nav className="crumbs" aria-label="Folder tujuan">
          {path.map((c, i) => (
            <span key={c.id} style={{ display: "contents" }}>
              {i > 0 ? <span className="sep" aria-hidden="true">/</span> : null}
              {i === path.length - 1 ? (
                <span className="here">{c.name}</span>
              ) : (
                <button type="button" className="crumbbtn" onClick={() => setDirId(c.id)}>{c.name}</button>
              )}
            </span>
          ))}
        </nav>
        {subs === null ? (
          <p className="muted">Memuat folder…</p>
        ) : subs.length === 0 ? (
          <p className="muted">Tidak ada subfolder di lokasi ini.</p>
        ) : (
          <div className="filelist" role="list">
            {subs.map((f) => (
              <button
                key={f.id}
                type="button"
                className="folderrow"
                onClick={() => setDirId(f.id)}
                title={`Pilih ${f.name}`}
              >
                <FileBadge mime={f.mimeType} />
                <span style={{ flex: 1, textAlign: "left" }}>{f.name}</span>
                <span className="sep" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor="up-file">File</label>
          <input
            id="up-file"
            className="input"
            type="file"
            multiple
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setProgress(null); }}
          />
        </div>
        {tooBig ? (
          <Notice kind="error">Ada file lebih dari 75 MB — file per item tidak bisa melebihi batas ini.</Notice>
        ) : files.length > 0 ? (
          <p className="muted">{files.length} file · {formatBytes(totalBytes)} · akan diunggah ke “{here}”</p>
        ) : null}
        {progress !== null ? (
          <div
            className="progressbar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={files.length === 0 || tooBig || busy}>
            {busy ? "Mengunggah…" : `Unggah${files.length > 1 ? ` (${files.length})` : ""}`}
          </button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Batal</button>
        </div>
      </form>
    </Modal>
  );
}
