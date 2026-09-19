CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  download_only INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_share_links_file ON share_links(file_id);

CREATE TABLE IF NOT EXISTS folder_passwords (
  folder_id TEXT PRIMARY KEY,
  folder_name TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  recursive INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  file_id TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
