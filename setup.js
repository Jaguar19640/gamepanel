const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

console.log('🚀 GamePanel Setup wird gestartet...\n');

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const handleResponse = (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    };
    https.get(url, handleResponse).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function installSteamCMDWindows() {
  console.log('📦 Installiere SteamCMD für Windows...');
  const steamDir = path.join(process.cwd(), 'steamcmd');
  const steamZip = path.join(steamDir, 'steamcmd.zip');
  const steamExe = path.join(steamDir, 'steamcmd.exe');

  if (fs.existsSync(steamExe)) {
    console.log('✅ SteamCMD bereits installiert:', steamExe);
    return steamExe;
  }

  fs.mkdirSync(steamDir, { recursive: true });

  console.log('⬇ Lade SteamCMD herunter...');
  await downloadFile(
    'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
    steamZip
  );

  console.log('📂 Entpacke SteamCMD...');
  try {
    execSync(`powershell -command "Expand-Archive -Path '${steamZip}' -DestinationPath '${steamDir}' -Force"`, {
      stdio: 'inherit'
    });
  } catch (e) {
    throw new Error('Entpacken fehlgeschlagen: ' + e.message);
  }

  fs.unlinkSync(steamZip);

  console.log('⚙️ Initialisiere SteamCMD (erster Start)...');
  await new Promise((resolve) => {
    const proc = spawn(steamExe, ['+quit'], { stdio: 'inherit' });
    proc.on('close', resolve);
    proc.on('error', resolve);
  });

  console.log('✅ SteamCMD installiert:', steamExe);
  return steamExe;
}

async function installSteamCMDLinux() {
  console.log('📦 Installiere SteamCMD für Linux...');

  // Prüfen ob bereits installiert
  try {
    execSync('which steamcmd', { stdio: 'pipe' });
    console.log('✅ SteamCMD bereits installiert');
    return 'steamcmd';
  } catch {}

  try {
    console.log('⬇ Installiere SteamCMD über apt...');
    execSync('sudo add-apt-repository multiverse -y', { stdio: 'inherit' });
    execSync('sudo dpkg --add-architecture i386', { stdio: 'inherit' });
    execSync('sudo apt-get update -y', { stdio: 'inherit' });
    execSync('echo "steamcmd steam/question select I AGREE" | sudo debconf-set-selections', { stdio: 'inherit' });
    execSync('sudo apt-get install -y steamcmd', { stdio: 'inherit' });
    console.log('✅ SteamCMD installiert');
    return 'steamcmd';
  } catch (e) {
    // Fallback: manuell installieren
    console.log('⚠️ apt fehlgeschlagen, installiere manuell...');
    const steamDir = path.join(process.cwd(), 'steamcmd');
    const steamTar = path.join(steamDir, 'steamcmd_linux.tar.gz');
    const steamSh = path.join(steamDir, 'steamcmd.sh');

    fs.mkdirSync(steamDir, { recursive: true });
    await downloadFile(
      'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
      steamTar
    );

    execSync(`tar -xzf "${steamTar}" -C "${steamDir}"`, { stdio: 'inherit' });
    fs.unlinkSync(steamTar);
    fs.chmodSync(steamSh, '755');

    console.log('✅ SteamCMD manuell installiert:', steamSh);
    return steamSh;
  }
}

async function createEnvFile(steamPath) {
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';

  // Bestehende .env lesen falls vorhanden
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // STEAMCMD_PATH setzen oder updaten
  if (envContent.includes('STEAMCMD_PATH=')) {
    envContent = envContent.replace(/STEAMCMD_PATH=.*/g, `STEAMCMD_PATH=${steamPath}`);
  } else {
    envContent += `\nSTEAMCMD_PATH=${steamPath}`;
  }

  // Standard-Werte hinzufügen falls nicht vorhanden
  if (!envContent.includes('PORT=')) {
    envContent += '\nPORT=3000';
  }
  if (!envContent.includes('JWT_SECRET=')) {
    const secret = require('crypto').randomBytes(32).toString('hex');
    envContent += `\nJWT_SECRET=${secret}`;
  }
  if (!envContent.includes('SERVERS_PATH=')) {
    envContent += '\nSERVERS_PATH=./servers';
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ .env Datei aktualisiert');
}

async function checkJava() {
  console.log('\n☕ Prüfe Java...');
  try {
    const version = execSync('java -version 2>&1', { encoding: 'utf8' });
    console.log('✅ Java gefunden:', version.split('\n')[0]);
  } catch {
    console.log('⚠️ Java nicht gefunden!');
    if (isLinux) {
      console.log('📦 Installiere Java 21...');
      try {
        execSync('sudo apt-get install -y openjdk-21-jre-headless', { stdio: 'inherit' });
        console.log('✅ Java 21 installiert');
      } catch (e) {
        console.log('❌ Java-Installation fehlgeschlagen — bitte manuell installieren');
        console.log('   sudo apt-get install openjdk-21-jre-headless');
      }
    } else {
      console.log('❌ Bitte Java 21 manuell installieren: https://adoptium.net');
    }
  }
}

async function checkNodeModules() {
  console.log('\n📦 Prüfe Node.js Module...');
  if (!fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
    console.log('⬇ Installiere npm packages...');
    execSync('npm install', { stdio: 'inherit' });
  } else {
    console.log('✅ node_modules vorhanden');
  }
}

async function createDirectories() {
  console.log('\n📁 Erstelle Verzeichnisse...');
  const dirs = ['servers', 'backups', 'tmp', 'logs'];
  dirs.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log('✅ Erstellt:', dir);
    }
  });
}

async function main() {
  try {
    await checkNodeModules();
    await checkJava();
    await createDirectories();

    console.log('\n📦 Installiere SteamCMD...');
    let steamPath;
    if (isWindows) {
      steamPath = await installSteamCMDWindows();
    } else if (isLinux) {
      steamPath = await installSteamCMDLinux();
    } else {
      console.log('⚠️ macOS: SteamCMD muss manuell installiert werden');
      steamPath = 'steamcmd';
    }

    await createEnvFile(steamPath);

    console.log('\n✅ GamePanel Setup abgeschlossen!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Starten mit: node server.js');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('\n❌ Setup fehlgeschlagen:', err.message);
    process.exit(1);
  }
}

main();