import { useCallback, useEffect, useState } from "react";
import { ApiError, api, formatBytes, formatDate, kindOf } from "../api";
import type { DriveFile, LockInfo } from "../types";
import { FileBadge, FileCard, ImageLightbox, MediaPlayer, Notice, copyText } from "../components";
import { UnlockGate } from "./Browse";
import { navigate } from "../nav";

export default function FileView({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<DriveFile | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockInfo | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [siblings, setSiblings] = useState<DriveFile[]>([]);
  const [peers, setPeers] = useState<{ id: string; name: string; mimeType: string }[]>([]);
  const [searchCtx, setSearchCtx] = useState<{ folderId: string; query: string } | null>(null);

  // Konteks dari Browse: daftar peer folder + konteks pencarian yang menuju halaman ini.
  useEffect(() => {
    try {
      const rawP = sessionStorage.getItem("zi-peers");
      if (rawP) {
        const { peers: list } = JSON.parse(rawP) as { folderId: string; peers: { id: string; name: string; mimeType: string }[] };
        setPeers(list as { id: string; name: string; mimeType: string }[]);
      } else {
        setPeers([]);
      }
      const rawS = sessionStorage.getItem("zi-last-search");
      if (rawS) setSearchCtx(JSON.parse(rawS) as { folderId: string; query: string });
    } catch { /* ignore */ }
  }, [fileId]);

  // Prev/next antar file se-folder (← / →).
  useEffect(() => {
    if (peers.length < 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (lightbox) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") goPeer(-1);
      else if (e.key === "ArrowRight") goPeer(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const idx = peers.findIndex((p) => p.id === fileId);

  function goPeer(delta: number) {
    const next = peers[idx + delta];
    if (next) navigate(`/f/${next.id}`);
  }

  const load = useCallback(async () => {
    setError(null);
    setLock(null);
    setFile(null);
    setSiblings([]);
    try {
      const res = await api.meta(fileId);
      setFile(res.file);
      setParent(res.file.parents?.[0] ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.locked) setLock(e.locked);
      else setError(e instanceof Error ? e.message : "Gagal memuat file.");
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // File terkait: saudari di folder yang sama. Gagal diam-diam, jangan ganggu halaman.
  useEffect(() => {
    if (!parent || !file) return;
    api.files(parent)
      .then((res) => setSiblings(res.files.filter((f) => f.id !== file.id).slice(0, 8)))
      .catch(() => {});
  }, [parent, file]);

  if (lock) return <UnlockGate key={lock.folderId} lock={lock} onDone={load} />;
  if (error) {
    return (
      <div className="pagehead">
        <Notice kind="error">{error}</Notice>
        <button className="btn" onClick={() => void load()}>Coba lagi</button>
      </div>
    );
  }
  if (!file) return (
    <div>
      <div className="pagehead">
        <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 22, width: "45%", borderRadius: 6, marginTop: 10 }} />
      </div>
      <div className="skeleton" style={{ height: 200, borderRadius: "var(--radius)", marginBottom: 16 }} />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div className="skeleton" style={{ height: 180, borderRadius: "var(--radius)" }} />
        <div className="skeleton" style={{ height: 120, borderRadius: "var(--radius)" }} />
      </div>
    </div>
  );

  const kind = kindOf(file.mimeType);
  const dlUrl = `/d/${file.id}`;
  const pvUrl = `/p/${file.id}`;
  const imgSrc = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, "=s1600") : pvUrl;
  const dims = file.imageMediaMetadata ?? file.videoMediaMetadata;
  const durationSec = file.videoMediaMetadata?.durationMillis ? Math.round(Number(file.videoMediaMetadata.durationMillis) / 1000) : null;
  const media = kind === "video" || kind === "audio" || kind === "image";

  // Album pratinjau: semua gambar se-folder (dari konteks peers Browse).
  const mediaPeers = peers.filter((p) => kindOf(p.mimeType) === "image");
  const album = mediaPeers.map((p) => ({ src: `/p/${p.id}`, alt: p.name }));
  const albumIdx = Math.max(0, mediaPeers.findIndex((p) => p.id === file.id));

  async function copyLink() {
    const ok = await copyText(`${window.location.origin}${dlUrl}`);
    setCopiedLink(ok);
  }

  const preview = kind === "video" ? (
    <div className="player">
      <MediaPlayer kind="video" src={pvUrl} poster={file.thumbnailLink ?? undefined} />
    </div>
  ) : kind === "audio" ? (
    <div className="player">
      <MediaPlayer kind="audio" src={pvUrl} />
    </div>
  ) : kind === "image" ? (
    <button
      className="preview-img"
      style={{ padding: 0, border: "1px solid var(--line-soft)", cursor: "zoom-in", display: "block" }}
      onClick={() => setLightbox(true)}
      aria-label={`Perbesar ${file.name}`}
    >
      <img
        src={imgSrc}
        alt={file.name}
        referrerPolicy="no-referrer"
        style={{ display: "block", maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", margin: "0 auto" }}
      />
    </button>
  ) : kind === "pdf" ? (
    <div className="preview-pdf">
      <iframe src={pvUrl} title={file.name} onLoad={(e) => (e.currentTarget.style.height = "100%")} />
    </div>
  ) : kind === "code" ? (
    <TextPreview url={pvUrl} name={file.name} />
  ) : (
    <div className="preview-fallback">
      <FileBadge mime={file.mimeType} />
      <span>Pratinjau tidak tersedia untuk tipe ini.</span>
      <span className="sub">Unduh file untuk membukanya.</span>
    </div>
  );

  return (
    <>
      {searchCtx ? (
        <button className="backlink" onClick={() => navigate(`/b/${searchCtx.folderId}`)}>
          ← Kembali ke hasil: “{searchCtx.query}”
        </button>
      ) : null}
      {parent ? (
        <button className="backlink" onClick={() => navigate(`/b/${parent}`)}>
          Kembali ke folder
        </button>
      ) : null}
      {peers.length > 0 && idx >= 0 ? (
        <div className="filenav">
          <button className="btn ghost" disabled={idx === 0} onClick={() => goPeer(-1)} aria-label="File sebelumnya">
            ‹ {peers[idx - 1]?.name}
          </button>
          <span className="filenav-count" aria-hidden="true">{idx + 1} / {peers.length}</span>
          <button className="btn ghost" disabled={idx === peers.length - 1} onClick={() => goPeer(1)} aria-label="File berikutnya">
            {peers[idx + 1]?.name} ›
          </button>
        </div>
      ) : null}
      <div className="pagehead">
        <div className="kicker">{kind.toUpperCase()} · {formatBytes(file.size)}</div>
        <h1 style={{ fontSize: "clamp(22px, 3.4vw, 28px)" }}>{file.name}</h1>
      </div>

      <div className="detailgrid two">
        <div style={{ minWidth: 0 }}>{preview}</div>
        <aside className="card infopanel" style={{ minWidth: 0 }}>
          <h2>Info file</h2>
          <dl className="kv">
            <dt>Ukuran</dt><dd>{formatBytes(file.size)}</dd>
            <dt>Tipe</dt><dd>{file.mimeType}</dd>
            {dims?.width && dims?.height ? (
              <><dt>Dimensi</dt><dd>{dims.width} x {dims.height} px</dd></>
            ) : null}
            {durationSec ? (
              <><dt>Durasi</dt><dd>{formatDuration(durationSec)}</dd></>
            ) : null}
            <dt>Diubah</dt><dd>{formatDate(file.modifiedTime)}</dd>
            <dt>ID</dt><dd>{file.id}</dd>
          </dl>
          <div className="actiongrid">
            <button className="btn" onClick={() => void copyLink()}>
              {copiedLink ? "Tersalin" : "Salin tautan"}
            </button>
            <a className="btn primary" href={dlUrl} download>Unduh file</a>
          </div>
          {media ? (
            <a className="btn" href={pvUrl} target="_blank" rel="noreferrer" style={{ width: "100%", marginTop: 8 }}>
              Buka pratinjau
            </a>
          ) : null}
        </aside>
      </div>

      {siblings.length > 0 ? (
        <div className="related">
          <h3>File lain di folder ini</h3>
          <div className="filegrid">
            {siblings.map((s) => (
              <FileCard key={s.id} file={s} />
            ))}
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <ImageLightbox
          items={album.length ? album : [{ src: imgSrc, alt: file.name }]}
          index={album.length ? albumIdx : 0}
          onClose={() => setLightbox(false)}
        />
      ) : null}
    </>
  );
}

function formatDuration(sec: number): string {
  const s = sec % 60;
  const m = Math.floor(sec / 60);
  if (m === 0) return `${s} dtk`;
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} mnt ${s} dtk`;
  return `${h} jam ${m % 60} mnt`;
}

// Pratinjau teks/kode murah: ambil sampai batas, tampilkan polos.
const TEXT_LIMIT = 200_000;

function TextPreview({ url, name }: { url: string; name: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Gagal memuat (${res.status}).`);
        const buf = new Uint8Array(await (await res.blob()).arrayBuffer());
        setText(new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, TEXT_LIMIT)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat pratinjau.");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="preview-fallback"><FileBadge mime="text/plain" /><span>{error}</span></div>;
  if (text === null) return <div className="preview-fallback"><FileBadge mime="text/plain" /><span>Memuat…</span></div>;
  return (
    <div className="preview-code" style={{ position: "relative" }}>
      <pre>{text}</pre>
      {text.length >= TEXT_LIMIT ? (
        <div className="preview-code-truncated">Pratinjau dipotong · {name}</div>
      ) : null}
    </div>
  );
}