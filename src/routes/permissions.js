const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireAuth, requireAdmin } = require('./auth');

// Berechtigungen eines Users für einen Server abrufen
router.get('/server/:serverId/users', requireAuth, requireAdmin, (req, res) => {
  const perms = db.prepare(`
    SELECT u.id, u.username, u.email, u.role,
      COALESCE(p.can_start, 0) as can_start,
      COALESCE(p.can_stop, 0) as can_stop,
      COALESCE(p.can_console, 0) as can_console,
      COALESCE(p.can_files, 0) as can_files,
      COALESCE(p.can_backups, 0) as can_backups,
      COALESCE(p.can_settings, 0) as can_settings,
      COALESCE(p.can_delete, 0) as can_delete
    FROM users u
    LEFT JOIN user_server_permissions p 
      ON u.id = p.user_id AND p.server_id = ?
    WHERE u.is_temp = 0
  `).all(req.params.serverId);
  res.json(perms);
});

// Berechtigungen setzen
router.post('/server/:serverId/users/:userId', requireAuth, requireAdmin, (req, res) => {
  const { can_start, can_stop, can_console, can_files, can_backups, can_settings, can_delete } = req.body;
  const { serverId, userId } = req.params;

  const existing = db.prepare(`
    SELECT * FROM user_server_permissions 
    WHERE user_id = ? AND server_id = ?
  `).get(userId, serverId);

  if (existing) {
    db.prepare(`
      UPDATE user_server_permissions 
      SET can_start=?, can_stop=?, can_console=?, can_files=?, can_backups=?, can_settings=?, can_delete=?
      WHERE user_id=? AND server_id=?
    `).run(
      can_start?1:0, can_stop?1:0, can_console?1:0,
      can_files?1:0, can_backups?1:0, can_settings?1:0,
      can_delete?1:0, userId, serverId
    );
  } else {
    db.prepare(`
      INSERT INTO user_server_permissions 
      (user_id, server_id, can_start, can_stop, can_console, can_files, can_backups, can_settings, can_delete)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      userId, serverId,
      can_start?1:0, can_stop?1:0, can_console?1:0,
      can_files?1:0, can_backups?1:0, can_settings?1:0,
      can_delete?1:0
    );
  }
  res.json({ success: true });
});

// Berechtigungen eines Users für einen Server abrufen (für den User selbst)
router.get('/my/:serverId', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  // Admins haben immer alle Rechte
  if (user.role === 'admin') {
    return res.json({
      can_start: 1, can_stop: 1, can_console: 1,
      can_files: 1, can_backups: 1, can_settings: 1, can_delete: 1
    });
  }

  const perms = db.prepare(`
    SELECT * FROM user_server_permissions 
    WHERE user_id = ? AND server_id = ?
  `).get(req.user.id, req.params.serverId);

  if (!perms) return res.json({
    can_start: 0, can_stop: 0, can_console: 0,
    can_files: 0, can_backups: 0, can_settings: 0, can_delete: 0
  });

  res.json(perms);
});

module.exports = router;