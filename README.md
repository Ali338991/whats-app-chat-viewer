# Keepsake

**Your conversations, kept safe forever.**

Keepsake turns WhatsApp chat exports into a beautiful, searchable archive. People export a chat
(a `.zip` with all its media — often 400–700 MB or more), upload it once to a password-protected
vault, delete it from their phone, and later sign in from any browser to relive the whole
conversation: every message, photo, video, voice note and document.

## Two modes

| | Local mode (`/`) | Vault mode (`/vault`) |
|---|---|---|
| Account | Not needed | Email + password |
| Where data lives | This browser only (IndexedDB) | Cloudflare R2 (files) + Postgres/Neon (metadata) |
| Media | From the opened `.zip` | Streamed from private storage via signed links |
| Use it for | Quick, fully private analysis | Keeping chats forever, freeing up your phone |

Both modes share the same viewer: chat bubbles with inline media, search (Ctrl/⌘+F), clickable
statistics and a "Chat Wrapped" PNG, a custom phrase counter, the Insights dashboard, a
movie-style Replay, and Chat Info (Media / Links / Docs tabs with a lightbox). Light and dark themes,
fully responsive.

### Pages

- `/` — local mode + landing (Sign in / Create account, or Open my vault when signed in)
- `/signup` — create an account (can be closed with `SIGNUPS_ENABLED=false`)
- `/login` — sign in
- `/onboarding` — 3-step welcome: what the vault does → how to export (iPhone / Android) → upload your first chat
- `/vault` — your chats, storage usage, upload, delete/rename
- `/admin` — user management (admins only)

## Architecture

```
Browser ──(small JSON)──▶ Next.js route handlers (Vercel) ──▶ Postgres (Neon, via Prisma 7)
   │                                │
   │                                └─ signs short-lived R2 URLs (local HMAC, no network)
   │
   └──(file bytes, direct)──▶ Cloudflare R2  (PUT on upload, GET when viewing)
```

- **Next.js 16 App Router** (JavaScript, React 19). Auth is checked inside every route handler and
  server component (no proxy/middleware).
- **Auth**: email + password (bcrypt, cost 12), HS256 JWT session cookie (`ks_session`, httpOnly,
  SameSite=Lax, Secure in production, 30 days). Each user has a `sessionVersion`; resetting a
  password or disabling an account bumps it and revokes every session. 5 consecutive failed
  sign-ins lock the account for 15 minutes.
- **Database**: Prisma 7.10 with the `@prisma/adapter-pg` driver adapter. Schema in
  `prisma/schema.prisma`, datasource URL in `prisma.config.mjs`, client generated to
  `lib/generated/prisma` (gitignored; created by `postinstall` / `build`).
- **Storage**: Cloudflare R2 through `aws4fetch` (`lib/r2.js`). Object keys are ASCII-only and
  namespaced per user and chat: `u/{userId}/c/{chatId}/chat.txt` and
  `u/{userId}/c/{chatId}/m/{index}_{sanitized-name}` (the original filename is kept in the DB).

### The large-file strategy (why nothing big touches Vercel)

Vercel functions accept/return at most ~4.5 MB per request, and a WhatsApp export can be
hundreds of MB. So file bytes **never** pass through our API:

1. **Random-access unzip in the browser** (`lib/unzip.js`). `openZip()` reads only the archive's
   tail (End Of Central Directory, incl. ZIP64) and then just the central directory — via
   `Blob.slice`, so the archive is never loaded into memory. `readEntry()` returns a zero-copy
   slice for stored entries (WhatsApp media usually are) or streams deflated entries through
   `DecompressionStream`.
2. **Direct-to-R2 uploads** (`lib/vaultUpload.js`). The browser creates the chat
   (`POST /api/vault/chats`, quota-checked, status `UPLOADING`), asks for presigned PUT URLs in
   batches of ≤200, and uploads each media file straight to R2 — 6 in parallel, 3 retries with
   exponential backoff (re-signing on retry), byte-level progress, speed and ETA, cancel. The chat
   text is uploaded last, then `POST …/complete` registers the media and flips the chat to `READY`.
   Until then the chat is hidden from the viewer. Failed uploads are marked `FAILED` and can be
   deleted from the list; cancelled uploads are removed automatically.
3. **Instant media when viewing.** `GET /api/vault/chats/[id]` returns the chat metadata, a
   presigned URL for the chat text, and **every media file with a ready-made presigned GET URL**
   (24 h, correct `Content-Type`). Signing is pure local HMAC, so thousands of links take a few
   hundred ms. The browser downloads the text and media straight from R2 (images lazy-load; video
   and audio use `preload="none"` and stream with range requests). If a link fails (e.g. after a
   very long session) or the chat has been open ~20 h, the client re-fetches the detail once and
   swaps in fresh URLs. For very large chats (>5,000 files) the links are sent in a compact form
   (shared query + per-file signature) to stay well under the response limit.
4. `GET /api/vault/media/[id]?download=1` checks ownership and 302-redirects to a signed URL with
   `Content-Disposition: attachment` and the original filename — used for downloads.

## Setup

### 1. Environment variables

Copy `.env.example` to `.env.local` (for local dev) and set the same keys on Vercel.

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (the pooled URL works) |
| `AUTH_SECRET` | Session signing secret — `openssl rand -base64 32` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First-admin bootstrap credentials (see below) |
| `SIGNUPS_ENABLED` | `true` (default) or `false` to close public sign-up |
| `DEFAULT_STORAGE_LIMIT_GB` | Quota for new self-service accounts (default `5`; `0` = unlimited) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API token credentials (Object Read & Write on the bucket) |
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | *Optional* — override the S3 endpoint (e.g. a local MinIO for development) |

> The old `CLOUDINARY_*` variables are no longer used — delete them from `.env.local` and Vercel.

### 2. Database (Neon)

1. Create a project at [neon.tech](https://neon.tech) and copy the connection string into `DATABASE_URL`.
2. Apply the migrations:

```bash
npm install
npm run db:migrate      # prisma migrate deploy
```

During development, after changing `prisma/schema.prisma`, run `npm run db:dev` (`prisma migrate dev`)
to create a new migration.

### 3. Cloudflare R2

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `keepsake-media`). Keep it private
   (no public access needed — everything uses signed URLs).
2. **R2 → Manage API tokens → Create API token** with *Object Read & Write* for that bucket.
   Copy the Access Key ID and Secret Access Key, plus your Account ID.
3. **Bucket → Settings → CORS policy** — required so the browser can upload and read directly:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add any custom domain you use to `AllowedOrigins`.

### 4. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy on Vercel

1. Push the repo to GitHub and import it at [vercel.com/new](https://vercel.com/new) (Next.js is auto-detected).
2. In **Project Settings → Environment Variables**, add every variable from the table above
   (`DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `R2_*`, and optionally
   `SIGNUPS_ENABLED` / `DEFAULT_STORAGE_LIMIT_GB`).
3. Run the migrations against the production database once (and after every schema change):
   `DATABASE_URL="<neon url>" npm run db:migrate` from your machine.
4. Deploy. The build runs `prisma generate && next build`.
5. Add your production URL to the R2 CORS `AllowedOrigins`.

## First admin (bootstrap)

While the `User` table is empty, signing in at `/login` with exactly `ADMIN_EMAIL` /
`ADMIN_PASSWORD` creates that account as **ADMIN** and signs you in. After that the env values are
ignored for login (you can remove `ADMIN_PASSWORD` from the environment if you like).

## Admin

`/admin` (admins only; linked from the user menu in the vault) lists every user with chat count
and storage used vs quota. Admins can:

- create users (first name, last name, email, password, role, quota in GB) — works even when sign-ups are closed
- reset a password (signs that user out everywhere)
- change the storage quota (empty = unlimited)
- promote/demote admins, enable/disable accounts (disabling signs them out), unlock a locked account
- delete a user — removes all of their stored files from R2, then the account and its data

An admin can't delete, disable or demote themselves.

## Privacy notes

- Local mode never uploads anything.
- In vault mode, chats are private to their owner: every API checks ownership and returns 404
  otherwise; media links are short-lived signed URLs. R2 encrypts objects at rest.
- If you offer this publicly, publish a privacy policy describing that users' chats are stored
  in your R2 bucket and database.
