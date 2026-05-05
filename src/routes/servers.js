const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireAuth } = require('./auth');
const { startServer, stopServer, sendCommand, isRunning, getLogs } = require('../gameserver');

let ioRef = null;
router.setIo = (io) => { ioRef = io; };

// Alle Server (Admins sehen alle, User nur ihre)
router.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  
  let servers;
  if (user.role === 'admin') {
    servers = db.prepare('SELECT * FROM servers').all();
  } else {
    servers = db.prepare(`
      SELECT s.* FROM servers s
      INNER JOIN user_server_permissions p ON s.id = p.server_id
      WHERE p.user_id = ?
    `).all(req.user.id);
  }
  res.json(servers);
});

// Einzelner Server
router.get('/:id', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ...server, running: isRunning(parseInt(req.params.id)) });
});

// Server erstellen
router.post('/', requireAuth, (req, res) => {
  const { name, game, version, loader, port, max_players, ram } = req.body;
  if (!name || !game) return res.status(400).json({ error: 'Name und Spiel erforderlich' });

  const installPath = path.join(
    process.env.SERVERS_PATH || './servers',
    game.toLowerCase(),
    name.toLowerCase().replace(/\s+/g, '-')
  );

  const result = db.prepare(`
    INSERT INTO servers (name, game, version, loader, port, max_players, ram, path, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, game, version || 'latest', loader || 'vanilla', port || 25565, max_players || 20, ram || 4, installPath, req.user.id);

  fs.mkdirSync(installPath, { recursive: true });
  res.json({ success: true, id: result.lastInsertRowid });
});

// Server starten
router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    await startServer(parseInt(req.params.id), ioRef);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Server stoppen
router.post('/:id/stop', requireAuth, async (req, res) => {
  try {
    await stopServer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Befehl senden
router.post('/:id/command', requireAuth, (req, res) => {
  try {
    sendCommand(parseInt(req.params.id), req.body.command);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Logs abrufen
router.get('/:id/logs', requireAuth, (req, res) => {
  const logs = getLogs(parseInt(req.params.id));
  res.json(logs);
});

// ─── FILE MANAGER ────────────────────────────────────

// Dateien/Ordner auflisten
router.get('/:id/files', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const dirPath = req.query.path
    ? path.join(server.path, req.query.path)
    : server.path;

  if (!dirPath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  if (!fs.existsSync(dirPath)) return res.json([]);

  const items = fs.readdirSync(dirPath).map(name => {
    const fullPath = path.join(dirPath, name);
    const stat = fs.statSync(fullPath);
    return {
      name,
      isDir: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtime
    };
  });

  res.json(items);
});

// Datei lesen
router.get('/:id/files/read', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  const filePath = path.join(server.path, req.query.path);

  if (!filePath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

  const content = fs.readFileSync(filePath, 'utf8');
  res.json({ content });
});

// Datei speichern
router.post('/:id/files/write', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  const filePath = path.join(server.path, req.body.path);

  if (!filePath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, req.body.content, 'utf8');
  res.json({ success: true });
});

// Datei/Ordner löschen
router.delete('/:id/files', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  const filePath = path.join(server.path, req.query.path);

  if (!filePath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  fs.rmSync(filePath, { recursive: true, force: true });
  res.json({ success: true });
});

// ─── BACKUPS ─────────────────────────────────────────
const archiver = require('archiver');

// Backup erstellen
router.post('/:id/backup', requireAuth, async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const backupDir = path.join('./backups', req.params.id);
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `backup-${timestamp}.zip`);

  const output = fs.createWriteStream(backupFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(server.path, false);
  await archive.finalize();

  output.on('close', () => {
    res.json({ success: true, file: `backup-${timestamp}.zip`, size: archive.pointer() });
  });
});

// Backups auflisten
router.get('/:id/backups', requireAuth, (req, res) => {
  const backupDir = path.join('./backups', req.params.id);
  if (!fs.existsSync(backupDir)) return res.json([]);

  const backups = fs.readdirSync(backupDir).map(name => {
    const stat = fs.statSync(path.join(backupDir, name));
    return { name, size: stat.size, created: stat.mtime };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));

  res.json(backups);
});

// Server löschen
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Server aktualisieren
router.patch('/:id', requireAuth, (req, res) => {
  const { name, port, max_players, ram } = req.body;
  db.prepare(`
    UPDATE servers SET name = ?, port = ?, max_players = ?, ram = ? WHERE id = ?
  `).run(name, port, max_players, ram, req.params.id);
  res.json({ success: true });
});

// Backup-Schedule abrufen
router.get('/:id/backup-schedule', requireAuth, (req, res) => {
  const { getSchedule } = require('../scheduler');
  const schedule = getSchedule(req.params.id);
  res.json(schedule || { enabled: false, interval_hours: 24, max_backups: 7 });
});

// Backup-Schedule speichern
router.post('/:id/backup-schedule', requireAuth, (req, res) => {
  const { saveSchedule } = require('../scheduler');
  const { enabled, interval_hours, max_backups } = req.body;
  saveSchedule(req.params.id, enabled, interval_hours || 24, max_backups || 7);
  res.json({ success: true });
});

module.exports = router;