# Deployment — Vercel (frontend) + Render (backend + Postgres)

The repo is configured for this split: the Next.js app deploys on Vercel; the Express API runs as a Render Web Service, the background worker as a separate Render Worker service, and the database on Render PostgreSQL (all defined in `render.yaml`). `frontend/vercel.json` and `render.yaml` at the repo root contain the build and start commands.

## 1. Database — Render PostgreSQL

1. Create a **PostgreSQL** instance on Render (free tier works for evaluation; pick a paid tier for real use).
2. Note the **Internal Database URL** (used when the API runs on Render) and the **External URL** (for migrations from your machine).

## 2. Object storage (required in production)

Render's filesystem is ephemeral — uploaded documents must live in S3-compatible storage:

1. Create a bucket (AWS S3, Cloudflare R2, Backblaze B2, …).
2. Create access keys limited to that bucket (put/get/delete).
3. Fill `STORAGE_*` variables in the service env (see ENVIRONMENT.md).

Demo documents from the seed dataset need no storage — they carry their content inline in the database.

## 3. Backend — Render Web Service

1. **New → Web Service**, connect the repository.
2. Root directory: `backend` (or rely on `render.yaml` from the repo root).
3. Build command: `npm ci && npm run build` (`prisma generate` + `tsc`, matching `render.yaml`)
   — migrations run in the start command on every deploy (safe).
4. Start command: `npx prisma migrate deploy && node dist/index.js` — runs migrations, then the API only. The background worker is a separate service (step 5).
5. Worker — Render Background Worker: `render.yaml` defines `lumen-worker` (same build; start command `node dist/worker.js`). If configuring manually: **New → Background Worker**, same repo, root directory `backend`, and the same env vars as the API — `AUTH_SECRET` must be identical. Document processing, extraction, questionnaire drafting, and scheduled reports do not run until this service is up.
6. Environment: fill every variable from `backend/.env.example`:
   * `DATABASE_URL` — the **Internal** Render Postgres URL (+ `?sslmode=require` if the provider requires it)
   * `AUTH_SECRET` — 48+ random bytes (see ENVIRONMENT.md)
   * `FRONTEND_URL` — your Vercel URL (set after the frontend deploy in §4, then re-deploy the backend)
   * `ALLOWED_ORIGINS` — same URL, plus `https://*.vercel.app` preview patterns if wanted
   * `SMTP_*` + `MAIL_FROM` — transactional email
   * `AI_PROVIDER_API_KEY`, `AI_BASE_URL`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`
   * `STORAGE_*` — bucket from step 2
   * `NODE_ENV=production`, `MAIL_DEV_MODE` unset/false
7. Deploy. Verify `https://<service>.onrender.com/api/health` returns `{ ok: true }`. Seed the demo dataset once: open the `lumen-api` service's **Shell** in the Render dashboard and run `npx prisma db seed` (idempotent — it only inserts what's missing).

## 4. Frontend — Vercel

1. **Add New → Project**, import the repo. Vercel auto-detects Next.js; if configuring manually, set the **Root Directory** to `frontend`.
2. Environment variable: `NEXT_PUBLIC_API_URL` = `https://<service>.onrender.com` (no trailing slash).
3. Deploy. Then set the backend's `FRONTEND_URL` / `ALLOWED_ORIGINS` to the production Vercel URL and redeploy the backend so CORS, invitation links, and password-reset links point to the right origin.

## 5. Post-deploy checklist

* Register a user — the verification code email arrives (if SMTP is configured; use `MAIL_DEV_MODE` only in dev).
* Create a workspace via onboarding; confirm the seeded **demo data is clearly labeled** and separate from new uploads.
* Upload a small PDF → Library shows it processing → Viewer shows summary/structure when done.
* Ask the Assistant a question about the demo documents → answer streams with citations; click a citation chip → evidence panel shows the excerpt.
* Run an extraction from a built-in template → review a low-confidence value → verify it.
* Analytics → open the demo entity → quarterly bars render with derivation badges.
* Sign in on a second device, sign out on the first — the first device's session is revoked (device-scoped refresh tokens).

## Operations notes

* **Migrations**: `prisma migrate deploy` runs in the start command, so schema changes ship atomically with the code that needs them.
* **Worker**: runs as its own Render service (`lumen-worker`, start `node dist/worker.js`) with the same env as the API (`AUTH_SECRET` must match). Locally, run it alongside the API with `npm run dev:worker`.
* **Backups**: enable Render Postgres automated backups (paid tiers) and version your bucket.
* **Scaling**: the API is stateless (tokens are JWTs, files in object storage) — scale Render instances horizontally freely; the DB is the bottleneck.
