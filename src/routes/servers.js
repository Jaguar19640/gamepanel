const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireAuth } = require('./auth');
const { startServer, stopServer, sendCommand, isRunning, getServerInfo, getLogs } = require('../gameserver');
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });
const { installServer } = require('../installer');
const archiver = require('archiver');

let ioRef = null;
router.setIo = (io) => {
  ioRef = io;
  console.log('ioRef gesetzt:', ioRef ? 'OK' : 'FEHLER');
};

// ─── SERVER ──────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  let servers;
  if (user.role === 'admin') {
    servers = db.prepare('SELECT * FROM servers').all();
  } else {
    servers = db.prepare(`
      SELECT s.* FROM servers s
      INNER JOIN user_server_permissions p ON s.id = p.server_id
      WHERE p.user_id = ? AND p.can_view = 1
    `).all(req.user.id);
  }
  res.json(servers);
});

router.get('/:id', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ...server, running: isRunning(parseInt(req.params.id)) });
});

router.post('/', requireAuth, (req, res) => {
  const { name, game, version, loader, port, max_players, ram } = req.body;
  if (!name || !game) return res.status(400).json({ error: 'Name und Spiel erforderlich' });

  const serverPort = port || 25565;
  const installPath = path.join(
    process.env.SERVERS_PATH || './servers',
    game.toLowerCase(),
    name.toLowerCase().replace(/\s+/g, '-')
  );

  const result = db.prepare(`
    INSERT INTO servers (name, game, version, loader, port, max_players, ram, path, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, game, version || 'latest', loader || 'vanilla', serverPort, max_players || 20, ram || 4, installPath, req.user.id);

  fs.mkdirSync(installPath, { recursive: true });
  res.json({ success: true, id: result.lastInsertRowid });
});

router.patch('/:id', requireAuth, (req, res) => {
  const { name, port, max_players, ram, backup_path, backup_drive } = req.body;
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const newPort = port || server.port;
  db.prepare(`
    UPDATE servers SET name=?, port=?, max_players=?, ram=?, backup_path=?, backup_drive=?
    WHERE id=?
  `).run(name, newPort, max_players, ram, backup_path || null, backup_drive || null, req.params.id);

  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  if (req.query.deleteFiles === 'true' && server.path) {
    if (fs.existsSync(server.path)) {
      fs.rmSync(server.path, { recursive: true, force: true });
    }
  }

  db.prepare('DELETE FROM user_server_permissions WHERE server_id = ?').run(req.params.id);
  db.prepare('DELETE FROM backup_schedules WHERE server_id = ?').run(req.params.id);
  db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── SERVER AKTIONEN ─────────────────────────────────

router.post('/:id/start', requireAuth, async (req, res) => {
  console.log('Start aufgerufen, ioRef:', ioRef ? 'gesetzt' : 'NULL!');
  try {
    await startServer(parseInt(req.params.id), ioRef);
    res.json({ success: true });
  } catch (e) {
    if (e.message === 'Server läuft bereits') {
      db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('online', req.params.id);
    }
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/stop', requireAuth, async (req, res) => {
  try {
    await stopServer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/command', requireAuth, (req, res) => {
  try {
    sendCommand(parseInt(req.params.id), req.body.command);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/install', requireAuth, async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });
  if (server.status === 'installing') {
    return res.status(400).json({ error: 'Installation läuft bereits' });
  }
  installServer(parseInt(req.params.id), ioRef).catch(console.error);
  res.json({ success: true, message: 'Installation gestartet' });
});

router.get('/:id/info', requireAuth, (req, res) => {
  const info = getServerInfo(parseInt(req.params.id));
  if (!info) return res.json({ running: false });
  res.json({ running: true, ...info });
});

// ─── LOGS ────────────────────────────────────────────

router.get('/:id/logs', requireAuth, (req, res) => {
  const logs = getLogs(parseInt(req.params.id));
  res.json(logs);
});

router.delete('/:id/logs', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });
  const logFile = path.join(server.path, 'logs', 'gamepanel.log');
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  res.json({ success: true });
});

// ─── FILE MANAGER ────────────────────────────────────

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
    return { name, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtime };
  });

  res.json(items);
});

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

router.post('/:id/files/rename', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  const oldPath = path.join(server.path, req.body.oldPath);
  const newPath = path.join(server.path, req.body.newPath);

  if (!oldPath.startsWith(server.path) || !newPath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Nicht gefunden' });
  fs.renameSync(oldPath, newPath);
  res.json({ success: true });
});

router.delete('/:id/files', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  const filePath = path.join(server.path, req.query.path);

  if (!filePath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  fs.rmSync(filePath, { recursive: true, force: true });
  res.json({ success: true });
});

router.post('/:id/files/upload', requireAuth, upload.array('files'), async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const targetDir = path.join(server.path, req.body.path || '');
  if (!targetDir.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const uploaded = [];
  for (const file of req.files) {
    fs.renameSync(file.path, path.join(targetDir, file.originalname));
    uploaded.push(file.originalname);
  }
  res.json({ success: true, uploaded });
});

router.get('/:id/files/download', (req, res) => {
  const jwt = require('jsonwebtoken');
  const SECRET = process.env.JWT_SECRET || 'gamepanel-secret';
  const token = req.query.token || req.headers.authorization?.split(' ')[1];

  try { jwt.verify(token, SECRET); }
  catch { return res.status(401).json({ error: 'Nicht eingeloggt' }); }

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const filePath = path.join(server.path, req.query.path);
  if (!filePath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(filePath);
});

router.get('/:id/files/download-folder', requireAuth, async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const folderPath = path.join(server.path, req.query.path || '');
  if (!folderPath.startsWith(server.path)) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }

  const folderName = path.basename(folderPath) || 'server';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);
  archive.directory(folderPath, false);
  archive.finalize();
});

// ─── BACKUPS ─────────────────────────────────────────

router.post('/:id/backup', requireAuth, async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  // Backup-Pfad: konfiguriert oder Standard
  const backupBase = server.backup_path || path.join('./backups', req.params.id);
  fs.mkdirSync(backupBase, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupBase, `backup-${timestamp}.zip`);

  const output = fs.createWriteStream(backupFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(server.path, false);
  await archive.finalize();

  output.on('close', () => {
    res.json({ success: true, file: `backup-${timestamp}.zip`, size: archive.pointer() });
  });
});

router.get('/:id/backups', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Nicht gefunden' });

  const backupDir = server.backup_path || path.join('./backups', req.params.id);
  if (!fs.existsSync(backupDir)) return res.json([]);

  const backups = fs.readdirSync(backupDir).map(name => {
    const stat = fs.statSync(path.join(backupDir, name));
    return { name, size: stat.size, created: stat.mtime };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));

  res.json(backups);
});

router.get('/:id/backup-schedule', requireAuth, (req, res) => {
  const { getSchedule } = require('../scheduler');
  const schedule = getSchedule(req.params.id);
  res.json(schedule || { enabled: false, interval_hours: 24, max_backups: 7 });
});

router.post('/:id/backup-schedule', requireAuth, (req, res) => {
  const { saveSchedule } = require('../scheduler');
  const { enabled, interval_hours, max_backups } = req.body;
  saveSchedule(req.params.id, enabled, interval_hours || 24, max_backups || 7);
  res.json({ success: true });
});

module.exports = router;