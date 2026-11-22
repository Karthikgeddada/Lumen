# Deployment — Vercel (frontend) + Render (backend) + Neon (Postgres)

The stack: the Next.js app deploys on **Vercel**; the backend (API + background worker in one service) runs on a **Render free web service**; PostgreSQL is external on **Neon** (free tier). `render.yaml` holds the service spec; `frontend/vercel.json` holds the frontend build config. Uploaded documents live in S3-compatible object storage (§4 — optional for a first run; seeded demo data needs none).

## 1. Database — Neon PostgreSQL

1. Create a project on [Neon](https://neon.tech) (free tier works).
2. Open the Connect dialog with **Connection pooling** ON: the string whose host ends in `-pooler` is `DATABASE_URL` (app runtime).
3. The same string with `-pooler` removed from the host is `DIRECT_URL` — migrations cannot run over PgBouncer, so Prisma uses `directUrl` for `prisma migrate deploy`.
4. Migrations run automatically in the backend start command on every deploy — no manual schema step.

## 2. Backend — Render (free web service)

> Deploy as a **manual Web Service** (New + → Web Service), not via the Blueprint button — the free tier requires no card. `render.yaml` in the repo root documents the same settings if you ever prefer Blueprint sync.

1. On render.com, sign up with **GitHub**, then **New + → Web Service** → connect `Karthikgeddada/Lumen`.
2. Settings:
   * **Name**: `lumen-api`
   * **Root Directory**: `backend` (monorepo — required)
   * **Build Command**: `npm ci --include-dev && npx prisma generate && npm run build`
   * **Start Command**: `npx prisma migrate deploy && node scripts/start-all.js`
   * **Region**: Singapore (closest free region to India; use Oregon if unavailable)
   * **Instance Type**: Free
3. Add environment variables before the first deploy (service → **Environment** tab):
   * `DATABASE_URL` — the Neon **pooled** connection string (host ends in `-pooler`)
   * `DIRECT_URL` — the same Neon URL with `-pooler` removed from the host; used by `prisma migrate deploy` (migrations cannot run over PgBouncer)
   * `AUTH_SECRET` — use Render's **Generate** button
   * `FRONTEND_URL` — the Vercel URL (fill in after §3; Render redeploys automatically on save)
   * `ALLOWED_ORIGINS` — the Vercel URL, plus `https://<project>-git-main-*.vercel.app` preview patterns if wanted
   * `SMTP_*` + `MAIL_FROM` — transactional email (optional for a first test)
   * `AI_PROVIDER_API_KEY`, `AI_BASE_URL`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`
   * `STORAGE_*` — only needed before real uploads (§4)
4. **Create Web Service**. The build runs, migrations apply automatically in the start command (the Neon baseline is already in the repo), and `scripts/start-all.js` starts the API **and** the background worker as one process tree.
5. Verify `https://lumen-api.onrender.com/api/health` returns `{ ok: true }`.
6. Seed once (built-in templates + demo dataset; idempotent per database): open the service's **Shell** tab and run `npx prisma db seed` — or run it locally with `DIRECT_URL` as `DATABASE_URL`.

**Free-tier behavior:** the service sleeps after ~15 min of inactivity — the first request then takes ~30–60 s while it wakes (the Assistant's first message after idle may need one retry), and background processing pauses while asleep. Free instances get 750 hrs/month — exactly enough for this one service. If the sleep/wake cycle is disruptive, an external uptime pinger (e.g. cron-job.org) hitting `/api/health` every 10 min keeps it warm, still within the free hours.

## 3. Frontend — Vercel

1. On vercel.com, **Add New → Project**, import `Karthikgeddada/Lumen`. Vercel auto-detects Next.js; set the **Root Directory** to `frontend`.
2. Environment variable: `NEXT_PUBLIC_API_URL` = `https://lumen-api.onrender.com` (the Render URL, no trailing slash).
3. Deploy. Then set the Render service's `FRONTEND_URL` / `ALLOWED_ORIGINS` to the production Vercel URL so CORS, invitation links, and password-reset links point to the right origin.

Cross-site auth: the frontend (vercel.app) and API (onrender.com) are different sites — the API client keeps the access token in memory and falls back to a localStorage refresh token when a browser blocks the API's httpOnly cross-site cookie, so sign-in works either way.

## 4. Object storage (needed before real uploads)

Render's disk is ephemeral — uploaded documents must live in S3-compatible storage. Any of these work; the client auto-detects path-style endpoints:

1. **Cloudflare R2** (free tier, 10 GB — recommended starting point): create a bucket, create an API token with Object Read & Write, then set `STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_REGION=auto`, `STORAGE_BUCKET=<bucket>`, `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`.
2. **AWS S3**: `STORAGE_ENDPOINT=https://s3.<region>.amazonaws.com` (virtual-hosted style auto-detected), `STORAGE_REGION=<region>`, `STORAGE_BUCKET=<bucket>` (keep "Block all public access" ON — the app uses signed URLs, nothing public), plus an access key with full access to the bucket.
3. **Backblaze B2 / MinIO**: set their endpoint + region accordingly (path style).

Demo documents from the seed dataset need no storage — they carry their content inline in the database.



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
* **Worker**: runs inside the same service as the API — `scripts/start-all.js` spawns `dist/index.js` and `dist/worker.js`; if either process dies, both restart together. Locally, run them separately with `npm run dev` + `npm run dev:worker`.
* **Updating**: push to `main` — Render (autoDeploy) and Vercel both pick up the change; migrations run on Render's restart.
* **Backups**: Neon includes point-in-time restore on its plans — check your branch's history retention; version your bucket.
* **Scaling**: the API is stateless (tokens are JWTs, files in object storage) — change the Render instance type when free-tier limits hurt; the DB is the bottleneck. For an always-on VM with a custom domain instead, `deploy/AWS-EC2.md` documents the EC2 alternative.
