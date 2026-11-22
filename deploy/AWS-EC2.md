# Backend on AWS EC2 — free tier (t3.micro), step by step

> Free tier: **750 hrs/month of t3.micro for 12 months** (~$0 while it lasts; set a **$1 Budgets alert** — AWS Console → Budgets). The VM runs the API **and** the background worker together via `scripts/start-all.js`, behind **Caddy** with automatic Let's Encrypt HTTPS.

## 1. Launch the instance (~5 min)

1. EC2 → **Launch instance**. Region: **ap-south-1 (Mumbai)** for India latency (free tier works in every region).
2. Name: `lumen-backend`. OS: **Ubuntu Server 24.04**. Instance type: **t3.micro** (has the free tier badge).
3. Key pair: **Create new** → download the `.pem` and keep it safe.
4. Network settings → Edit:
   * SSH (22) — restrict to **My IP**
   * HTTP (80) and HTTPS (443) — **from anywhere 0.0.0.0/0**
   * Storage: 20 GiB gp3 (free tier allows 30)
5. Expand **Advanced details → User data** → paste the full contents of **`deploy/ec2-user-data.sh`** → Launch.
   * Repo must be **public**, or make it public, or clone with a PAT later (§4 note).

## 2. Fixed IP + wait for bootstrap

1. EC2 → **Elastic IPs** → **Allocate** → **Actions → Associate** → your instance. This IP survives stop/start.
2. Wait ~5–8 minutes, then SSH in and confirm the bootstrap finished:
   ```bash
   ssh -i your-key.pem ubuntu@<ELASTIC_IP>
   tail -5 /var/log/cloud-init-output.log   # ends with "Bootstrap done."
   ```

## 3. Fill in the secrets

```bash
sudo nano /opt/lumen/.env
```
Set (from `backend/.env.example`):
* `DATABASE_URL` — Neon **pooled** string (host ends in `-pooler`)
* `DIRECT_URL` — same string, `-pooler` removed from the host
* `AUTH_SECRET` — generate: `openssl rand -hex 32`
* `STORAGE_ENDPOINT=https://s3.ap-southeast-2.amazonaws.com`, `STORAGE_REGION=ap-southeast-2`, `STORAGE_BUCKET=<bucket>`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (see DEPLOYMENT.md §2)
* `SMTP_*`, `MAIL_FROM`, `AI_PROVIDER_API_KEY`, `AI_BASE_URL`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`
* `FRONTEND_URL` / `ALLOWED_ORIGINS` — your Vercel URL (add after step 6, then restart)

## 4. Domain + HTTPS (Caddy auto-certifies)

* **With a domain** (~₹100–1000/yr at Cloudflare/Porkbun/Namecheap): add an **A record** → your Elastic IP. Then:
  ```bash
  sudo sed -i 's/DOMAIN_PLACEHOLDER/your.domain.com/' /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  ```
  Caddy fetches the Let's Encrypt certificate automatically on first request.
* **No domain, quick test:** use the free wildcard-DNS trick — for IP `1.2.3.4`, the name **`1-2-3-4.sslip.io`** already resolves to it. Use that name in the sed above and everywhere below.
* Repo is private? Clone manually first: `sudo -u lumen -H git clone https://<PAT>@github.com/Karthikgeddada/Lumen.git /opt/lumen/repo`, then re-run the build line from the user-data script.

## 5. Start the backend

```bash
sudo systemctl enable --now lumen
sudo systemctl status lumen          # active (running)
journalctl -u lumen -f               # live logs (API + worker)
curl https://<your-name>/api/health  # {"ok":true}
```

Migrations run automatically on every service start (`ExecStartPre`). Seed demo data once (idempotent):

```bash
sudo -u lumen -H bash -c 'set -a; . /opt/lumen/.env; set +a; cd /opt/lumen/repo/backend && npx prisma db seed'
```

## 6. Frontend (Vercel) + connect

1. Vercel → import repo → Root Directory `frontend` → env `NEXT_PUBLIC_API_URL=https://<your-name>` (no trailing slash) → Deploy.
2. Back on the EC2 box: set `FRONTEND_URL` and `ALLOWED_ORIGINS` in `/opt/lumen/.env` to the Vercel URL, then `sudo systemctl restart lumen`.

## 7. Deploying updates later

```bash
cd /opt/lumen/repo && sudo -u lumen -H git pull
sudo -u lumen -H bash -lc 'cd /opt/lumen/repo/backend && npm ci --include=dev && npm run build'
sudo systemctl restart lumen
```

## Notes

* **After the 12 free months**: t3.micro ≈ $7.5/mo (Mumbai), or swap the systemd start command for the Render free-tier blueprint (`render.yaml`) and go back to $0 (with cold starts).
* **1 GB RAM**: fine for demos; the 1 GB swap added by the bootstrap absorbs PDF-processing spikes.
* **Logs**: `journalctl -u lumen -f`. **Restart**: `sudo systemctl restart lumen`.
