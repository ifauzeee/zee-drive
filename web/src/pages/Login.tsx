import { useState } from "react";
import { api } from "../api";

export default function Login({ appName, guestLogin }: { appName: string; guestLogin: boolean }) {
  const [showLocal, setShowLocal] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitLocal(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.localAdminLogin(username, password);
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Login gagal.");
    } catch {
      setError("Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-visual">
        <div className="login-visual-icon logo-mask" aria-hidden="true" />
      </div>

      <div className="login-panel">
        <div className="login-panel-inner">
          <h1 className="login-title">
            <span className="login-title-icon logo-mask" aria-hidden="true" />
            <span className="login-title-text">{appName}</span>
          </h1>
          <p className="login-subtitle">
            Jelajahi dan streaming isi Google Drive lewat antarmuka yang cepat.
          </p>

          <div className="login-form">
            <button className="btn btn-google btn-full" style={{ width: "100%" }} onClick={() => { window.location.href = "/auth/login"; }}>
              <GoogleGlyph />
              <span>Lanjutkan dengan Google</span>
            </button>
            {guestLogin ? (
              <button className="btn btn-ghost btn-full" style={{ width: "100%" }} onClick={() => { window.location.href = "/auth/guest"; }}>
                <span>Masuk sebagai Tamu</span>
              </button>
            ) : null}
            {showLocal ? (
              <form onSubmit={submitLocal} style={{ display: "grid", gap: 8, width: "100%" }}>
                <input
                  className="select"
                  type="text"
                  autoComplete="username"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-label="Username"
                />
                <input
                  className="select"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-label="Password"
                />
                {error ? <p style={{ margin: 0, color: "var(--danger, #e5484d)", fontSize: 13 }}>{error}</p> : null}
                <button className="btn btn-full" type="submit" disabled={busy || !username || !password} style={{ width: "100%" }}>
                  {busy ? "Memeriksa…" : "Masuk"}
                </button>
              </form>
            ) : (
              <button className="btn btn-ghost btn-full" style={{ width: "100%" }} onClick={() => setShowLocal(true)}>
                <span>Masuk dengan akun lokal</span>
              </button>
            )}
          </div>

          <p className="login-footer">
            &copy; {new Date().getFullYear()} &mdash; Dibuat oleh{" "}
            <a
              href="https://ifauzeee.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="login-footer-link"
            >
              Muhammad Ibnu Fauzi
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}