# Environment Variables

Copy the `.env.example` in each package to `.env` (backend) / `.env.local` (frontend) and fill in the values. Everything below is required for a production deployment unless marked optional.

## Backend (`backend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (Render Postgres, Supabase, Neon, RDS…). Must include `?sslmode=require` for managed providers. |
| `AUTH_SECRET` | yes | Signs access and refresh JWTs. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Rotating it signs out every user. |
| `FRONTEND_URL` | yes | Exact deployed frontend origin (no trailing slash), used in invitation/reset links and CORS. |
| `ALLOWED_ORIGINS` | yes | Comma-separated browser origins allowed by CORS. Include production + any preview URLs. |
| `PORT` | dev | Render injects this automatically; fallback `4000` locally. |
| `NODE_ENV` | auto | `production` on Render; set `development` locally. |
| `SMTP_HOST` / `SMTP_PORT` | yes (prod) | Any SMTP provider — Resend, Postmark, SES, Gmail app password. Used for verification codes, password reset, invitations. |
| `SMTP_USER` / `SMTP_PASSWORD` | yes (prod) | SMTP credentials. |
| `MAIL_FROM` | yes (prod) | From-address, e.g. `"Lumen <no-reply@yourdomain.com>"`. |
| `MAIL_DEV_MODE` | dev only | Logs emails to console instead of sending. **Never enable in production.** |
| `AI_PROVIDER_API_KEY` | recommended | Key for any OpenAI-compatible provider. When empty, retrieval falls back to keyword search and AI features degrade gracefully. |
| `AI_BASE_URL` | recommended | Defaults to `https://api.openai.com/v1`; change for Azure gateways, OpenRouter, Together… |
| `AI_CHAT_MODEL` | recommended | e.g. `gpt-4o-mini`. Used for summaries, assistant answers, extraction, questionnaires. |
| `AI_EMBEDDING_BASE_URL` | optional | Defaults to the same `AI_BASE_URL`. Set to `local` to run the embedding model **in-process** via transformers.js — no API or key needed (e.g. with OpenRouter, which has no embeddings endpoint). |
| `AI_EMBEDDING_MODEL` | recommended | API model (e.g. `text-embedding-3-small`), or with `AI_EMBEDDING_BASE_URL=local`, an open-source model id like `Xenova/all-MiniLM-L6-v2` (384-dim, ONNX). Used to embed chunks for semantic retrieval. |
| `AI_TIMEOUT_MS` | optional | Abort timeout for every AI provider HTTP call, in milliseconds (default 60000). A hung provider request can never pin a worker. |
| `STORAGE_ENDPOINT` | yes (prod) | S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, MinIO…). Render disks are ephemeral, so uploads must live in object storage. |
| `STORAGE_REGION` / `STORAGE_BUCKET` | yes (prod) | Bucket region and name for document storage. |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | yes (prod) | Bucket credentials with put/get/delete on the bucket. |
| `MAX_UPLOAD_MB` | optional | Max upload size (default 500). |

## Frontend (`frontend/.env.local`)

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | yes | Base URL of the backend, no trailing slash. Vercel: your Render URL. Local dev: `http://localhost:4000`. |

## Notes

* Access tokens live in memory only; refresh tokens in httpOnly cookies — no secrets are stored in the browser.
* The seed script (`npx prisma db seed`) inserts built-in extraction/questionnaire templates plus the reference demo dataset (all rows flagged `isDemo`). It is idempotent per database — run once per environment.
* If you run the worker separately from the API (not required on Render — `render.yaml` runs both as one service), the same env applies.
