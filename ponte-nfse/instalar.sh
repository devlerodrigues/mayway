#!/usr/bin/env bash
# Instala a Ponte NFS-e numa VPS Ubuntu/Debian.
# Uso (como root):  bash instalar.sh ponte.mayway.com.br
# Antes: crie no DNS um registro A apontando esse nome para o IP desta VPS.
set -euo pipefail
DOMINIO="${1:?informe o domínio, ex.: bash instalar.sh ponte.mayway.com.br}"
VERSAO="${PONTE_VERSAO:-main}"
BASE="https://raw.githubusercontent.com/devlerodrigues/mayway/${VERSAO}/ponte-nfse"

echo "==> Pacotes básicos"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https openssl >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  echo "==> Caddy (HTTPS automático)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "==> Ponte"
id ponte >/dev/null 2>&1 || useradd --system --home /opt/ponte-nfse --shell /usr/sbin/nologin ponte
mkdir -p /opt/ponte-nfse
curl -fsSL "$BASE/server.js" -o /opt/ponte-nfse/server.js
curl -fsSL "$BASE/package.json" -o /opt/ponte-nfse/package.json
if [ ! -f /etc/ponte-nfse.env ]; then
  echo "RELAY_TOKEN=$(openssl rand -hex 32)" > /etc/ponte-nfse.env
  echo "PORT=3911" >> /etc/ponte-nfse.env
fi
chmod 600 /etc/ponte-nfse.env
chown -R ponte:ponte /opt/ponte-nfse

cat > /etc/systemd/system/ponte-nfse.service <<EOF
[Unit]
Description=Ponte NFS-e Mayway
After=network-online.target

[Service]
User=ponte
EnvironmentFile=/etc/ponte-nfse.env
ExecStart=$(command -v node) /opt/ponte-nfse/server.js
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ponte-nfse >/dev/null
systemctl restart ponte-nfse

echo "==> HTTPS em https://$DOMINIO"
if ! grep -q "$DOMINIO" /etc/caddy/Caddyfile 2>/dev/null; then
  printf '\n%s {\n  reverse_proxy 127.0.0.1:3911\n}\n' "$DOMINIO" >> /etc/caddy/Caddyfile
fi
systemctl reload caddy || systemctl restart caddy
command -v ufw >/dev/null && ufw status | grep -q active && ufw allow 80,443/tcp >/dev/null || true

sleep 3
echo
echo "Teste local: $(curl -s http://127.0.0.1:3911/saude)"
echo
echo "=============================================================="
echo " Pronto. Copie estes dois valores para o Supabase:"
echo "   NFSE_PONTE_URL   = https://$DOMINIO"
echo "   NFSE_PONTE_TOKEN = $(grep RELAY_TOKEN /etc/ponte-nfse.env | cut -d= -f2)"
echo "=============================================================="
