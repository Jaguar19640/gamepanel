const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { getDownloadUrl } = require('./versions');
const db = require('./database');

function emitProgress(io, serverId, message, percent) {
  io.emit(`install-${serverId}`, { message, percent });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const handleResponse = (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath, onProgress)
          .then(resolve).catch(reject);
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize && onProgress) {
          onProgress(Math.round((downloaded / totalSize) * 100));
        }
      });

      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    };

    https.get(url, handleResponse).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function acceptEula(serverPath) {
  fs.writeFileSync(
    path.join(serverPath, 'eula.txt'),
    '#GamePanel - EULA automatically accepted\neula=true\n'
  );
}

function createServerProperties(serverPath, config) {
  const props = [
    `server-port=${config.port || 25565}`,
    `max-players=${config.max_players || 20}`,
    `gamemode=survival`,
    `difficulty=normal`,
    `online-mode=true`,
    `white-list=false`,
    `motd=A Minecraft Server - Powered by GamePanel`,
    `view-distance=10`,
    `spawn-protection=16`,
    `enable-command-block=false`,
  ].join('\n');
  fs.writeFileSync(path.join(serverPath, 'server.properties'), props);
}

function runInstaller(jarPath, serverPath, io, serverId) {
  return new Promise((resolve, reject) => {
    emitProgress(io, serverId, '⚙️ Führe Installer aus...', 80);

    // Absoluten Pfad verwenden
    const absoluteJar = path.resolve(jarPath);
    const absolutePath = path.resolve(serverPath);

    console.log('Absoluter Jar-Pfad:', absoluteJar);
    console.log('Absoluter Server-Pfad:', absolutePath);

    const installer = spawn('java', [
      '-jar', absoluteJar,
      '--installServer'
    ], {
      cwd: absolutePath,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let errorOutput = '';

    installer.stdout.on('data', d => {
      const line = d.toString().trim();
      console.log('Installer stdout:', line);
      if (line) emitProgress(io, serverId, line.slice(0, 100), 85);
    });

    installer.stderr.on('data', d => {
      const line = d.toString().trim();
      console.log('Installer stderr:', line);
      errorOutput += line + '\n';
    });

    installer.on('close', (code) => {
      console.log('Installer Exit Code:', code);
      if (code === 0) resolve();
      else reject(new Error(`Installer fehlgeschlagen (Exit ${code}): ${errorOutput.slice(0, 200)}`));
    });

    installer.on('error', (err) => {
      console.log('Spawn Fehler:', err);
      reject(err);
    });
  });
}


async function installMinecraft(server, io) {
  const { id, path: serverPath, version, loader, ram, port, max_players } = server;

  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    emitProgress(io, id, '📁 Erstelle Server-Verzeichnis...', 5);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, `🔍 Lade ${loader} ${version} Download-URL...`, 10);
    const downloadUrl = await getDownloadUrl(loader, version);

    emitProgress(io, id, `⬇ Lade ${loader} ${version} herunter...`, 15);

    const isForge = loader === 'forge' || loader === 'neoforge';
    const jarName = isForge ? 'installer.jar' : 'server.jar';
    const jarPath = path.join(serverPath, jarName);

    await downloadFile(downloadUrl, jarPath, (percent) => {
      emitProgress(io, id, `⬇ Herunterladen... ${percent}%`, 15 + Math.round(percent * 0.6));
    });

    // Forge/NeoForge: Installer ausführen
    if (isForge) {
      await runInstaller(jarPath, serverPath, io, id);

      // Nach Installation run.bat/run.sh prüfen
      const isWindows = process.platform === 'win32';
      const runScript = path.join(serverPath, isWindows ? 'run.bat' : 'run.sh');

      if (!fs.existsSync(runScript)) {
        // Manche Versionen erstellen user_jvm_args.txt und run.sh selbst
        // Fallback: server.jar direkt suchen
        const serverJar = path.join(serverPath, 'server.jar');
        if (!fs.existsSync(serverJar)) {
          throw new Error('Installation abgeschlossen aber kein Start-Skript gefunden');
        }
      }
    }

    emitProgress(io, id, '📝 Erstelle Konfigurationsdateien...', 90);
    acceptEula(serverPath);
    createServerProperties(serverPath, { port, max_players });

    emitProgress(io, id, '✅ Installation abgeschlossen!', 100);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });

  } catch (err) {
    console.error('Installation fehlgeschlagen:', err);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

async function installSatisfactory(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      fs.writeFileSync(path.join(serverPath, 'install.bat'), [
        '@echo off',
        'steamcmd +force_install_dir "%~dp0" +login anonymous +app_update 1690800 validate +quit',
      ].join('\n'));
    } else {
      const sh = [
        '#!/bin/bash',
        `steamcmd +force_install_dir "${serverPath}" +login anonymous +app_update 1690800 validate +quit`,
      ].join('\n');
      fs.writeFileSync(path.join(serverPath, 'install.sh'), sh);
      fs.chmodSync(path.join(serverPath, 'install.sh'), '755');
    }

    emitProgress(io, id, '📝 Install-Skript erstellt — bitte install.sh auf dem Server ausführen', 100);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

async function installCS2(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      fs.writeFileSync(path.join(serverPath, 'install.bat'), [
        '@echo off',
        'steamcmd +force_install_dir "%~dp0" +login anonymous +app_update 730 validate +quit',
      ].join('\n'));
    } else {
      const sh = [
        '#!/bin/bash',
        `steamcmd +force_install_dir "${serverPath}" +login anonymous +app_update 730 validate +quit`,
      ].join('\n');
      fs.writeFileSync(path.join(serverPath, 'install.sh'), sh);
      fs.chmodSync(path.join(serverPath, 'install.sh'), '755');
    }

    emitProgress(io, id, '📝 Install-Skript erstellt — bitte install.sh auf dem Server ausführen', 100);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

async function installServer(serverId, io) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) throw new Error('Server nicht gefunden');

  switch (server.game) {
    case 'Minecraft':    return await installMinecraft(server, io);
    case 'Satisfactory': return await installSatisfactory(server, io);
    case 'CS2':          return await installCS2(server, io);
    default: throw new Error(`Installation für ${server.game} nicht implementiert`);
  }
}

module.exports = { installServer };