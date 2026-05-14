const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const db = new Database(path.join(__dirname, '../gamepanel.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_temp INTEGER DEFAULT 0,
    otp_code TEXT,
    otp_expires_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    game TEXT NOT NULL,
    version TEXT,
    loader TEXT,
    port INTEGER,
    max_players INTEGER DEFAULT 20,
    ram INTEGER DEFAULT 4,
    status TEXT DEFAULT 'offline',
    path TEXT,
    created_by INTEGER,
    backup_path TEXT,
    backup_drive TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_server_permissions (
    user_id INTEGER,
    server_id INTEGER,
    can_view INTEGER DEFAULT 0,
    can_start INTEGER DEFAULT 0,
    can_stop INTEGER DEFAULT 0,
    can_console INTEGER DEFAULT 0,
    can_files INTEGER DEFAULT 0,
    can_backups INTEGER DEFAULT 0,
    can_settings INTEGER DEFAULT 0,
    can_delete INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, server_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (server_id) REFERENCES servers(id)
  );

  CREATE TABLE IF NOT EXISTS backup_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER UNIQUE,
    enabled INTEGER DEFAULT 0,
    interval_hours INTEGER DEFAULT 24,
    max_backups INTEGER DEFAULT 7,
    last_backup DATETIME,
    FOREIGN KEY (server_id) REFERENCES servers(id)
  );
`);

function initAdmin() {
  const anyUser = db.prepare('SELECT * FROM users WHERE is_temp = 0').get();
  if (!anyUser) {
    // Alten temp Admin löschen falls vorhanden
    db.prepare('DELETE FROM users WHERE is_temp = 1').run();
    const hashed = bcrypt.hashSync('admin', 10);
    db.prepare(`
      INSERT INTO users (username, password, role, is_temp)
      VALUES (?, ?, 'admin', 1)
    `).run('admin', hashed);
    console.log('Temporärer Admin erstellt — bitte nach erstem Login ändern!');
  }
}

initAdmin();
module.exports = db;