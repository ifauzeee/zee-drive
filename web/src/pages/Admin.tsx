import { useEffect, useState, type FormEvent } from "react";
import { api, formatBytes, formatTs } from "../api";
import type { Activity, FolderPassword, ShareLink } from "../types";
import { Empty, Notice, SkeletonTable, useToast } from "../components";

type Tab = "shares" | "passwords" | "storage" | "activity" | "config";

export default function Admin() {
  const [tab, setTab] = useState<Tab>("shares");
  return (
    <>
      <div className="pagehead">
        <div className="kicker">Administrasi</div>
        <h1>Panel admin</h1>
        <p>Kelola tautan berbagi, proteksi folder, kuota penyimpanan, dan log aktivitas.</p>
      </div>
      <StatsRow />
      <div className="tabs" role="tablist" aria-label="Bagian admin">
        {(
          [
            ["shares", "Share link"],
            ["passwords", "Password folder"],
            ["storage", "Penyimpanan"],
            ["activity", "Aktivitas"],
            ["config", "Pengaturan"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "shares" ? <SharesTab /> : null}
      {tab === "passwords" ? <PasswordsTab /> : null}
      {tab === "storage" ? <StorageTab /> : null}
      {tab === "activity" ? <ActivityTab /> : null}
      {tab === "config" ? <ConfigTab /> : null}
    </>
  );
}

function StatsRow() {
  const [stats, setStats] = useState<{ shares: number; storagePct: number; activity: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, st, a] = await Promise.all([api.shares(), api.storage(), api.activity()]);
        const active = s.links.filter((l) => l.revoked === 0 && (l.expires_at === null || Date.now() / 1000 < l.expires_at) && (l.max_uses === null || l.uses < l.max_uses)).length;
        setStats({ shares: active, storagePct: Math.min(100, Math.round(st.percent * 100)), activity: a.activity.length });
      } catch {
        setStats({ shares: 0, storagePct: 0, activity: 0 });
      }
    })();
  }, []);

  if (!stats) {
    return (
      <div className="statgrid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="statgrid">
      <div className="stat">
        <div className="value">{stats.shares}</div>
        <div className="label">Share link aktif</div>
      </div>
      <div className="stat">
        <div className={`value ${stats.storagePct >= 80 ? "warn" : ""}`}>{stats.storagePct}%</div>
        <div className="label">Penyimpanan terpakai</div>
      </div>
      <div className="stat">
        <div className="value">{stats.activity}</div>
        <div className="label">Entri aktivitas</div>
      </div>
    </div>
  );
}

function SharesTab() {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  async function load() {
    try {
      setLinks((await api.shares()).links);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat share link.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!links) return <div className="card"><SkeletonTable /></div>;
  if (links.length === 0) {
    return (
      <Empty
        title="Belum ada share link."
        hint="Buat dari tombol BAGIKAN di daftar file."
      />
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>File</th>
            <th>Dibuat</th>
            <th>Kedaluwarsa</th>
            <th>Pakai</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => {
            const expired = l.expires_at !== null && Date.now() / 1000 > l.expires_at;
            const usedUp = l.max_uses !== null && l.uses >= l.max_uses;
            const dead = l.revoked === 1 || expired || usedUp;
            return (
              <tr key={l.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.file_name || l.file_id}</div>
                  <div className="mono" style={{ color: "var(--ink-3)" }}>{l.id}</div>
                </td>
                <td className="mono">{formatTs(l.created_at)}</td>
                <td className="mono">{l.expires_at ? formatTs(l.expires_at) : "∞"}</td>
                <td className="mono">{l.uses}{l.max_uses !== null ? ` / ${l.max_uses}` : ""}</td>
                <td>
                  <span className={`pill ${dead ? "bad" : "ok"}`}>
                    {l.revoked === 1 ? "dicabut" : expired ? "kedaluwarsa" : usedUp ? "habis" : "aktif"}
                  </span>
                  {l.download_only === 1 ? <span className="pill" style={{ marginLeft: 6 }}>unduh saja</span> : null}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {!dead ? (
                    <button
                      className="iconbtn"
                      style={{ color: "var(--red)" }}
                      onClick={() => {
                        if (!confirm(`Cabut share link "${l.file_name || l.file_id}"? Tautan langsung mati.`)) return;
                        void (async () => {
                          const prev = links;
                          setLinks((ls) => ls?.map((x) => (x.id === l.id ? { ...x, revoked: 1 } : x)) ?? null);
                          try {
                            await api.revokeShare(l.id);
                            push("ok", "Share link dicabut.");
                          } catch {
                            setLinks(prev);
                            push("error", "Gagal mencabut share link.");
                          }
                        })();
                      }}
                    >
                      CABUT
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PasswordsTab() {
  const [rows, setRows] = useState<FolderPassword[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  async function load() {
    try {
      setRows((await api.passwords()).passwords);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setPassword({ folderId: folderId.trim(), password, recursive: true });
      setFolderId("");
      setPassword("");
      await load();
      push("ok", "Folder dikunci.");
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detailgrid two">
      <div className="card">
        <h2>Folder terkunci</h2>
        <p className="sub">Proteksi berlaku rekursif ke seluruh isi folder.</p>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {!rows ? (
          <SkeletonTable rows={3} />
        ) : rows.length === 0 ? (
          <Empty title="Belum ada folder terkunci." />
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Folder</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.folderId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.folderName || r.folderId}</div>
                    <div className="mono" style={{ color: "var(--ink-3)" }}>{r.folderId}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="iconbtn"
                      style={{ color: "var(--red)" }}
                      onClick={async () => {
                        const prev = rows;
                        setRows((rs) => rs?.filter((x) => x.folderId !== r.folderId) ?? null);
                        try {
                          await api.removePassword(r.folderId);
                          push("ok", `Proteksi ${r.folderName || r.folderId} dihapus.`);
                        } catch {
                          setRows(prev);
                          push("error", "Gagal menghapus proteksi.");
                        }
                      }}
                    >
                      HAPUS
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Kunci folder</h2>
        <p className="sub">Tempel ID folder dari URL Drive. Minimal 4 karakter.</p>
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="pw-folder">ID folder</label>
            <input id="pw-folder" className="input mono" value={folderId} onChange={(e) => setFolderId(e.target.value)} placeholder="1AbC…" />
          </div>
          <div className="field">
            <label htmlFor="pw-pass">Kata sandi</label>
            <input id="pw-pass" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn primary" disabled={busy || folderId.trim().length < 3 || password.length < 4}>
            {busy ? "Menyimpan…" : "Kunci folder"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StorageTab() {
  const [data, setData] = useState<{ limit: number; usage: number; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.storage());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat kuota.");
      }
    })();
  }, []);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <div className="card">
    <div className="skeleton" style={{ height: 18, width: 180, borderRadius: 4, marginBottom: 8 }} />
    <div className="skeleton" style={{ height: 12, width: 240, borderRadius: 4, marginBottom: 16 }} />
    <div className="skeleton" style={{ height: 8, borderRadius: "var(--radius-full)" }} />
    <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4, marginTop: 10 }} />
  </div>;

  const pct = Math.min(100, Math.round(data.percent * 100));
  return (
    <div className="card">
      <h2>Kuota Google Drive</h2>
      <p className="sub">Terpakai {formatBytes(data.usage)} dari {data.limit > 0 ? formatBytes(data.limit) : "tanpa batas"}.</p>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Pemakaian penyimpanan">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="mono" style={{ color: "var(--ink-2)", fontSize: 13 }}>{pct}% terpakai</p>
    </div>
  );
}

function ActivityTab() {
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRows((await api.activity()).activity);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat log.");
      }
    })();
  }, []);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!rows) return <div className="card" style={{ padding: 0, overflowX: "auto" }}><SkeletonTable rows={6} /></div>;
  if (rows.length === 0) return <Empty title="Belum ada aktivitas tercatat." />;

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 14px 0" }}>
        <a className="btn" href="/api/admin/activity?format=csv" download>Unduh CSV</a>
      </div>
      <table className="table">
        <thead>
          <tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{formatTs(r.ts)}</td>
              <td className="mono">{r.actor}</td>
              <td><span className="pill">{r.action}</span></td>
              <td className="mono">{[r.file_id, r.detail].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigTab() {
  const [cfg, setCfg] = useState<{ appName: string; rootFolderId: string; cacheTtl: number; maintenance: boolean; guest: boolean } | null>(null);
  const { push } = useToast();

  useEffect(() => {
    (async () => {
      setCfg((await api.adminConfig()).config);
    })();
  }, []);

  if (!cfg) return <div className="card">
    <div className="skeleton" style={{ height: 18, width: 140, borderRadius: 4, marginBottom: 8 }} />
    <div className="skeleton" style={{ height: 12, width: 300, borderRadius: 4, marginBottom: 16 }} />
    <div className="skeleton" style={{ height: 12, width: "80%", borderRadius: 4, marginBottom: 8 }} />
    <div className="skeleton" style={{ height: 12, width: "60%", borderRadius: 4, marginBottom: 16 }} />
    <div className="skeleton" style={{ height: 36, width: "100%", borderRadius: "var(--radius-sm)", marginBottom: 10 }} />
    <div className="skeleton" style={{ height: 36, width: "100%", borderRadius: "var(--radius-sm)" }} />
  </div>;

  async function toggle(key: "maintenance" | "guest", value: boolean) {
    const prev = cfg;
    setCfg({ ...cfg!, [key]: value });
    try {
      await api.saveConfig({ [key]: value });
      push("ok", "Pengaturan tersimpan.");
    } catch {
      setCfg(prev);
      push("error", "Gagal menyimpan pengaturan.");
    }
  }

  return (
    <div className="card">
      <h2>Pengaturan</h2>
      <p className="sub">Opsi runtime tersimpan di D1. Kredensial tetap lewat secret/vars.</p>
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Nama app</dt><dd>{cfg.appName}</dd>
        <dt>Root folder</dt><dd>{cfg.rootFolderId}</dd>
        <dt>Cache TTL</dt><dd>{cfg.cacheTtl}s</dd>
      </dl>
      <label className="checkrow">
        <input type="checkbox" checked={cfg.maintenance} onChange={(e) => void toggle("maintenance", e.target.checked)} />
        <span><strong>Mode pemeliharaan.</strong><br /><span style={{ color: "var(--ink-2)", fontSize: 13 }}>Ditampilkan saat worker dimatikan sementara.</span></span>
      </label>
      <label className="checkrow">
        <input type="checkbox" checked={cfg.guest} onChange={(e) => void toggle("guest", e.target.checked)} />
        <span><strong>Ijinkan tamu.</strong><br /><span style={{ color: "var(--ink-2)", fontSize: 13 }}>Nonaktifkan bila hanya admin yang boleh masuk.</span></span>
      </label>
    </div>
  );
}
