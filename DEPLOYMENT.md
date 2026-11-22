# Deployment — Vercel (frontend) + AWS EC2 (backend) + Neon (Postgres) + AWS S3 (storage)

The stack: the Next.js app deploys on **Vercel**; the backend (API + background worker in one process tree) runs on an **AWS EC2 free-tier VM** behind Caddy with automatic HTTPS; PostgreSQL is external on **Neon** (free tier); documents live in **AWS S3**. `deploy/AWS-EC2.md` is the full backend walkthrough; `render.yaml` (Render free-tier blueprint) remains in the repo as an alternative backend host. `frontend/vercel.json` holds the frontend build config.

## 1. Database — Neon PostgreSQL

1. Create a project on [Neon](https://neon.tech) (free tier works).
2. Open the Connect dialog with **Connection pooling** ON: the string whose host ends in `-pooler` is `DATABASE_URL` (app runtime).
3. The same string with `-pooler` removed from the host is `DIRECT_URL` — migrations cannot run over PgBouncer, so Prisma uses `directUrl` for `prisma migrate deploy`.
4. Migrations run automatically in the backend start command on every deploy — no manual schema step.

## 2. Object storage (required in production)

The backend disk is for temporary processing only — uploaded documents must live in S3-compatible storage:

1. **AWS S3**: Create a bucket (e.g. `lumen-docs`, any region — keep "Block all public access" ON; the app uses signed URLs, nothing public).
2. IAM → Users → create `lumen-backend` (no console access) → attach `AmazonS3FullAccess` → create an **access key** ("Application running outside AWS").
3. Env values: `STORAGE_ENDPOINT=https://s3.<region>.amazonaws.com` (e.g. `https://s3.ap-southeast-2.amazonaws.com`), `STORAGE_REGION=<region>`, `STORAGE_BUCKET=<bucket>`, plus `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`. (The S3 client auto-detects AWS endpoints and uses virtual-hosted style; Cloudflare R2 / Backblaze B2 work too via path style — set their endpoint + region accordingly.)

Demo documents from the seed dataset need no storage — they carry their content inline in the database.

## 3. Backend — AWS EC2 (free tier)

> Full step-by-step: **`deploy/AWS-EC2.md`** (launch settings, bootstrap script, systemd, HTTPS, seeding). Summary: a **t3.micro** (750 hrs/month free for 12 months) runs the API **and** the worker via `scripts/start-all.js`, behind **Caddy** with automatic Let's Encrypt HTTPS. Launch is bootstrapped by pasting `deploy/ec2-user-data.sh` into the **User data** field. HTTPS needs a domain pointed at the instance's Elastic IP — free quick-test alternative: `<ip-with-dashes>.sslip.io`. Set a **$1 Budgets alert** in AWS.

1. EC2 → Launch instance: Ubuntu 24.04, **t3.micro**, key pair, security group with SSH (My IP) + HTTP/HTTPS (anywhere), paste `deploy/ec2-user-data.sh` as **User data**.
2. Allocate + associate an **Elastic IP**; wait for `tail /var/log/cloud-init-output.log` to say "Bootstrap done."
3. `sudo nano /opt/lumen/.env` — fill every variable from `backend/.env.example`:
   * `DATABASE_URL` — the Neon **pooled** connection string (host ends in `-pooler`)
   * `DIRECT_URL` — the same Neon URL with `-pooler` removed from the host; used by `prisma migrate deploy` (migrations cannot run over PgBouncer)
   * `AUTH_SECRET` — `openssl rand -hex 32`
   * `FRONTEND_URL` — your Vercel URL (set after the frontend deploy in §4, then restart the service)
   * `ALLOWED_ORIGINS` — same URL, plus `https://*.vercel.app` preview patterns if wanted
   * `SMTP_*` + `MAIL_FROM` — transactional email
   * `AI_PROVIDER_API_KEY`, `AI_BASE_URL`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`
   * `STORAGE_*` — bucket from step 2
4. Point your domain's A record at the Elastic IP (or use the sslip.io name), set it in `/etc/caddy/Caddyfile`, then `sudo systemctl enable --now lumen`.
5. Verify `https://<your-name>/api/health` returns `{ ok: true }`. Seed the demo dataset once with the one-liner in `deploy/AWS-EC2.md` §5 (idempotent).

## 4. Frontend — Vercel

1. **Add New → Project**, import the repo. Vercel auto-detects Next.js; if configuring manually, set the **Root Directory** to `frontend`.
2. Environment variable: `NEXT_PUBLIC_API_URL` = `https://<your-domain>` (the EC2/Caddy URL, no trailing slash).
3. Deploy. Then set the backend's `FRONTEND_URL` / `ALLOWED_ORIGINS` to the production Vercel URL and `sudo systemctl restart lumen` so CORS, invitation links, and password-reset links point to the right origin.

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
* **Updating**: `cd /opt/lumen/repo && sudo -u lumen -H git pull`, rebuild (command in `deploy/AWS-EC2.md` §7), `sudo systemctl restart lumen` — migrations run on restart.
* **Backups**: Neon includes point-in-time restore on its plans — check your branch's history retention; version your bucket.
* **Scaling**: the API is stateless (tokens are JWTs, files in object storage) — resize the EC2 instance type or add instances behind a load balancer; the DB is the bottleneck.
