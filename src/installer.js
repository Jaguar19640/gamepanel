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
    const absoluteJar = path.resolve(jarPath);
    const absolutePath = path.resolve(serverPath);

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
      if (line) emitProgress(io, serverId, line.slice(0, 100), 85);
    });
    installer.stderr.on('data', d => {
      errorOutput += d.toString().trim() + '\n';
    });
    installer.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer fehlgeschlagen (Exit ${code}): ${errorOutput.slice(0, 200)}`));
    });
    installer.on('error', reject);
  });
}

// ─── STEAMCMD HELPER ─────────────────────────────────
const isWindows = process.platform === 'win32';

function getSteamCmd() {
  return process.env.STEAMCMD_PATH || (isWindows ? 'steamcmd.exe' : 'steamcmd');
}

async function checkSteamCmd() {
  const cmd = getSteamCmd();
  return new Promise((resolve) => {
    const test = spawn(cmd, ['+quit'], { shell: true });
    test.on('close', (code) => resolve(code === 0 || code === 7));
    test.on('error', () => resolve(false));
  });
}

async function installViaSteamCmd(serverPath, appId, io, serverId, startPercent = 20) {
  const cmd = getSteamCmd();
  return new Promise((resolve, reject) => {
    const steam = spawn(cmd, [
      '+force_install_dir', path.resolve(serverPath),
      '+login', 'anonymous',
      '+app_update', appId, 'validate',
      '+quit'
    ], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });

    steam.stdout.on('data', d => {
      const line = d.toString().trim();
      if (line) emitProgress(io, serverId, line.slice(0, 100), startPercent);
    });
    steam.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line) console.log('SteamCMD stderr:', line);
    });
    steam.on('close', (code) => {
      if (code === 0 || code === 7) resolve();
      else reject(new Error(`SteamCMD fehlgeschlagen (Exit ${code})`));
    });
    steam.on('error', reject);
  });
}

function createSteamInstallScript(serverPath, appId) {
  if (isWindows) {
    fs.writeFileSync(path.join(serverPath, 'install.bat'), [
      '@echo off',
      `echo Installiere Server (App ${appId})...`,
      `steamcmd +force_install_dir "%~dp0" +login anonymous +app_update ${appId} validate +quit`,
      'pause'
    ].join('\r\n'));
  } else {
    const sh = [
      '#!/bin/bash',
      `echo "Installiere Server (App ${appId})..."`,
      `steamcmd +force_install_dir "${path.resolve(serverPath)}" +login anonymous +app_update ${appId} validate +quit`,
    ].join('\n');
    fs.writeFileSync(path.join(serverPath, 'install.sh'), sh);
    fs.chmodSync(path.join(serverPath, 'install.sh'), '755');
  }
}

// ─── MINECRAFT ───────────────────────────────────────
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

    if (isForge) {
      await runInstaller(jarPath, serverPath, io, id);

      const runScript = path.join(serverPath, isWindows ? 'run.bat' : 'run.sh');
      if (!fs.existsSync(runScript)) {
        const serverJar = path.join(serverPath, 'server.jar');
        if (!fs.existsSync(serverJar)) {
          throw new Error('Installation abgeschlossen aber kein Start-Skript gefunden');
        }
      }

      // RAM in user_jvm_args.txt konfigurieren
      const jvmArgsFile = path.join(serverPath, 'user_jvm_args.txt');
      const jvmArgs = [
        '# GamePanel - Automatically configured JVM Arguments',
        `-Xmx${ram || 4}G`,
        `-Xms1G`,
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC',
      ].join('\n');
      fs.writeFileSync(jvmArgsFile, jvmArgs);
      emitProgress(io, id, `✅ RAM auf ${ram || 4}GB konfiguriert`, 95);
    }

    emitProgress(io, id, '📝 Erstelle Konfigurationsdateien...', 90);
    acceptEula(serverPath);
    createServerProperties(serverPath, { port, max_players });

    emitProgress(io, id, '✅ Installation abgeschlossen!', 100);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    console.error('Minecraft Installation fehlgeschlagen:', err);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── SATISFACTORY ────────────────────────────────────
async function installSatisfactory(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, '🔍 Prüfe SteamCMD...', 10);
    const steamAvailable = await checkSteamCmd();

    if (steamAvailable) {
      emitProgress(io, id, '⬇ Installiere Satisfactory über SteamCMD (App 1690800)...', 20);
      await installViaSteamCmd(serverPath, '1690800', io, id, 50);
      emitProgress(io, id, '✅ Satisfactory installiert!', 100);
    } else {
      emitProgress(io, id, '⚠️ SteamCMD nicht gefunden — erstelle Install-Skript...', 50);
      createSteamInstallScript(serverPath, '1690800');
      emitProgress(io, id, '📝 install.sh erstellt — bitte manuell ausführen', 100);
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── CS2 ─────────────────────────────────────────────
async function installCS2(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, '🔍 Prüfe SteamCMD...', 10);
    const steamAvailable = await checkSteamCmd();

    if (steamAvailable) {
      // CS2 braucht einen Steam-Account mit CS2-Lizenz
      // App 730 = CS2 Client, App 740 = CS2 Dedicated Server (kostenlos)
      emitProgress(io, id, '⬇ Installiere CS2 Dedicated Server über SteamCMD (App 740)...', 20);
      await installViaSteamCmd(serverPath, '740', io, id, 50);
      emitProgress(io, id, '✅ CS2 Dedicated Server installiert!', 100);
    } else {
      emitProgress(io, id, '⚠️ SteamCMD nicht gefunden — erstelle Install-Skript...', 50);
      createSteamInstallScript(serverPath, '740');
      emitProgress(io, id, '📝 install.sh erstellt — bitte manuell ausführen', 100);
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── VALHEIM ─────────────────────────────────────────
async function installValheim(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, '🔍 Prüfe SteamCMD...', 10);
    const steamAvailable = await checkSteamCmd();

    if (steamAvailable) {
      emitProgress(io, id, '⬇ Installiere Valheim über SteamCMD (App 896660)...', 20);
      await installViaSteamCmd(serverPath, '896660', io, id, 50);
      emitProgress(io, id, '✅ Valheim installiert!', 100);
    } else {
      emitProgress(io, id, '⚠️ SteamCMD nicht gefunden — erstelle Install-Skript...', 50);
      createSteamInstallScript(serverPath, '896660');
      emitProgress(io, id, '📝 install.sh erstellt — bitte manuell ausführen', 100);
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── ARK ─────────────────────────────────────────────
async function installARK(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, '🔍 Prüfe SteamCMD...', 10);
    const steamAvailable = await checkSteamCmd();

    if (steamAvailable) {
      // ARK: Survival Ascended App ID
      emitProgress(io, id, '⬇ Installiere ARK über SteamCMD (App 2430930)...', 20);
      await installViaSteamCmd(serverPath, '2430930', io, id, 50);
      emitProgress(io, id, '✅ ARK installiert!', 100);
    } else {
      emitProgress(io, id, '⚠️ SteamCMD nicht gefunden — erstelle Install-Skript...', 50);
      createSteamInstallScript(serverPath, '2430930');
      emitProgress(io, id, '📝 install.sh erstellt — bitte manuell ausführen', 100);
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── RUST ────────────────────────────────────────────
async function installRust(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, '🔍 Prüfe SteamCMD...', 10);
    const steamAvailable = await checkSteamCmd();

    if (steamAvailable) {
      emitProgress(io, id, '⬇ Installiere Rust über SteamCMD (App 258550)...', 20);
      await installViaSteamCmd(serverPath, '258550', io, id, 50);
      emitProgress(io, id, '✅ Rust installiert!', 100);
    } else {
      emitProgress(io, id, '⚠️ SteamCMD nicht gefunden — erstelle Install-Skript...', 50);
      createSteamInstallScript(serverPath, '258550');
      emitProgress(io, id, '📝 install.sh erstellt — bitte manuell ausführen', 100);
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── TERRARIA ────────────────────────────────────────
async function installTerraria(server, io) {
  const { id, path: serverPath } = server;
  try {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', id);
    fs.mkdirSync(serverPath, { recursive: true });

    emitProgress(io, id, '🔍 Prüfe SteamCMD...', 10);
    const steamAvailable = await checkSteamCmd();

    if (steamAvailable) {
      emitProgress(io, id, '⬇ Installiere Terraria über SteamCMD (App 105600)...', 20);
      await installViaSteamCmd(serverPath, '105600', io, id, 50);
      emitProgress(io, id, '✅ Terraria installiert!', 100);
    } else {
      emitProgress(io, id, '⚠️ SteamCMD nicht gefunden — erstelle Install-Skript...', 50);
      createSteamInstallScript(serverPath, '105600');
      emitProgress(io, id, '📝 install.sh erstellt — bitte manuell ausführen', 100);
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('offline', id);
    io.emit(`install-done-${id}`, { success: true });
  } catch (err) {
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('install_failed', id);
    emitProgress(io, id, `❌ Fehler: ${err.message}`, 0);
    io.emit(`install-done-${id}`, { success: false, error: err.message });
  }
}

// ─── HAUPT-FUNKTION ──────────────────────────────────
async function installServer(serverId, io) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) throw new Error('Server nicht gefunden');

  switch (server.game) {
    case 'Minecraft':    return await installMinecraft(server, io);
    case 'Satisfactory': return await installSatisfactory(server, io);
    case 'CS2':          return await installCS2(server, io);
    case 'Valheim':      return await installValheim(server, io);
    case 'ARK':          return await installARK(server, io);
    case 'Rust':         return await installRust(server, io);
    case 'Terraria':     return await installTerraria(server, io);
    default: throw new Error(`Installation für ${server.game} nicht implementiert`);
  }
}

module.exports = { installServer };