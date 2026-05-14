const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const treeKill = require('tree-kill');
const db = require('./database');

const runningServers = new Map();

function parseJavaMajorVersion(output) {
  const versionMatch = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!versionMatch) return null;
  let major = parseInt(versionMatch[1], 10);
  if (major === 1 && versionMatch[2]) {
    major = parseInt(versionMatch[2], 10);
  }
  return Number.isNaN(major) ? null : major;
}

function isMinecraftVersionAtLeast(version, major, minor = 0) {
  if (!version) return false;
  const parts = version.split('.');
  const foundMajor = parseInt(parts[0], 10);
  const foundMinor = parseInt(parts[1], 10) || 0;
  if (Number.isNaN(foundMajor)) return false;
  return foundMajor > major || (foundMajor === major && foundMinor >= minor);
}

function checkJavaForMinecraft(server) {
  const javaBinary = process.env.JAVA_PATH || 'java';
  let output;
  try {
    output = execSync(`"${javaBinary}" -version 2>&1`, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`Java nicht gefunden oder nicht ausführbar (${javaBinary}). Bitte Java 21+ installieren und JAVA_PATH setzen.`);
  }

  const major = parseJavaMajorVersion(output);
  if (!major) {
    throw new Error('Konnte die Java-Version nicht ermitteln. Bitte prüfen Sie Ihre Java-Installation.');
  }

  if (major < 21) {
    throw new Error(`Gefundene Java-Version ${major} ist zu alt. Minecraft benötigt Java 21 oder neuer.`);
  }

  if (isMinecraftVersionAtLeast(server.version, 1, 26) && major < 25) {
    throw new Error(`Minecraft ${server.version} benötigt für diesen Build vermutlich Java 25 oder neuer. Gefundene Java-Version: ${major}.`);
  }

  if (major < 25) {
    console.warn(`Hinweis: Gefundene Java-Version ${major} ist für die neuesten Minecraft-Builds möglicherweise nicht ausreichend.`);
  }
}

// Erkennung wann ein Server wirklich online ist
function isServerReady(game, loader, line) {
  switch (game) {
    case 'Minecraft':
      // Vanilla/Paper/Spigot/Fabric/Forge/NeoForge
      return line.includes('Done') && line.includes('For help');
    case 'Satisfactory':
      return line.includes('Server started') ||
             line.includes('Server is up') ||
             line.includes('Listening on port');
    case 'CS2':
  return line.includes('Server is hibernating') ||
         line.includes('VAC secure mode') ||
         line.includes('Network: IP') ||
         line.includes('Assigned anonymous gameserver') ||
         line.includes('sv_setsteamaccount');
    case 'Valheim':
      return line.includes('Game server connected') ||
             line.includes('Zonesystem Awake') ||
             line.includes('DungeonDB Awake');
    case 'ARK':
      return line.includes('Server started') ||
             line.includes('Full server startup');
    default:
      return false;
  }
}

async function startServer(serverId, io) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) throw new Error('Server nicht gefunden');
  if (runningServers.has(serverId)) throw new Error('Server läuft bereits');

  const serverPath = server.path;
  if (!fs.existsSync(serverPath)) {
    throw new Error('Server-Verzeichnis nicht gefunden — bitte erst installieren');
  }

  let command, args;
  const isWindows = process.platform === 'win32';

  if (server.game === 'Minecraft') {
    const isForge = server.loader === 'forge' || server.loader === 'neoforge';

    if (isForge) {
      const runScript = path.join(serverPath, isWindows ? 'run.bat' : 'run.sh');
      if (!fs.existsSync(runScript)) {
        throw new Error('run.bat/run.sh nicht gefunden — bitte erst installieren');
      }

      if (isWindows) {
        const batContent = fs.readFileSync(runScript, 'utf8');
        const javaLine = batContent.split('\n').find(l => l.trim().startsWith('java '));
        if (!javaLine) throw new Error('Kein java Befehl in run.bat gefunden');
        const cleanLine = javaLine.trim().replace('%*', '').replace('pause', '').trim();
        command = 'cmd';
        args = ['/c', cleanLine];
      } else {
        const shContent = fs.readFileSync(runScript, 'utf8');
        const javaLine = shContent.split('\n').find(l => l.trim().startsWith('java ') || l.trim().startsWith('exec java '));
        if (javaLine) {
          const cleanLine = javaLine.trim()
            .replace(/^exec\s+/, '')
            .replace('"$@"', '')
            .replace("'$@'", '')
            .trim();
          command = 'bash';
          args = ['-c', cleanLine];
        } else {
          command = 'bash';
          args = [runScript];
        }
      }
    } else {
      const jarFile = path.join(serverPath, 'server.jar');
      if (!fs.existsSync(jarFile)) {
        throw new Error('server.jar nicht gefunden — bitte erst installieren');
      }
      command = 'java';
      args = [
        `-Xmx${server.ram || 4}G`,
        `-Xms1G`,
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-jar', 'server.jar',
        '--nogui'
      ];
    }
  } else if (server.game === 'Satisfactory') {
    if (isWindows) {
      command = 'cmd';
      args = ['/c', `"${path.resolve(path.join(serverPath, 'FactoryServer.exe'))}" -unattended`];
    } else {
      command = path.join(serverPath, 'FactoryServer.sh');
      args = ['-unattended'];
    }
   } else if (server.game === 'CS2') {
    if (isWindows) {
      command = 'cmd';
      args = ['/c', `"${path.resolve(path.join(serverPath, 'srcds.exe'))}" -dedicated -port ${server.port || 27015} -game csgo`];
    } else {
      command = 'bash';
      args = [path.join(serverPath, 'srcds_run'), '-dedicated', `-port ${server.port || 27015}`, '-game', 'csgo'];
    }
  } else if (server.game === 'Valheim') {
    command = path.join(serverPath, isWindows ? 'valheim_server.exe' : 'valheim_server.x86_64');
    args = ['-name', server.name, '-port', server.port || 2456, '-nographics', '-batchmode'];
  } else if (server.game === 'ARK') {
    command = path.join(serverPath, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGameServer.exe');
    args = [`TheIsland?listen?Port=${server.port || 7777}`];
  } else {
    throw new Error(`Spiel "${server.game}" wird noch nicht unterstützt`);
  }

  const logDir = path.join(serverPath, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'gamepanel.log');

  if (server.game === 'Minecraft' && command === 'java') {
    checkJavaForMinecraft(server);
  }

  console.log('Starte Server mit Befehl:', command, args);

  const child = spawn(command, args, {
    cwd: serverPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true
  });

  runningServers.set(serverId, {
    process: child,
    startTime: Date.now(),
    pid: child.pid
  });

  // Status auf booting setzen
  db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('booting', serverId);
  io.emit(`server-status-${serverId}`, { status: 'booting' });
  io.emit('servers-updated');

  let isOnline = false;

  const emitLog = (type, data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      line = line.trim();
      if (!line) return;

      io.emit(`server-log-${serverId}`, {
        time: new Date().toLocaleTimeString('de-DE', {
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }),
        type,
        message: line
      });
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${type}] ${line}\n`);

      // Prüfen ob Server bereit ist
      if (!isOnline && isServerReady(server.game, server.loader, line)) {
        isOnline = true;
        db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('online', serverId);
        io.emit(`server-status-${serverId}`, { status: 'online' });
        io.emit('servers-updated');
        console.log(`Server ${server.name} ist jetzt online!`);
      }
    });
  };

  child.stdout.on('data', data => emitLog('info', data));
  child.stderr.on('data', data => emitLog('warn', data));

  child.on('error', (err) => {
    emitLog('error', `Prozess-Fehler: ${err.message}`);
    runningServers.delete(serverId);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', serverId);
    io.emit(`server-status-${serverId}`, { status: 'offline' });
    io.emit('servers-updated');
  });

  child.on('close', (code) => {
    runningServers.delete(serverId);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', serverId);
    io.emit(`server-log-${serverId}`, {
      time: new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }),
      type: 'warn',
      message: `Server gestoppt (Exit code: ${code})`
    });
    io.emit(`server-status-${serverId}`, { status: 'offline' });
    io.emit('servers-updated');
  });

  return { pid: child.pid };
}

async function stopServer(serverId) {
  const entry = runningServers.get(serverId);
  if (!entry) throw new Error('Server läuft nicht');

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);

  return new Promise((resolve) => {
    if (server.game === 'Minecraft' && entry.process.stdin) {
      try { entry.process.stdin.write('stop\n'); } catch (e) {}
    } else if (server.game === 'Satisfactory' && entry.process.stdin) {
      try { entry.process.stdin.write('quit\n'); } catch (e) {}
    }

    const timeout = setTimeout(() => {
      if (runningServers.has(serverId)) {
        treeKill(entry.process.pid, 'SIGKILL');
        runningServers.delete(serverId);
        db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', serverId);
      }
      resolve();
    }, 10000);

    entry.process.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function sendCommand(serverId, command) {
  const entry = runningServers.get(serverId);
  if (!entry) throw new Error('Server läuft nicht');
  if (!entry.process.stdin) throw new Error('Stdin nicht verfügbar');
  entry.process.stdin.write(command + '\n');
  return true;
}

function isRunning(serverId) {
  return runningServers.has(serverId);
}

function getServerInfo(serverId) {
  const entry = runningServers.get(serverId);
  if (!entry) return null;
  return {
    pid: entry.process.pid,
    uptime: Math.round((Date.now() - entry.startTime) / 1000)
  };
}

function getLogs(serverId, lines = 100) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) return [];
  const logFile = path.join(server.path, 'logs', 'gamepanel.log');
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf8');
  return content.split('\n').filter(Boolean).slice(-lines);
}

function syncServerStatus() {
  db.prepare("UPDATE servers SET status = 'offline' WHERE status = 'installing'").run();
  console.log('Server-Status synchronisiert');
}

module.exports = { startServer, stopServer, sendCommand, isRunning, getServerInfo, getLogs, syncServerStatus };