# Zee-Drive

[![Website](https://img.shields.io/badge/live-demo-blue.svg)](https://zee-drive.ifauze343-af3.workers.dev)

A lightweight file explorer and media streaming server for Google Drive, built entirely on Cloudflare's free tier. No servers, no databases to manage, no Redis. Just deploy and browse.

## Features

| Area | Capability |
|------|------------|
| Browse | Folder listing, breadcrumbs, thumbnails, search, list/grid views |
| Streaming | Video (range requests + seek), audio, image preview, download proxy |
| Share links | HMAC-signed tokens, expiration, max downloads, download-only mode, revocation |
| Folder protection | Recursive password locks (PBKDF2), unlock pages, service cookies |
| Admin panel | Manage share links and folder locks, Drive quota, activity log, runtime settings |
| Auth | Google OAuth with email whitelist, guest sessions |

## Architecture

```
Browser -> Workers (Hono)
           |-- SPA React (static assets)    / · /b/:id · /f/:id · /s/:token · /admin
           |-- /api/files /api/meta         browse (KV cache -> Drive API)
           |-- /d/:id /p/:id                proxy streaming range from Drive
           |-- /s/:token                    public share link
           |-- /api/share /api/admin/*      D1 (links, passwords, log, config)
           '-- /auth/login /auth/callback   Google OAuth + session cookie
```

| Resource | Free tier limit | Used for |
|----------|----------------|----------|
| Workers | 100k requests/day | entire app |
| KV | 100k reads + 1k writes/day | folder listing cache, rate limiting |
| D1 | 5 GB, 100k writes/day | share links, folder passwords, activity log, settings |
| Google Drive API | free | metadata + download streaming |

Audio/video streams through `fetch` -- no CPU time spent waiting on network, so large media files work within limits. Folder listings are cached in KV for 300 seconds so each request only makes one Drive API call.

## Quick start

### 1. Google credentials

Create an **OAuth 2.0 Client ID** (Web application) in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

- Enable **Google Drive API** and **People API**.
- Set authorized redirect URI to `https://<your-worker>.workers.dev/auth/callback` for production.
- You need `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a `GOOGLE_REFRESH_TOKEN`.

Generate a refresh token with the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) using scope `https://www.googleapis.com/auth/drive.readonly` (check "Use your own OAuth credentials").

Share the root folder (`ROOT_FOLDER_ID`) with **Viewer** access to the email that owns the refresh token.

### 2. Create D1 + KV

```bash
npx wrangler kv namespace create CACHE
npx wrangler d1 create zee-index-db
```

Copy the `id` values from both commands into `wrangler.jsonc` (`kv_namespaces[].id` and `d1_databases[].database_id`).

### 3. Set secrets and variables

**Secrets** (required, stored encrypted by Cloudflare):

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put SESSION_SECRET        # generate: openssl rand -base64 32
npx wrangler secret put SHARE_SECRET_KEY      # generate: openssl rand -base64 32
```

**Variables** in `wrangler.jsonc`: `ROOT_FOLDER_ID`, `ALLOWED_EMAILS` (comma-separated), `CACHE_TTL_SECONDS`, `APP_NAME`.

**Local development**: copy `.dev.vars.example` to `.dev.vars`, fill in the same values, then run `npm run dev`.

### 4. Run migrations

```bash
npx wrangler d1 migrations apply zee-index-db --remote    # production
npm run db:migrate                                         # local
```

### 5. Deploy

```bash
npm run deploy
```

Add the worker's redirect URI to your OAuth Client, then visit `https://zee-drive.<your-account>.workers.dev`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server (worker + assets) |
| `npm run build:web` | Build SPA to `public/` |
| `npm run deploy` | Build + deploy to Cloudflare |
| `npm run db:migrate` / `npm run db:migrate:remote` | Apply D1 migrations |
| `npm test` | Run unit tests (Vitest) |
| `npm run typecheck` | TypeScript type checking |

## API

**Public** (no session required):
- `GET /api/config` -- app name + root folder ID
- `GET /api/s/:token` -- share link metadata
- `GET /s/:token` -- download/stream via share link (increments usage count)
- `GET /share/:token` -- share landing page (SPA)

**Session required**:
- `GET /api/files?folder=` -- folder listing + breadcrumbs (423 if locked)
- `GET /api/meta/:id` -- file/folder details
- `POST /api/folder/unlock` -- unlock a password-protected folder
- `GET /d/:id`, `GET /p/:id` -- download / inline preview (range streaming)

**Admin only**:
- `POST /api/share`, `GET /api/share`, `POST /api/share/revoke`
- `GET/POST /api/admin/passwords`, `POST /api/admin/passwords/remove`
- `GET /api/admin/storage`, `GET/POST /api/admin/config`, `GET /api/admin/activity`
- `GET /api/auth/me` (all sessions)

## Security

- Sessions use HMAC-SHA256 signed JWTs in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
- All file access checks folder protection recursively up the ancestor chain.
- Folder passwords are hashed with PBKDF2-SHA256 (100k iterations + random salt, the Workers runtime cap). bcrypt is unavailable in Workers without dependencies.
- Share tokens are signed with `SHARE_SECRET_KEY`; usage tracked in D1; revocable.
- Rate limiting via KV on unlock and share endpoints.
- CSP, `X-Frame-Options`, and `nosniff` headers set at the worker level.
- Admin access determined by `ALLOWED_EMAILS` -- no user registration or management.

## Out of scope

Intentionally excluded to stay within free tier and keep scope focused: file upload/move/delete, multi-provider support (Dropbox/S3/WebDAV/R2), 2FA, roles beyond admin, API keys, TMDB enrichment, PDF/Office/EPUB viewers, image editor.

## License

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Released under the [MIT License](LICENSE). Copyright (c) 2026 Muhammad Ibnu Fauzi.
