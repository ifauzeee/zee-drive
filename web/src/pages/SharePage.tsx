import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, formatBytes, formatDate, kindOf } from "../api";
import type { Crumb, DriveFile } from "../types";
import { FileBadge, MediaPlayer, Notice, PdfPreview } from "../components";

type Meta = {
  kind: "file" | "folder";
  file?: DriveFile;
  folder?: DriveFile;
  downloadOnly: boolean;
};

export default function SharePage({ token }: { token: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pwGate, setPwGate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setPwGate(false);
    try {
      setMeta(await api.shareMeta(token));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setPwGate(true);
        return;
      }
      setError(e instanceof Error ? e.message : "Share link tidak valid.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="loginbox">
        <div className="brand-mark" aria-hidden="true" />
        <h1>Tautan tidak berlaku</h1>
        <Notice kind="error">{error}</Notice>
      </div>
    );
  }
  if (pwGate) {
    return <SharePasswordGate token={token} onUnlocked={load} />;
  }
  if (!meta) return (
    <div className="loginbox" style={{ maxWidth: 560 }}>
      <div className="skeleton" style={{ width: 52, height: 52, borderRadius: 12, margin: "0 auto 16px" }} />
      <div className="skeleton" style={{ height: 12, width: 160, borderRadius: 4, margin: "0 auto 12px" }} />
      <div className="skeleton" style={{ height: 24, width: "70%", borderRadius: 6, margin: "0 auto 16px" }} />
      <div className="skeleton" style={{ height: 48, width: 200, borderRadius: "var(--radius-sm)", margin: "0 auto" }} />
    </div>
  );

  if (meta.kind === "folder" && meta.folder) {
    return <FolderShare token={token} meta={meta} />;
  }
  return <FileShare token={token} meta={meta} />;
}

function SharePasswordGate({ token, onUnlocked }: { token: string; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.shareUnlock(token, password);
      onUnlocked();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Kata sandi salah.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="lockmark" aria-hidden="true" />
      <div className="kicker">Share link terkunci</div>
      <h1 style={{ margin: "0 0 6px" }}>Kata sandi diperlukan</h1>
      <p style={{ color: "var(--ink-2)" }}>Share link ini dilindungi kata sandi. Masukkan untuk melanjutkan.</p>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <form onSubmit={submit}>
        <div className="field" style={{ textAlign: "left" }}>
          <label htmlFor="share-pw">Kata sandi</label>
          <input
            id="share-pw"
            className="input"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <button className="btn primary" disabled={busy || !password} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Memverifikasi…" : "Buka"}
        </button>
      </form>
    </div>
  );
}

/* ---------- file share ---------- */

function FileShare({ token, meta }: { token: string; meta: Meta }) {
  const file = meta.file!;
  const kind = kindOf(file.mimeType);
  const fileUrl = `/s/${encodeURIComponent(token)}`;

  if (meta.downloadOnly) {
    window.location.replace(`${fileUrl}?dl=1`);
  }

  return (
    <div className="loginbox" style={{ maxWidth: 700 }}>
      <div className="brand-mark" aria-hidden="true"></div>
      <div className="kicker">File dibagikan · {kind.toUpperCase()} · {formatBytes(file.size)}</div>
      <h1 style={{ wordBreak: "break-word" }}>{file.name}</h1>
      <p style={{ marginBottom: 24 }}>
        Diubah {formatDate(file.modifiedTime)} · pratinjau dan unduh
      </p>
      {kind === "video" ? (
        <div className="player" style={{ marginBottom: 16, textAlign: "left" }}>
          <MediaPlayer kind="video" src={fileUrl} poster={file.thumbnailLink ?? undefined} />
        </div>
      ) : null}
      {kind === "audio" ? (
        <div className="player" style={{ marginBottom: 16 }}>
          <MediaPlayer kind="audio" src={fileUrl} />
        </div>
      ) : null}
      {kind === "image" ? (
        <a
          className="preview-img"
          style={{ marginBottom: 16, display: "block", border: "1px solid var(--line-soft)", borderRadius: "var(--radius)" }}
          href={`${fileUrl}?dl=1`}
          title={`Unduh ${file.name}`}
        >
          <img src={fileUrl} alt={file.name} style={{ display: "block", width: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: "var(--radius)" }} />
        </a>
      ) : null}
      {kind === "pdf" ? (
        <div style={{ marginBottom: 16 }}>
          <PdfPreview src={fileUrl} name={file.name} downloadHref={`${fileUrl}?dl=1`} />
        </div>
      ) : null}
      <a className="btn primary" href={`${fileUrl}?dl=1`} style={{ fontSize: 16, padding: "12px 28px" }}>
        Unduh {formatBytes(file.size)}
      </a>
      <p className="mono" style={{ marginTop: 20, marginBottom: 0, fontSize: 12, color: "var(--ink-3)" }}>
        Diteruskan lewat Zee-Drive
      </p>
    </div>
  );
}

/* ---------- folder share ---------- */

function FolderShare({ token, meta }: { token: string; meta: Meta }) {
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [listing, setListing] = useState<{ files: DriveFile[]; crumbs: Crumb[] } | null>(null);
  const [lock, setLock] = useState<{ folderId: string; folderName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target?: string) => {
    setError(null);
    setLock(null);
    setListing(null);
    try {
      const res = await api.shareFiles(token, target);
      setFolder(target);
      setListing({ files: res.files, crumbs: res.crumbs });
    } catch (e) {
      if (e instanceof ApiError && e.locked) setLock(e.locked);
      else setError(e instanceof Error ? e.message : "Gagal memuat folder.");
    }
  }, [token]);

  useEffect(() => {
    void load(undefined);
  }, [load]);

  if (lock) return <PublicUnlock token={token} lock={lock} onDone={() => load(folder)} />;
  if (error) {
    return (
      <div className="loginbox">
        <div className="brand-mark" aria-hidden="true"></div>
        <h1>Gagal memuat</h1>
        <Notice kind="error">{error}</Notice>
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="loginbox" style={{ maxWidth: 700 }}>
        <div className="skeleton" style={{ height: 12, width: 160, borderRadius: 4, margin: "0 auto 12px" }} />
        <div className="skeleton" style={{ height: 20, width: "60%", borderRadius: 6, margin: "0 auto 16px" }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: "var(--radius-sm)", marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="loginbox" style={{ maxWidth: 700 }}>
      <div className="brand-mark" aria-hidden="true"></div>
      {listing.crumbs.length > 0 ? (
        <div className="kicker">Folder dibagikan · {listing.crumbs.map((c) => c.name).join(" / ")}</div>
      ) : (
        <div className="kicker">Folder dibagikan</div>
      )}
      <h1 style={{ wordBreak: "break-word" }}>{meta.folder!.name}</h1>
      <p style={{ marginBottom: 20 }}>Berbagi folder publik — klik isi untuk menelusuri.</p>
      {listing.files.length === 0 ? (
        <div className="empty">
          <div className="big" aria-hidden="true">∅</div>
          <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>Folder kosong.</div>
        </div>
      ) : (
        <div className="filelist sharelist" role="list">
          {listing.files.map((f) => {
            const isDir = kindOf(f.mimeType) === "folder";
            return (
              <div key={f.id} style={{ display: "contents" }} role="listitem">
                {isDir ? (
                  <a
                    className="filerow"
                    href="#"
                    onClick={(e) => { e.preventDefault(); void load(f.id); window.scrollTo(0, 0); }}
                    aria-label={`Buka folder ${f.name}`}
                  >
                    <FileBadge mime={f.mimeType} />
                    <span className="fname">{f.name}</span>
                    <span className="fmeta hide-sm">folder</span>
                  </a>
                ) : (
                  <a
                    className="filerow"
                    href={`/s/${encodeURIComponent(token)}?id=${encodeURIComponent(f.id)}&dl=1`}
                    aria-label={`Unduh ${f.name}`}
                  >
                    <FileBadge mime={f.mimeType} />
                    <span className="fname">{f.name}</span>
                    <span className="fmeta hide-sm">{formatBytes(f.size)} · {formatDate(f.modifiedTime)}</span>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
      {listing.crumbs.length > 1 ? (
        <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => void load(undefined)}>
          Ke folder atas
        </button>
      ) : null}
      <p className="mono" style={{ marginTop: 20, marginBottom: 0, fontSize: 12, color: "var(--ink-3)" }}>
        Diteruskan lewat Zee-Drive
      </p>
    </div>
  );
}

function PublicUnlock({ token, lock, onDone }: { token: string; lock: { folderId: string; folderName: string }; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.shareUnlock(token, password, lock.folderId);
      onDone();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Kata sandi salah.");
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
          <label htmlFor="pub-pass">Kata sandi</label>
          <input
            id="pub-pass"
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