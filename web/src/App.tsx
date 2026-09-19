import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, formatBytes } from "./api";
import type { Crumb, Me } from "./types";
import { navigate, usePath } from "./nav";
import { Notice, Spinner, SkeletonRow, ToastProvider, ErrorBoundary, useToast } from "./components";
import FolderTree from "./components/FolderTree";
import Browse from "./pages/Browse";
import FileView from "./pages/FileView";
import Login from "./pages/Login";
import SharePage from "./pages/SharePage";
import Admin from "./pages/Admin";

type Boot = { appName: string; rootFolderId: string; guestLogin: boolean } | null;

export default function App() {
  const path = usePath();
  const [isMobile, setIsMobile] = useState<boolean>(() => window.innerWidth <= 640);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [boot, setBoot] = useState<Boot>(null);
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const activeFolderRef = useRef<string | null>(null);

  if (isMobile) return <MobileNotice />;

  const reloadMe = useCallback(async () => {
    try {
      const res = await api.me();
      setMe(res.user);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cfg] = await Promise.all([api.config(), reloadMe()]);
        void cfg;
        setBoot({ appName: cfg.appName, rootFolderId: cfg.rootFolderId, guestLogin: cfg.guestLogin });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat konfigurasi.");
      }
    })();
  }, [reloadMe]);

  if (error) {
    return (
      <div className="wrap" style={{ paddingTop: 48 }}>
        <Notice kind="error">{error}</Notice>
        <p style={{ color: "var(--ink-2)" }}>
          Periksa <code>wrangler secret</code> dan binding D1/KV di <code>wrangler.jsonc</code>.
        </p>
      </div>
    );
  }
  if (!boot || me === undefined) {
    return (
      <div className="wrap" style={{ paddingTop: 8 }}>
        <div className="pagehead">
          <div className="skeleton" style={{ height: 12, width: 120, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 28, width: "40%", borderRadius: 6, marginTop: 10 }} />
        </div>
        <div className="filelist">
          <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
        </div>
      </div>
    );
  }

  const loggedIn = me !== null;

  // Public share landing page needs no session. Media bytes stay under /s/:token.
  if (path.startsWith("/share/")) {
    const token = decodeURIComponent(path.slice("/share/".length));
    return (
      <ToastProvider>
        <OfflineWatcher />
        <ErrorBoundary><Shell appName={boot.appName} me={me} rootId={boot.rootFolderId}><SharePage token={token} /></Shell></ErrorBoundary>
      </ToastProvider>
    );
  }

  if (!loggedIn) return <Login appName={boot.appName} guestLogin={boot.guestLogin} />;

  let page: ReactNode;
  if (path === "/" || path === "") {
    navigate(`/b/${boot.rootFolderId}`);
    page = <Spinner />;
  } else if (path.startsWith("/b/")) {
    page = <Browse folderId={decodeURIComponent(path.slice(3)) || boot.rootFolderId} me={me} key={path} onPath={({ folderId, crumbs }) => { setCrumbs(crumbs); activeFolderRef.current = folderId; }} />;
  } else if (path.startsWith("/f/")) {
    page = <FileView fileId={decodeURIComponent(path.slice(3))} key={path} />;
  } else if (path === "/admin") {
    page = me?.admin ? <Admin key="admin" /> : <Notice kind="error">Akses admin diperlukan.</Notice>;
  } else {
    page = <Notice kind="error">Halaman tidak ditemukan.</Notice>;
  }

  const activeFolder = path.startsWith("/b/") ? decodeURIComponent(path.slice(3)) || boot.rootFolderId : activeFolderRef.current ?? boot.rootFolderId;
  const tree = <FolderTree rootId={boot.rootFolderId} activeId={activeFolder} crumbs={crumbs} open={treeOpen} onClose={() => setTreeOpen(false)} />;

  return (
    <ToastProvider>
      <OfflineWatcher />
      <ErrorBoundary><Shell appName={boot.appName} me={me} rootId={boot.rootFolderId} tree={tree} treeOpen={treeOpen} onTreeToggle={() => setTreeOpen((o) => !o)}>{page}</Shell></ErrorBoundary>
    </ToastProvider>
  );
}

function Shell({
  appName,
  me,
  rootId,
  tree,
  treeOpen,
  onTreeToggle,
  children,
}: {
  appName: string;
  me: Me;
  rootId: string;
  tree?: ReactNode;
  treeOpen?: boolean;
  onTreeToggle?: () => void;
  children: ReactNode;
}) {
  const path = usePath();
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme || "dark");
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("zi-theme", next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#000000" : "#f7f7f5");
    setTheme(next);
  };
  return (
    <>
      <a href="#main-content" className="skip-link">Langkah ke konten utama</a>
      <header className="topbar">
        <div className="topbar-rail">
          {tree ? (
            <button
              className="tree-toggle"
              onClick={onTreeToggle}
              aria-controls="folder-tree"
              aria-expanded={treeOpen}
              title="Pohon folder"
              aria-label="Tampilkan atau sembunyikan pohon folder"
            >
              <MenuGlyph />
            </button>
          ) : null}
          <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate(`/b/${rootId}`); }} title="Beranda">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">{appName}</span>
          </a>
        </div>
        <div className="wrap topbar-main">
          <div className="topbar-actions">
            <a
              className="github-link"
              href="https://github.com/ifauzeee/zee-drive"
              target="_blank"
              rel="noopener noreferrer"
              title="Kode sumber di GitHub"
              aria-label="Buka repositori GitHub"
            >
              <GithubGlyph />
            </a>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === "dark" ? "Mode terang" : "Mode gelap"}
              aria-label={theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
            >
              <span key={theme} className="theme-icon">
                {theme === "dark" ? <SunGlyph /> : <MoonGlyph />}
              </span>
            </button>
          </div>
        </div>
      </header>
      <div className="layout">
        {tree ? (
          <div id="folder-tree" className={`treebar ${treeOpen ? "open" : ""}`}>
            <div className="tree-scrim" onClick={onTreeToggle} aria-hidden="true" />
            <div className="tree-nav">
              {me ? (
                <div className="profile-card" title={me.email}>
                  {me.picture ? <img src={me.picture} alt="" referrerPolicy="no-referrer" /> : null}
                  <div className="profile-meta">
                    <span className="profile-name">{me.name}</span>
                    {me.admin ? <span className="admin-badge">ADMIN</span> : null}
                  </div>
                  <a href="/logout" className="profile-logout" title="Keluar" aria-label="Keluar">
                    <LogoutGlyph />
                  </a>
                </div>
              ) : (
                <a className="navlink" href="/auth/login">Masuk</a>
              )}
              <nav aria-label="Navigasi utama">
                <a
                  className={`navlink ${path.startsWith("/b/") || path.startsWith("/f/") ? "active" : ""}`}
                  href={`/b/${rootId}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/b/${rootId}`); }}
                >
                  Arsip
                </a>
                {me?.admin ? (
                  <a
                    className={`navlink ${path === "/admin" ? "active" : ""}`}
                    href="/admin"
                    onClick={(e) => { e.preventDefault(); navigate("/admin"); }}
                  >
                    Admin
                  </a>
                ) : null}
              </nav>
              <div className="tree-nav-foot">
                <PwaInstallButton />
              </div>
            </div>
            {tree}
          </div>
        ) : null}
        <main id="main-content" className="wrap layout-main">{children}</main>
      </div>
      <footer className="app-footer">
        <p>
          &copy; {new Date().getFullYear()} — Dibuat oleh{" "}
          <a
            href="https://ifauzeee.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="app-footer-link"
          >
            Muhammad Ibnu Fauzi
          </a>
        </p>
        <p className="app-footer-quota">
          <QuotaBadge />
        </p>
      </footer>
    </>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function usePwaInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  const run = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { /* batal oleh browser */ }
    setPrompt(null);
  };
  return { show: prompt !== null, run };
}

function OfflineWatcher() {
  const { push } = useToast();
  const notified = useRef(false);
  useEffect(() => {
    const off = () => {
      if (!notified.current) { notified.current = true; push("info", "Anda sedang offline — konten ter-cache tetap tersedia."); }
    };
    const on = () => { notified.current = false; };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [push]);
  return null;
}

function QuotaBadge() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .quota()
      .then((q) => {
        if (cancelled) return;
        if (q.limit > 0 && q.usage >= 0) {
          setText(`${formatBytes(q.usage)} dari ${formatBytes(q.limit)} · ${Math.round(q.percent * 100)}%`);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return text ? <span className="quota-badge mono">{text}</span> : null;
}

function PwaInstallButton() {
  const { show, run } = usePwaInstall();
  return !show ? null : (
    <button className="install-link" onClick={() => void run()} title="Pasang aplikasi di perangkat">
      Pasang App
    </button>
  );
}

function SunGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <radialGradient id="zi-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff7ed" stopOpacity="1" />
          <stop offset="55%" stopColor="#fbbf24" stopOpacity="1" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="1" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="4.2" fill="url(#zi-sun)" stroke="none" />
      <circle cx="12" cy="12" r="6.4" strokeOpacity="0.35" />
      <path d="M12 2.2v2.1M12 19.7v2.1M2.2 12h2.1M19.7 12h2.1M5.1 5.1l1.5 1.5M17.4 17.4l1.5 1.5M5.1 18.9l1.5-1.5M17.4 6.6l1.5-1.5" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <linearGradient id="zi-moon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c7d2fe" stopOpacity="1" />
          <stop offset="55%" stopColor="#818cf8" stopOpacity="1" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="url(#zi-moon)" fillOpacity="0.55" />
      <path d="M17.5 5.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z" fill="currentColor" stroke="none" opacity="0.8" />
    </svg>
  );
}

function GithubGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.2c0 4.5 2.87 8.33 6.84 9.68.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.61-3.37-1.35-3.37-1.35-.45-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.2 10.2 0 0 0 22 12.2C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

function MenuGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function MobileNotice() {
  return (
    <div className="mobile-notice" role="alert">
      <div className="brand-mark mobile-notice-mark" aria-hidden="true" />
      <h1>Zee-Drive</h1>
      <p>Versi mobile sedang dirapikan. Buka lewat perangkat desktop (laptop / PC) beberapa saat lagi.</p>
    </div>
  );
}

function LogoutGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
