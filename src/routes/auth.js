const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../database');

const SECRET = process.env.JWT_SECRET || 'gamepanel-secret';

// ─── MIDDLEWARE ──────────────────────────────────────

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

// ─── ROUTEN ──────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  const hasActiveOtp = user.otp_code && new Date(user.otp_expires_at) > new Date();

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      is_temp: user.is_temp,
      must_change_password: hasActiveOtp ? true : false
    },
    SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      is_temp: user.is_temp,
      must_change_password: hasActiveOtp
    }
  });
});

// Erster Admin Setup — nur für temp Admin nutzbar
router.post('/setup', requireAuth, (req, res) => {
  const caller = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!caller || !caller.is_temp) {
    return res.status(403).json({ error: 'Nur für Ersteinrichtung' });
  }

  const { username, email, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username und Passwort erforderlich' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username bereits vergeben' });

  const hashed = bcrypt.hashSync(password, 10);

  // ERST neuen Admin erstellen
  db.prepare(`
    INSERT INTO users (username, password, email, role, is_temp)
    VALUES (?, ?, ?, ?, 0)
  `).run(username, hashed, email || null, role || 'admin');

  // DANN temp Admin löschen
  db.prepare('DELETE FROM users WHERE is_temp = 1').run();
  console.log('Temporärer Admin gelöscht, echter Admin erstellt');

  res.json({ success: true });
});

router.post('/register', requireAuth, requireAdmin, (req, res) => {
  const { username, email, role } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username erforderlich' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username bereits vergeben' });

  const otp = require('crypto').randomBytes(4).toString('hex').toUpperCase();
  const otpExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const hashed = bcrypt.hashSync(otp, 10);

  // ERST User erstellen
  const result = db.prepare(`
    INSERT INTO users (username, password, email, role, is_temp, otp_code, otp_expires_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(username, hashed, email || null, role || 'user', otp, otpExpires);

  // DANN temporären Admin löschen
  if (req.user.is_temp) {
    db.prepare('DELETE FROM users WHERE is_temp = 1').run();
    console.log('Temporärer Admin gelöscht');
  }

  res.json({
    success: true,
    id: result.lastInsertRowid,
    otp,
    message: `Benutzer erstellt. Temporäres Passwort: ${otp}`
  });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { password, password2 } = req.body;

  if (!password || !password2) {
    return res.status(400).json({ error: 'Beide Felder erforderlich' });
  }
  if (password !== password2) {
    return res.status(400).json({ error: 'Passwörter stimmen nicht überein' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ?, otp_code = NULL, otp_expires_at = NULL WHERE id = ?')
    .run(hashed, req.user.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, is_temp: 0, must_change_password: false },
    SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, role: user.role, is_temp: 0 }
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, role, is_temp, otp_code, otp_expires_at, created_at FROM users WHERE id = ?').get(req.user.id);
  const hasActiveOtp = user.otp_code && new Date(user.otp_expires_at) > new Date();
  res.json({
    ...user,
    must_change_password: hasActiveOtp,
    otp_code: undefined
  });
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, is_temp, created_at FROM users').all();
  res.json(users);
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// OTP Gültigkeit ändern
router.post('/extend-otp', requireAuth, requireAdmin, (req, res) => {
  const { username, hours } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

  const newExpiry = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET otp_expires_at = ? WHERE username = ?').run(newExpiry, username);
  res.json({ success: true });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;