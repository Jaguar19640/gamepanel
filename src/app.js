const express = require('express');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();
const { startScheduler } = require('./scheduler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Versionsprüfung beim Start
console.log('🔍 Prüfe auf Updates...');
try {
  execSync('git fetch origin main 2>/dev/null', { cwd: path.join(__dirname, '..') });
  const localCommit = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
  const remoteCommit = execSync('git rev-parse origin/main', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
  
  if (localCommit !== remoteCommit) {
    console.log('📦 Update verfügbar! Führe "sudo bash update.sh" aus.');
  } else {
    console.log('✅ GamePanel ist auf dem neuesten Stand.');
  }
} catch (e) {
  console.log('⚠️ Versionsprüfung nicht möglich (Git nicht verfügbar)');
}

app.use('/api/auth', require('./routes/auth'));

const serverRoutes = require('./routes/servers');
app.use('/api/servers', serverRoutes);
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/versions', require('./routes/versions'));
app.use('/api/system', require('./routes/system'));

app.setIo = (io) => { serverRoutes.setIo(io); };

// Scheduler starten
startScheduler();

app.get('/server/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/server.html'));
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;