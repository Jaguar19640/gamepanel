const https = require('https');

// HTTP Helper
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ─── VANILLA ─────────────────────────────────────────
async function getVanillaVersions() {
  const data = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
  return {
    latest: data.latest,
    versions: data.versions.map(v => ({
      id: v.id,
      type: v.type, // release, snapshot, old_beta, old_alpha
      releaseTime: v.releaseTime,
      url: v.url
    }))
  };
}

async function getVanillaDownloadUrl(versionId) {
  const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
  const version = manifest.versions.find(v => v.id === versionId);
  if (!version) throw new Error(`Version ${versionId} nicht gefunden`);

  const versionData = await fetchJson(version.url);
  return versionData.downloads.server.url;
}

// ─── PAPER ───────────────────────────────────────────
async function getPaperVersions() {
  const data = await fetchJson('https://api.papermc.io/v2/projects/paper');
  return data.versions.reverse(); // Neueste zuerst
}

async function getPaperBuilds(version) {
  const data = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${version}`);
  return data.builds;
}

async function getPaperDownloadUrl(version) {
  const builds = await getPaperBuilds(version);
  const latestBuild = builds[builds.length - 1];
  return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/paper-${version}-${latestBuild}.jar`;
}

// ─── PURPUR ──────────────────────────────────────────
async function getPurpurVersions() {
  const data = await fetchJson('https://api.purpurmc.org/v2/purpur');
  return data.versions.reverse();
}

async function getPurpurDownloadUrl(version) {
  return `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
}

// ─── FABRIC ──────────────────────────────────────────
async function getFabricVersions() {
  const data = await fetchJson('https://meta.fabricmc.net/v2/versions/game');
  return data.filter(v => v.stable).map(v => v.version);
}

async function getFabricDownloadUrl(version) {
  const loaderData = await fetchJson('https://meta.fabricmc.net/v2/versions/loader');
  const installerData = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
  const loader = loaderData[0].version;
  const installer = installerData[0].version;
  return `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/${installer}/server/jar`;
}

// ─── FORGE ───────────────────────────────────────────
async function getForgeVersions() {
  const data = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json');
  return Object.keys(data).reverse();
}

// ─── NEOFORGE ────────────────────────────────────────
async function getNeoForgeVersions() {
  const data = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  const all = data.versions.reverse();

  const releases = all.filter(v => !v.includes('beta') && !v.includes('rc') && !v.includes('alpha'));
  const betas = all.filter(v => v.includes('beta') || v.includes('rc'));

  // NeoForge Version z.B. "21.1.228" → MC Version "1.21.1"
  // Erste Zahl = MC Minor (21 = 1.21.x), zweite Zahl = MC Patch (1 = .1)
  const latestPerMC = {};
  releases.forEach(v => {
    const parts = v.split('.');
    if (parts.length >= 2) {
      // z.B. 21.1.228 → mcKey = "21.1" = MC 1.21.1
      const mcKey = parts[0] + '.' + parts[1];
      if (!latestPerMC[mcKey]) {
        latestPerMC[mcKey] = v; // Erste = neueste weil wir reversed haben
      }
    }
  });

  // Sortiert nach MC-Version, neueste zuerst
  const filtered = Object.entries(latestPerMC)
    .sort((a, b) => {
      const [aMaj, aMin] = a[0].split('.').map(Number);
      const [bMaj, bMin] = b[0].split('.').map(Number);
      if (bMaj !== aMaj) return bMaj - aMaj;
      return bMin - aMin;
    })
    .map(([mcKey, version]) => version);

  return { releases: filtered, betas: betas.slice(0, 30) };
}


// ─── SPIGOT ──────────────────────────────────────────
async function getSpigotVersions() {
  // Spigot hat keine offizielle API — bekannte Versionen
  return [
    '1.23.1','1.22.1','1.21.1','1.21','1.20.6','1.20.4','1.20.2','1.20.1',
    '1.19.4','1.19.3','1.19.2','1.19.1','1.19',
    '1.18.2','1.18.1','1.18','1.17.1','1.17',
    '1.16.5','1.16.4','1.16.3','1.16.2','1.16.1',
    '1.15.2','1.14.4','1.13.2','1.12.2','1.8.8'
  ];
}

// ─── QUILT ───────────────────────────────────────────
async function getQuiltVersions() {
  const data = await fetchJson('https://meta.quiltmc.org/v3/versions/game');
  return data.filter(v => v.stable).map(v => v.version);
}

// ─── HAUPT-FUNKTION ──────────────────────────────────
async function getVersions(loader, includeBeta = false) {
  switch (loader) {
    case 'vanilla': {
      const data = await getVanillaVersions();
      const releases = data.versions.filter(v => v.type === 'release').map(v => v.id);
      const snapshots = data.versions.filter(v => v.type === 'snapshot').map(v => v.id);
      const betas = data.versions.filter(v => v.type === 'old_beta' || v.type === 'old_alpha').map(v => v.id);
      if (includeBeta) return [...releases, ...snapshots, ...betas];
      return releases;
    }
    case 'paper':    return await getPaperVersions();
    case 'purpur':   return await getPurpurVersions();
    case 'fabric': {
      const data = await fetchJson('https://meta.fabricmc.net/v2/versions/game');
      const releases = data.filter(v => v.stable).map(v => v.version);
      const snapshots = data.filter(v => !v.stable).map(v => v.version);
      if (includeBeta) return [...releases, ...snapshots];
      return releases;
    }
    case 'forge':    return await getForgeVersions();
    case 'neoforge': {
      const data = await getNeoForgeVersions();
      if (includeBeta) return [...data.releases, ...data.betas];
      return data.releases;
    }
    case 'spigot':   return await getSpigotVersions();
    default: return [];
    case 'quilt': {
      const data = await fetchJson('https://meta.quiltmc.org/v3/versions/game');
      const releases = data.filter(v => v.stable).map(v => v.version);
      const snapshots = data.filter(v => !v.stable).map(v => v.version);
      if (includeBeta) return [...releases, ...snapshots];
      return releases;
    }
  }
}

async function getDownloadUrl(loader, version) {
  switch (loader) {
    case 'vanilla': return await getVanillaDownloadUrl(version);
    case 'paper':   return await getPaperDownloadUrl(version);
    case 'purpur':  return await getPurpurDownloadUrl(version);
    case 'fabric':  return await getFabricDownloadUrl(version);
    case 'neoforge': {
      // NeoForge Installer herunterladen
      return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    }
    case 'forge': {
      // Forge braucht spezielle Version-Strings wie "1.20.1-47.2.0"
      throw new Error('Forge Download — bitte Version im Format "1.20.1-47.2.0" angeben');
    }
    default: throw new Error(`Download für ${loader} noch nicht implementiert`);
  }
}

module.exports = { getVersions, getDownloadUrl, getVanillaVersions, getPaperVersions };