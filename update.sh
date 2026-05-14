#!/bin/bash

# ═══════════════════════════════════════════════════
#  GamePanel - Update-Skript
#  Aktualisiert die Installation auf die neueste Version
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
echo "║         GamePanel Update-Skript           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Root prüfen
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausführen: sudo bash update.sh"
fi

INSTALL_DIR="/opt/gamepanel"

# GamePanel Installation prüfen
if [ ! -d "$INSTALL_DIR" ]; then
  err "GamePanel nicht gefunden in $INSTALL_DIR. Installiere zuerst mit: bash install.sh"
fi

log "GamePanel Installation gefunden: $INSTALL_DIR"

# ─── BACKUP ERSTELLEN ───────────────────────────────
info "Erstelle Backup..."
BACKUP_DIR="/tmp/gamepanel_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -f "$INSTALL_DIR/gamepanel.db" ]; then
  cp "$INSTALL_DIR/gamepanel.db" "$BACKUP_DIR/gamepanel.db"
fi

cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env" 2>/dev/null || warn ".env nicht gefunden"
log "Backup erstellt in: $BACKUP_DIR"

# ─── PANEL STOPPEN ──────────────────────────────────
info "Stoppe GamePanel..."
pm2 stop gamepanel 2>/dev/null || warn "Panel läuft nicht"
log "Panel gestoppt"

# ─── REPOSITORY AKTUALISIEREN ───────────────────────
info "Aktualisiere Repository..."

cd "$INSTALL_DIR"

# Git Credential Helper für automatisierte Operationen
export GIT_ASKPASS=echo
export GIT_TERMINAL_PROMPT=0

git fetch origin main 2>/dev/null || err "Git fetch fehlgeschlagen"

# Lokale Änderungen stash-en (falls vorhanden)
if ! git diff-index --quiet HEAD --; then
  warn "Lokale Änderungen gefunden, speichere diese..."
  git stash
fi

git reset --hard origin/main 2>/dev/null || err "Git reset fehlgeschlagen"
log "Repository aktualisiert"

# ─── NPM PAKETE AKTUALISIEREN ───────────────────────
info "Aktualisiere NPM Pakete..."
rm -rf node_modules package-lock.json 2>/dev/null || true
npm install --production || err "NPM install fehlgeschlagen"
log "NPM Pakete aktualisiert"

# ─── VERZEICHNISSE PRÜFEN ───────────────────────────
info "Prüfe Verzeichnisse..."
mkdir -p servers backups tmp logs
log "Verzeichnisse vorhanden"

# ─── SETUP-CHECKS (Java, Dependencies, etc.) ───────
if [ -f "$INSTALL_DIR/setup.js" ]; then
  info "Führe Setup-Checks durch..."
  node setup.js || warn "Setup-Checks fehlgeschlagen (ignoriert)"
  log "Setup-Checks abgeschlossen"
fi

# ─── FIREWALL BEREINIGEN ──────────────────────────
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -q "Status: active"; then
    info "Bereinige Firewall-Regeln..."
    ufw status numbered | tail -n +3 | tac | while IFS= read -r line; do
      rule_number=$(echo "$line" | sed -E 's/^.*\[[[:space:]]*([0-9]+)[[:space:]]*\].*/\1/')
      cleaned_line=$(echo "$line" | sed -E 's/^\[[[:space:]]*[0-9]+[[:space:]]*\][[:space:]]*//')
      rule_port=$(echo "$cleaned_line" | awk '{print $1}')
      case "$rule_port" in
        22/tcp|22/udp|80/tcp|443/tcp|OpenSSH|HTTP|HTTPS)
          continue
          ;;
      esac
      printf 'y\n' | ufw delete "$rule_number" >/dev/null 2>&1 || warn "Konnte Firewall-Regel $rule_number nicht löschen"
    done
    log "Firewall-Bereinigung abgeschlossen"
  else
    warn "ufw installiert, aber nicht aktiviert"
  fi
fi

# ─── DATENBANK MIGRATION (Falls notwendig) ──────────
if [ -f "$INSTALL_DIR/migrate.js" ]; then
  info "Führe Datenbankmigrationen durch..."
  node migrate.js || warn "Migrationsfehler (ignoriert)"
  log "Migrationen abgeschlossen"
fi

# ─── .ENV WIEDERHERSTELLEN UND AKTUALISIEREN ────────
if [ -f "$BACKUP_DIR/.env" ]; then
  info "Stelle .env wieder her..."
  cp "$BACKUP_DIR/.env" "$INSTALL_DIR/.env"
  
  # JAVA_PATH hinzufügen falls nicht vorhanden
  if ! grep -q "^JAVA_PATH=" "$INSTALL_DIR/.env"; then
    echo "JAVA_PATH=/usr/lib/jvm/temurin-25-jdk/bin/java" >> "$INSTALL_DIR/.env"
    log "JAVA_PATH zu .env hinzugefügt"
  fi
  
  log ".env wiederhergestellt und aktualisiert"
fi

# ─── PANEL STARTEN ──────────────────────────────────
info "Starte GamePanel..."
pm2 start ecosystem.config.js || pm2 restart gamepanel
pm2 save
log "Panel gestartet"

# ─── LOGS ANZEIGEN ───────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         Update erfolgreich abgeschlossen  ║"
echo "╚══════════════════════════════════════════╝"
echo ""
log "Backup gespeichert in: $BACKUP_DIR"
log "Panel wurde neu gestartet"
info "Aktuelle Logs:"
echo ""
pm2 logs gamepanel --lines 10 || true
echo ""
