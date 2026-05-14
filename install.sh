#!/bin/bash

# ═══════════════════════════════════════════════════
#  GamePanel - Automatisches Installations-Skript
#  Unterstützt: Ubuntu 20.04, 22.04, 24.04 / Debian 11, 12
# ═══════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[→]${NC} $1"; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         GamePanel Installer v0.1         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Root prüfen
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausführen: sudo bash install.sh"
fi

# OS prüfen
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  VER=$VERSION_ID
else
  err "Betriebssystem nicht erkannt"
fi

log "Betriebssystem: $OS $VER"

# ─── SYSTEM UPDATE ───────────────────────────────────
info "System wird aktualisiert..."
apt-get update -y
apt-get upgrade -y
log "System aktualisiert"

# ─── GRUNDPAKETE ─────────────────────────────────────
info "Installiere Grundpakete..."
apt-get install -y \
  curl wget git unzip tar \
  build-essential \
  software-properties-common \
  ca-certificates gnupg \
  ufw nginx certbot python3-certbot-nginx
log "Grundpakete installiert"

# ─── NODE.JS ─────────────────────────────────────────
info "Installiere Node.js 22 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  log "Node.js $(node -v) installiert"
else
  log "Node.js bereits installiert: $(node -v)"
fi

# ─── JAVA ────────────────────────────────────────────
info "Installiere Java 21..."
if ! command -v java &> /dev/null; then
  apt-get install -y openjdk-21-jre-headless
  log "Java $(java -version 2>&1 | head -1) installiert"
else
  log "Java bereits installiert"
fi

# ─── STEAMCMD ────────────────────────────────────────
info "Installiere SteamCMD..."
if ! command -v steamcmd &> /dev/null; then
  dpkg --add-architecture i386
  apt-get update -y
  echo "steamcmd steam/question select I AGREE" | debconf-set-selections
  echo "steamcmd steam/license note ''" | debconf-set-selections
  apt-get install -y steamcmd
  ln -sf /usr/games/steamcmd /usr/local/bin/steamcmd
  log "SteamCMD installiert"
else
  log "SteamCMD bereits installiert"
fi

# ─── PM2 ─────────────────────────────────────────────
info "Installiere PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
  log "PM2 installiert"
else
  log "PM2 bereits installiert"
fi

# ─── GAMEPANEL ───────────────────────────────────────
info "Installiere GamePanel..."

INSTALL_DIR="/opt/gamepanel"

# Bestehende Installation prüfen
if [ -d "$INSTALL_DIR" ]; then
  warn "Bestehende Installation gefunden in $INSTALL_DIR"
  read -p "Überschreiben? (y/n): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    err "Installation abgebrochen"
  fi
  # Backup der Datenbank
  if [ -f "$INSTALL_DIR/gamepanel.db" ]; then
    cp "$INSTALL_DIR/gamepanel.db" "/tmp/gamepanel_backup_$(date +%Y%m%d_%H%M%S).db"
    warn "Datenbank gesichert nach /tmp/"
  fi
fi

# GitHub Repository klonen (ohne Authentifizierungsprompt für public Repos)
read -p "GitHub Repository URL (Enter für Standard): " REPO_URL
REPO_URL=${REPO_URL:-"https://github.com/Jaguar19640/gamepanel.git"}

# Git Credential Helper für automatisierte Klone konfigurieren
export GIT_ASKPASS=echo
export GIT_TERMINAL_PROMPT=0

if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR"
  git pull origin main 2>/dev/null || warn "Git pull fehlgeschlagen, versuche neuen Klon..."
else
  git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    err "Git clone fehlgeschlagen. Überprüfe die Repository-URL und deine Internetverbindung."
  }
  cd "$INSTALL_DIR"
fi

# NPM Pakete installieren
info "Installiere NPM Pakete..."
npm install --production
log "NPM Pakete installiert"

# Verzeichnisse erstellen
mkdir -p servers backups tmp logs
log "Verzeichnisse erstellt"

# ─── KONFIGURATION ───────────────────────────────────
info "Konfiguration einrichten..."

if [ ! -f "$INSTALL_DIR/.env" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  PORT=3000

  cat > "$INSTALL_DIR/.env" << EOF
PORT=${PORT}
JWT_SECRET=${JWT_SECRET}
STEAMCMD_PATH=/usr/games/steamcmd
SERVERS_PATH=/opt/gamepanel/servers
EOF
  log ".env Datei erstellt"
else
  warn ".env bereits vorhanden — wird nicht überschrieben"
fi

# ─── PM2 KONFIGURATION ───────────────────────────────
info "PM2 einrichten..."

cat > "$INSTALL_DIR/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [{
    name: 'gamepanel',
    script: 'server.js',
    cwd: '/opt/gamepanel',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/opt/gamepanel/logs/pm2-error.log',
    out_file: '/opt/gamepanel/logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash
log "PM2 konfiguriert und gestartet"

# ─── NGINX ───────────────────────────────────────────
info "Nginx konfigurieren..."

read -p "Domain/IP für GamePanel (z.B. panel.example.com oder Server-IP): " DOMAIN

cat > "/etc/nginx/sites-available/gamepanel" << EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/gamepanel /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
log "Nginx konfiguriert"

# ─── SSL (OPTIONAL) ──────────────────────────────────
if [[ $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  warn "IP-Adresse erkannt — SSL wird übersprungen (nur für Domains verfügbar)"
else
  read -p "SSL mit Let's Encrypt einrichten? (y/n): " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "E-Mail für SSL-Zertifikat: " SSL_EMAIL
    certbot --nginx -d "$DOMAIN" --email "$SSL_EMAIL" --agree-tos --non-interactive
    log "SSL eingerichtet"
  fi
fi

# ─── FIREWALL ────────────────────────────────────────
info "Firewall einrichten..."
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25565/tcp comment 'Minecraft'
ufw allow 7777/tcp comment 'Satisfactory'
ufw allow 27015/tcp comment 'CS2'
ufw allow 2456:2458/udp comment 'Valheim'
ufw allow 7778/tcp comment 'ARK'
ufw allow 28015/tcp comment 'Rust'
ufw --force enable
log "Firewall konfiguriert"

# ─── FERTIG ──────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║      GamePanel erfolgreich installiert!  ║"
echo "╚══════════════════════════════════════════╝"
echo ""
log "Panel läuft unter: http://${DOMAIN}"
log "Standard Login: admin / admin"
warn "Bitte beim ersten Login den Admin-Account einrichten!"
echo ""
info "Nützliche Befehle:"
echo "  pm2 status          — Panel-Status"
echo "  pm2 logs gamepanel  — Live-Logs"
echo "  pm2 restart gamepanel — Panel neustarten"
echo "  pm2 stop gamepanel  — Panel stoppen"
echo ""
