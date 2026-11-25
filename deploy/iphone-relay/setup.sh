#!/usr/bin/env bash
# One-time setup of the ArenaHub iPhone relay on a fresh Ubuntu 22.04/24.04 VM (Oracle Cloud Always Free works).
# Run on the VM:  sudo bash setup.sh https://arenahub-live.vercel.app https://arenahub-esports.web.app
#   1st argument: the ArenaHub API address (it answers /api/integrity/relay/auth)
#   2nd argument: the website address(es) staff open the wall from, comma-separated
# Prints the three IPHONE_RELAY_* values to put on the ArenaHub API (Vercel env) at the end.
set -euo pipefail
API="${1:?Give the ArenaHub API address, e.g. https://arenahub-live.vercel.app}"
SITES="${2:?Give the website address, e.g. https://arenahub-esports.web.app}"
VERSION=v1.21.4
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64) ARCH=arm64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac

PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
HOST="$(echo "$PUBLIC_IP" | tr . -).sslip.io"
echo "Public address: $PUBLIC_IP  ->  https://$HOST"

# --- MediaMTX ---
apt-get update -qq
apt-get install -y -qq curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent >/dev/null
mkdir -p /opt/mediamtx
curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/$VERSION/mediamtx_${VERSION}_linux_${ARCH}.tar.gz" | tar -xz -C /opt/mediamtx mediamtx
ORIGINS="$(echo "$SITES" | sed 's/[[:space:]]//g; s/,/", "/g; s/^/"/; s/$/"/')"
sed -e "s#__AUTH_URL__#${API%/}/api/integrity/relay/auth#" \
    -e "s#__ALLOWED_ORIGINS__#$ORIGINS#" \
    -e "s#__PUBLIC_IP__#$PUBLIC_IP#" "$HERE/mediamtx.yml" > /opt/mediamtx/mediamtx.yml
useradd --system --no-create-home --shell /usr/sbin/nologin mediamtx 2>/dev/null || true
cat > /etc/systemd/system/mediamtx.service <<UNIT
[Unit]
Description=ArenaHub iPhone relay (MediaMTX)
After=network-online.target
Wants=network-online.target
[Service]
User=mediamtx
ExecStart=/opt/mediamtx/mediamtx /opt/mediamtx/mediamtx.yml
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT

# --- Caddy (free HTTPS certificate for <ip>.sslip.io) ---
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
cp "$HERE/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=RELAY_HOST=%s\n' "$HOST" > /etc/systemd/system/caddy.service.d/relay.conf

# --- Firewall on the VM (Oracle images reject everything but SSH by default) ---
for rule in "tcp 80" "tcp 443" "tcp 1935" "tcp 8189" "udp 8189"; do
  set -- $rule
  iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null && continue
  # Insert before the catch-all REJECT if there is one, otherwise append.
  REJECT_AT="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
  if [ -n "$REJECT_AT" ]; then iptables -I INPUT "$REJECT_AT" -p "$1" --dport "$2" -j ACCEPT; else iptables -A INPUT -p "$1" --dport "$2" -j ACCEPT; fi
done
netfilter-persistent save >/dev/null

systemctl daemon-reload
systemctl enable --now mediamtx >/dev/null
systemctl restart caddy

SECRET_HINT='(make one: openssl rand -base64 36)'
cat <<DONE

Relay is running. Also open these ports in the cloud console firewall (Oracle: VCN > Security List > Ingress):
  TCP 80, 443, 1935, 8189   and   UDP 8189

Put these on the ArenaHub API (Vercel > Settings > Environment Variables), then redeploy the API:
  IPHONE_RELAY_RTMP=rtmp://$PUBLIC_IP:1935
  IPHONE_RELAY_WEB=https://$HOST
  IPHONE_RELAY_SECRET=<a long random secret> $SECRET_HINT

Check: curl -s -o /dev/null -w '%{http_code}\n' https://$HOST/v3/paths/list   (401 = running and protected)
DONE
