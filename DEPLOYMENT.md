# Deployment — Vercel (frontend) + Render (backend + Postgres)

The repo is configured for this split: the Next.js app deploys on Vercel; the backend runs on Render as a **single free web service** hosting the API **and** the background worker together (no card required), and PostgreSQL is external on **Neon** (free tier works). `render.yaml` at the repo root defines the service and every environment variable; `frontend/vercel.json` holds the frontend build config.

## 1. Database — Neon PostgreSQL

1. Create a project on [Neon](https://neon.tech) (free tier works).
2. Open the Connect dialog with **Connection pooling** ON: the string whose host ends in `-pooler` is `DATABASE_URL` (app runtime).
3. The same string with `-pooler` removed from the host is `DIRECT_URL` — migrations cannot run over PgBouncer, so Prisma uses `directUrl` for `prisma migrate deploy`.
4. Migrations run automatically in the backend start command on every deploy — no manual schema step.

## 2. Object storage (required in production)

Render's filesystem is ephemeral — uploaded documents must live in S3-compatible storage:

1. **AWS S3**: Create a bucket (e.g. `lumen-docs`, any region — keep "Block all public access" ON; the app uses signed URLs, nothing public).
2. IAM → Users → create `lumen-backend` (no console access) → attach `AmazonS3FullAccess` → create an **access key** ("Application running outside AWS").
3. Env values: `STORAGE_ENDPOINT=https://s3.<region>.amazonaws.com` (e.g. `https://s3.ap-southeast-2.amazonaws.com`), `STORAGE_REGION=<region>`, `STORAGE_BUCKET=<bucket>`, plus `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`. (The S3 client auto-detects AWS endpoints and uses virtual-hosted style; Cloudflare R2 / Backblaze B2 work too via path style — set their endpoint + region accordingly.)

Demo documents from the seed dataset need no storage — they carry their content inline in the database.

## 3. Backend — Render (free tier)

> **No card required.** `render.yaml` defines a **single free web service** that runs the API **and** the background worker together (`scripts/start-all.js` spawns both; migrations run on boot). **New → Blueprint** is still the easiest path — a free-plan blueprint does not require payment info. Free-tier tradeoffs: the service sleeps after ~15 min without traffic (first request takes ~50s to wake) and background jobs pause while asleep. When you later have a working payment method, split into `lumen-api` (Web Service) + `lumen-worker` (Background Worker) for always-on processing — the two-service blueprint is in git history.

1. **New → Blueprint** (recommended) or **New → Web Service** manually.
2. Manual settings: root directory `backend`; build `npm ci --include=dev && npm run build` (`prisma generate` + `tsc`) — `--include=dev` is required because `NODE_ENV=production` makes npm skip devDependencies, and `prisma`/`typescript` are devDependencies; start `npx prisma migrate deploy && node scripts/start-all.js`.
3. If Render still asks for payment info, check the service shows **plan: free** — paid plans (starter / worker) are what trigger the card wall.
4. Environment: fill every variable from `backend/.env.example`:
   * `DATABASE_URL` — the Neon **pooled** connection string (host ends in `-pooler`, from the Connect dialog with "Connection pooling" on), e.g. `postgresql://...@ep-xxx-pooler.../neondb?sslmode=require`
   * `DIRECT_URL` — the same Neon URL with `-pooler` removed from the host; used by `prisma migrate deploy` (migrations cannot run over PgBouncer)
   * `AUTH_SECRET` — 48+ random bytes (see ENVIRONMENT.md)
   * `FRONTEND_URL` — your Vercel URL (set after the frontend deploy in §4, then re-deploy the backend)
   * `ALLOWED_ORIGINS` — same URL, plus `https://*.vercel.app` preview patterns if wanted
   * `SMTP_*` + `MAIL_FROM` — transactional email
   * `AI_PROVIDER_API_KEY`, `AI_BASE_URL`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`
   * `STORAGE_*` — bucket from step 2
   * `NODE_ENV=production`, `MAIL_DEV_MODE` unset/false
5. Deploy. Verify `https://<service>.onrender.com/api/health` returns `{ ok: true }`. Seed the demo dataset once: open the `lumen-api` service's **Shell** in the Render dashboard and run `npx prisma db seed` (idempotent — it only inserts what's missing).

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
* **Worker**: on the free tier it runs inside the same service as the API — `scripts/start-all.js` spawns `dist/index.js` and `dist/worker.js`; if either process dies, both restart together. Locally, run them separately with `npm run dev` + `npm run dev:worker`.
* **Backups**: Neon includes point-in-time restore on its plans — check your branch's history retention; version your bucket.
* **Scaling**: the API is stateless (tokens are JWTs, files in object storage) — scale Render instances horizontally freely; the DB is the bottleneck.
