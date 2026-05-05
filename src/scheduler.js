const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('./database');

const scheduledJobs = new Map();

function startScheduler() {
  // Alle 15 Minuten prüfen ob ein Backup fällig ist
  cron.schedule('*/15 * * * *', () => {
    checkBackups();
  });
  console.log('Backup-Scheduler gestartet');
}

function checkBackups() {
  const schedules = db.prepare(`
    SELECT bs.*, s.path, s.name 
    FROM backup_schedules bs
    JOIN servers s ON bs.server_id = s.id
    WHERE bs.enabled = 1
  `).all();

  schedules.forEach(schedule => {
    const now = new Date();
    const lastBackup = schedule.last_backup ? new Date(schedule.last_backup) : null;
    const intervalMs = schedule.interval_hours * 60 * 60 * 1000;

    if (!lastBackup || (now - lastBackup) >= intervalMs) {
      console.log(`Auto-Backup für Server ${schedule.name}...`);
      createBackup(schedule.server_id, schedule.path, schedule.max_backups);
    }
  });
}

async function createBackup(serverId, serverPath, maxBackups = 7) {
  const backupDir = path.join('./backups', String(serverId));
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `backup-${timestamp}.zip`);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupFile);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);
    if (fs.existsSync(serverPath)) {
      archive.directory(serverPath, false);
    }
    archive.finalize();

    output.on('close', () => {
      // Backup-Zeit aktualisieren
      db.prepare(`
        UPDATE backup_schedules SET last_backup = CURRENT_TIMESTAMP 
        WHERE server_id = ?
      `).run(serverId);

      // Alte Backups löschen wenn über Limit
      cleanOldBackups(backupDir, maxBackups);
      resolve(backupFile);
    });

    output.on('error', reject);
  });
}

function cleanOldBackups(backupDir, maxBackups) {
  if (!fs.existsSync(backupDir)) return;
  const files = fs.readdirSync(backupDir)
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime }))
    .sort((a, b) => b.time - a.time);

  // Alte Backups löschen
  files.slice(maxBackups).forEach(f => {
    fs.unlinkSync(path.join(backupDir, f.name));
    console.log(`Altes Backup gelöscht: ${f.name}`);
  });
}

function getSchedule(serverId) {
  return db.prepare('SELECT * FROM backup_schedules WHERE server_id = ?').get(serverId);
}

function saveSchedule(serverId, enabled, intervalHours, maxBackups) {
  const existing = getSchedule(serverId);
  if (existing) {
    db.prepare(`
      UPDATE backup_schedules 
      SET enabled = ?, interval_hours = ?, max_backups = ?
      WHERE server_id = ?
    `).run(enabled ? 1 : 0, intervalHours, maxBackups, serverId);
  } else {
    db.prepare(`
      INSERT INTO backup_schedules (server_id, enabled, interval_hours, max_backups)
      VALUES (?, ?, ?, ?)
    `).run(serverId, enabled ? 1 : 0, intervalHours, maxBackups);
  }
}

module.exports = { startScheduler, createBackup, getSchedule, saveSchedule, cleanOldBackups };