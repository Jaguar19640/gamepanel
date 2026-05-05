const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');

const SECRET = process.env.JWT_SECRET || 'gamepanel-secret';

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, is_temp: user.is_temp },
    SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      is_temp: user.is_temp
    }
  });
});

// Registrierung (nur für Admins oder erster Setup)
router.post('/register', requireAuth, requireAdmin, (req, res) => {
  const { username, password, email, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username und Passwort erforderlich' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username bereits vergeben' });

  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password, email, role, is_temp)
    VALUES (?, ?, ?, ?, 0)
  `).run(username, hashed, email || null, role || 'user');

  // Temporären Admin löschen nachdem echter Account erstellt wurde
  const tempAdmin = db.prepare('SELECT * FROM users WHERE is_temp = 1').get();
  if (tempAdmin && req.user.is_temp) {
    db.prepare('DELETE FROM users WHERE is_temp = 1').run();
    console.log('Temporärer Admin wurde gelöscht');
  }

  res.json({ success: true, id: result.lastInsertRowid });
});

// Eigenes Profil abrufen
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, role, is_temp, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// Alle User abrufen (nur Admin)
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, is_temp, created_at FROM users').all();
  res.json(users);
});

// User löschen (nur Admin)
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Middleware
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token ungültig' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;