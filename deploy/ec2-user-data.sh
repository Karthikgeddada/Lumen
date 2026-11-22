#!/bin/bash
# Lumen backend bootstrap — paste into the EC2 "User data" field (Ubuntu 24.04, t3.micro).
# Installs Node 22 + Caddy, clones the repo, builds the backend, wires systemd.
# Secrets are NOT set here — after boot, edit /opt/lumen/.env (steps in deploy/AWS-EC2.md).
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# 1 GB swap — the free-tier VM has 1 GB RAM shared by API + worker + PDF parsing
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy — reverse proxy with automatic Let's Encrypt HTTPS
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

# App user + code (repo must be public, or clone manually with a PAT — see AWS-EC2.md)
id -u lumen &>/dev/null || useradd -m -s /bin/bash lumen
mkdir -p /opt/lumen
chown -R lumen:lumen /opt/lumen
if [ ! -d /opt/lumen/repo ]; then
  sudo -u lumen -H git clone https://github.com/Karthikgeddada/Lumen.git /opt/lumen/repo
fi

# Build backend (compiling needs no secrets)
sudo -u lumen -H bash -lc 'cd /opt/lumen/repo/backend && npm ci --include=dev && npm run build'

# Config template (fill in after boot) + systemd + proxy
cp /opt/lumen/repo/backend/.env.example /opt/lumen/.env
chown lumen:lumen /opt/lumen/.env
chmod 600 /opt/lumen/.env
cp /opt/lumen/repo/deploy/lumen.service /etc/systemd/system/lumen.service
cat > /etc/caddy/Caddyfile <<'CADDY'
DOMAIN_PLACEHOLDER {
	reverse_proxy 127.0.0.1:4000
}
CADDY
systemctl daemon-reload

echo "Bootstrap done. Next: edit /opt/lumen/.env, set the domain in /etc/caddy/Caddyfile, then: sudo systemctl enable --now lumen"