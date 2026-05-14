#!/bin/bash

set -e
GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[✓]${NC} $1"; }

echo "🔄 GamePanel Update wird gestartet..."

cd /opt/gamepanel

# Datenbank sichern
cp gamepanel.db "backups/pre-update-$(date +%Y%m%d_%H%M%S).db"
log "Datenbank gesichert"

# Neuen Code holen
git pull
log "Code aktualisiert"

# Dependencies aktualisieren
npm install --production
log "Dependencies aktualisiert"

# Panel neustarten
pm2 restart gamepanel
log "Panel neugestartet"

echo ""
echo "✅ Update abgeschlossen!"
pm2 status