const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./database');

// Laufende Prozesse im Speicher
const runningServers = new Map();

// Server starten
async function startServer(serverId, io) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) throw new Error('Server nicht gefunden');
  if (runningServers.has(serverId)) throw new Error('Server läuft bereits');

  // Ordner erstellen falls nicht vorhanden
  if (!fs.existsSync(server.path)) {
    fs.mkdirSync(server.path, { recursive: true });
  }

  let command, args;

  if (server.game === 'Minecraft') {
    const jarFile = path.join(server.path, 'server.jar');
    if (!fs.existsSync(jarFile)) {
      throw new Error('server.jar nicht gefunden — bitte erst installieren');
    }
    command = 'java';
    args = [
      `-Xmx${server.ram}G`,
      `-Xms1G`,
      '-jar', jarFile,
      '--nogui'
    ];
  } else if (server.game === 'Satisfactory') {
    command = path.join(server.path, 'FactoryServer.sh');
    args = [];
  } else if (server.game === 'CS2') {
    command = path.join(server.path, 'game', 'bin', 'linuxsteamrt64', 'cs2');
    args = ['-dedicated'];
  } else {
    throw new Error('Spiel nicht unterstützt');
  }

  const process = spawn(command, args, {
    cwd: server.path,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  runningServers.set(serverId, process);
  db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('online', serverId);

  // Logs ins Frontend streamen
  const emitLog = (type, data) => {
    const line = data.toString().trim();
    if (!line) return;
    line.split('\n').forEach(msg => {
      io.emit(`server-log-${serverId}`, {
        time: new Date().toLocaleTimeString(),
        type,
        message: msg
      });
      // Log in Datei speichern
      const logFile = path.join(server.path, 'logs', 'gamepanel.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    });
  };

  process.stdout.on('data', data => emitLog('info', data));
  process.stderr.on('data', data => emitLog('warn', data));

  process.on('close', (code) => {
    runningServers.delete(serverId);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', serverId);
    io.emit(`server-log-${serverId}`, {
      time: new Date().toLocaleTimeString(),
      type: 'error',
      message: `Server gestoppt (Exit code: ${code})`
    });
    io.emit(`server-status-${serverId}`, { status: 'offline' });
  });

  io.emit(`server-status-${serverId}`, { status: 'online' });
  return true;
}

// Server stoppen
async function stopServer(serverId) {
  const process = runningServers.get(serverId);
  if (!process) throw new Error('Server läuft nicht');

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);

  // Minecraft sauber stoppen
  if (server.game === 'Minecraft' && process.stdin) {
    process.stdin.write('stop\n');
  } else {
    process.kill('SIGTERM');
  }

  // Warten bis wirklich gestoppt
  await new Promise(resolve => setTimeout(resolve, 3000));
  if (runningServers.has(serverId)) {
    process.kill('SIGKILL');
    runningServers.delete(serverId);
  }

  db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', serverId);
  return true;
}

// Befehl an Server senden
function sendCommand(serverId, command) {
  const process = runningServers.get(serverId);
  if (!process) throw new Error('Server läuft nicht');
  process.stdin.write(command + '\n');
  return true;
}

// Status prüfen
function isRunning(serverId) {
  return runningServers.has(serverId);
}

// Logs aus Datei lesen
function getLogs(serverId, lines = 100) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) return [];
  const logFile = path.join(server.path, 'logs', 'gamepanel.log');
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf8');
  return content.split('\n').filter(Boolean).slice(-lines);
}

module.exports = { startServer, stopServer, sendCommand, isRunning, getLogs };