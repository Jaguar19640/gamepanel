let token = localStorage.getItem('token');
let currentUser = null;
const socket = io();

// ─── AUTH ───────────────────────────────────────────
async function login() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.style.display = 'block';
    return;
  }

  token = data.token;
  currentUser = data.user;
  localStorage.setItem('token', token);
  errEl.style.display = 'none';

  if (currentUser.is_temp) {
    showScreen('setup');
  } else if (currentUser.must_change_password) {
    showScreen('change-password');
  } else {
    showScreen('app');
    initApp();
  }
}

async function setupAdmin() {
  const username = document.getElementById('setup-username').value;
  const email = document.getElementById('setup-email').value;
  const password = document.getElementById('setup-password').value;
  const password2 = document.getElementById('setup-password2').value;
  const errEl = document.getElementById('setup-error');

  if (!username || !password) {
    errEl.textContent = 'Bitte alle Pflichtfelder ausfüllen';
    errEl.style.display = 'block';
    return;
  }
  if (password !== password2) {
    errEl.textContent = 'Passwörter stimmen nicht überein';
    errEl.style.display = 'block';
    return;
  }

  // Beim Setup-Admin: direkt mit Passwort registrieren
  // Wir nutzen eine separate Route die kein OTP generiert
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ username, email, password, role: 'admin' })
  });

  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.style.display = 'block';
    return;
  }

  // Neu einloggen mit neuem Account
  localStorage.removeItem('token');
  token = null;
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
  await login();
}

function logout() {
  localStorage.removeItem('token');
  token = null;
  currentUser = null;
  showScreen('login');
}

function showScreen(screen) {
  document.getElementById('login-screen').style.display = screen === 'login' ? 'flex' : 'none';
  document.getElementById('setup-screen').style.display = screen === 'setup' ? 'flex' : 'none';
  document.getElementById('change-password-screen').style.display = screen === 'change-password' ? 'flex' : 'none';
  document.getElementById('app').style.display = screen === 'app' ? 'block' : 'none';
}

function initApp() {
  document.getElementById('sidebar-user').textContent = '👤 ' + currentUser.username;
  if (currentUser.role === 'admin') {
    document.getElementById('nav-users').style.display = 'block';
  }
  loadDashboard();
}

// ─── NAVIGATION ─────────────────────────────────────
function showPage(name, el) {
  // System-Interval stoppen wenn Dashboard verlassen wird
  if (name !== 'dashboard' && systemInterval) {
    clearInterval(systemInterval);
    systemInterval = null;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'servers') loadServers();
  if (name === 'users') loadUsers();
}

// ─── API HELPER ──────────────────────────────────────
async function api(path, options = {}) {
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...options.headers
      }
    });
    if (res.status === 401) { logout(); return null; }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.error('API Fehler:', path, e.message);
    return null;
  }
}

// ─── DASHBOARD ───────────────────────────────────────
let systemInterval = null;

async function loadDashboard() {
  const servers = await api('/api/servers');
  if (!servers) return;

  const online = servers.filter(s => s.status === 'online').length;
  renderServerList('server-list', servers);

  // System Stats starten
  if (systemInterval) clearInterval(systemInterval);
  loadSystemStats();
  systemInterval = setInterval(loadSystemStats, 3000);
}

async function loadSystemStats() {
  const stats = await api('/api/system/stats');
  if (!stats) return;

 // CPU
const cpuColor = stats.cpu.load > 80 ? '#ef4444' : stats.cpu.load > 60 ? '#f59e0b' : '#22c55e';
document.getElementById('cpu-load').textContent = stats.cpu.load + '%';
document.getElementById('cpu-bar').style.width = stats.cpu.load + '%';
document.getElementById('cpu-bar').style.background = cpuColor;

if (stats.cpu.temp) {
  document.getElementById('cpu-temp').textContent = `🌡️ ${stats.cpu.temp}°C`;
} else {
  document.getElementById('cpu-temp').textContent = '🌡️ N/A';
  
}
const modelEl = document.getElementById('cpu-model');
if (modelEl && stats.cpu.model) {
  modelEl.textContent = `${stats.cpu.model} · ${stats.cpu.physicalCores}C/${stats.cpu.logicalCores}T · ${stats.cpu.sockets} Socket(s)`;
}

// CPU Kerne — gruppiert bei vielen Kernen
const coresEl = document.getElementById('cpu-cores');
const cores = stats.cpu.cores;
if (cores.length > 0) {
  // Durchschnitt berechnen
  const avg = Math.round(cores.reduce((a, c) => a + c.load, 0) / cores.length * 10) / 10;

  // Bei mehr als 8 Kernen: kompaktere Ansicht
  if (cores.length > 8) {
    coresEl.style.gridTemplateColumns = 'repeat(auto-fill,minmax(60px,1fr))';
    coresEl.innerHTML = cores.map(c => {
      const col = c.load > 80 ? '#ef4444' : c.load > 60 ? '#f59e0b' : '#22c55e';
      return `
        <div style="background:#0d1117;border-radius:5px;padding:4px 6px;text-align:center">
          <div style="font-size:9px;color:#6e7681">C${c.core}</div>
          <div style="font-size:11px;font-family:monospace;color:${col}">${c.load}%</div>
          <div style="height:3px;background:#21262d;border-radius:2px;margin-top:2px;overflow:hidden">
            <div style="height:100%;background:${col};width:${c.load}%;transition:width .5s"></div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    coresEl.style.gridTemplateColumns = 'repeat(auto-fill,minmax(80px,1fr))';
    coresEl.innerHTML = cores.map(c => {
      const col = c.load > 80 ? '#ef4444' : c.load > 60 ? '#f59e0b' : '#22c55e';
      return `
        <div style="background:#0d1117;border-radius:5px;padding:5px 7px">
          <div style="font-size:9px;color:#6e7681;margin-bottom:3px">Core ${c.core}</div>
          <div style="font-size:12px;font-family:monospace;color:${col}">${c.load}%</div>
          <div style="height:3px;background:#21262d;border-radius:2px;margin-top:3px;overflow:hidden">
            <div style="height:100%;background:${col};width:${c.load}%;transition:width .5s"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

  // RAM
  const ramColor = stats.ram.percent > 80 ? '#ef4444' : stats.ram.percent > 60 ? '#f59e0b' : '#60a5fa';
  document.getElementById('ram-load').textContent = stats.ram.percent + '%';
  document.getElementById('ram-bar').style.width = stats.ram.percent + '%';
  document.getElementById('ram-bar').style.background = ramColor;
  document.getElementById('ram-detail').textContent =
    `${stats.ram.used} GB verwendet / ${stats.ram.total} GB gesamt`;

  // GPU
  if (stats.gpus && stats.gpus.length > 0) {
    const gpuSection = document.getElementById('gpu-section');
    gpuSection.style.display = 'block';
    document.getElementById('gpu-cards').innerHTML = stats.gpus.map(g => {
      const load = g.load || 0;
      const temp = g.temp || null;
      const gpuColor = load > 80 ? '#ef4444' : load > 60 ? '#f59e0b' : '#a78bfa';
      return `
        <div style="background:#161b22;border:1px solid #21262d;border-radius:8px;padding:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:12px;font-weight:500;color:#f0f6fc">${g.model || 'GPU'}</div>
            ${temp ? `<div style="font-size:11px;color:#8b949e">🌡️ ${temp}°C</div>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <div style="font-size:10px;color:#6e7681;margin-bottom:3px">Auslastung</div>
              <div style="font-size:14px;font-family:monospace;color:${gpuColor}">${load}%</div>
              <div style="height:4px;background:#21262d;border-radius:2px;margin-top:4px;overflow:hidden">
                <div style="height:100%;background:${gpuColor};width:${load}%;transition:width .5s"></div>
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:#6e7681;margin-bottom:3px">VRAM</div>
              <div style="font-size:14px;font-family:monospace;color:#f0f6fc">${g.vram || '—'} MB</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Server Ressourcen
  const resEl = document.getElementById('server-resources');
  if (stats.servers && stats.servers.length > 0) {
    resEl.innerHTML = stats.servers.map(s => {
      const cpuCol = s.cpu > 80 ? '#ef4444' : s.cpu > 60 ? '#f59e0b' : '#22c55e';
      const ramCol = '#60a5fa';
      return `
        <div style="background:#161b22;border:1px solid #21262d;border-radius:8px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:16px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500;color:#f0f6fc">${s.name}</div>
            <div style="font-size:11px;color:#8b949e">${s.game} · PID ${s.pid} · Uptime ${formatUptime(s.uptime)}</div>
          </div>
          <div style="display:flex;gap:20px">
            <div style="text-align:center">
              <div style="font-size:10px;color:#6e7681;margin-bottom:2px">CPU</div>
              <div style="font-size:14px;font-family:monospace;color:${cpuCol}">${s.cpu}%</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:10px;color:#6e7681;margin-bottom:2px">RAM</div>
              <div style="font-size:14px;font-family:monospace;color:${ramCol}">${s.ram} MB</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    resEl.innerHTML = '<p style="color:#6e7681;font-size:12px">Keine Server online</p>';
  }

  document.getElementById('last-update').textContent =
    'Aktualisiert: ' + new Date().toLocaleTimeString('de-DE');
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── SERVER ──────────────────────────────────────────
async function loadServers() {
  const servers = await api('/api/servers');
  if (!servers) return;
  renderServerList('server-list-2', servers);
}

function renderServerList(containerId, servers) {
  const container = document.getElementById(containerId);
  if (!servers.length) {
    container.innerHTML = '<p style="color:#8b949e;padding:12px 0">Keine Server vorhanden.</p>';
    return;
  }
  container.innerHTML = servers.map(s => `
<div class="server-card" onclick="openServerDetail(${s.id})">
      <div style="flex:1">
        <div class="server-name">${s.name}</div>
        <div class="server-meta">
          ${s.game} ${s.version || ''} ${s.loader ? '· ' + s.loader : ''} · Port ${s.port}
        </div>
      </div>
      <div class="status">
        <div class="status-dot ${s.status === 'online' ? 'dot-online' : s.status === 'booting' ? 'dot-booting' : 'dot-offline'}"></div>
        ${s.status === 'online' ? 'Online' : s.status === 'booting' ? '⏳ Booting...' : 'Offline'}
      </div>
      <div class="server-actions">
        ${s.status === 'offline'
          ? `<button class="btn primary" onclick="toggleServer(${s.id},'start')">▶ Start</button>`
          : `<button class="btn red" onclick="toggleServer(${s.id},'stop')">■ Stop</button>`
        }
        <button class="btn red" onclick="deleteServer(${s.id})">✕</button>
      </div>
    </div>
  `).join('');
}

async function toggleServer(id, action) {
  await api(`/api/servers/${id}/${action}`, { method: 'POST' });
  loadDashboard();
  loadServers();
}

async function deleteServer(id) {
  if (!confirm('Server wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden!')) return;

  const res = await api(`/api/servers/${id}?deleteFiles=true`, { 
    method: 'DELETE' 
  });
  
  if (res?.error) return alert(res.error);
  loadDashboard();
  loadServers();
}


// ─── SERVER MODAL ────────────────────────────────────
const defaultPorts = {
  Minecraft: 25565, Satisfactory: 7777,
  CS2: 27015, Valheim: 2456, ARK: 7778,
  Rust: 28015, Terraria: 7777
};

const defaultPlayers = {
  Minecraft: 20, Satisfactory: 4,
  CS2: 10, Valheim: 10, ARK: 70,
  Rust: 50, Terraria: 8
};

function onGameChange() {
  const gameEl = document.getElementById('new-game');
  if (!gameEl) return;
  const game = gameEl.value;
  const mcOptions = document.getElementById('mc-options');
  if (mcOptions) mcOptions.style.display = game === 'Minecraft' ? 'block' : 'none';
  const portEl = document.getElementById('new-port');
  if (portEl) portEl.value = defaultPorts[game] || 25565;
  const playersEl = document.getElementById('new-maxplayers');
  if (playersEl) playersEl.value = defaultPlayers[game] || 20;
  if (game === 'Minecraft') loadMinecraftVersions();
}

async function loadMinecraftVersions() {
  const loaderEl = document.getElementById('new-loader');
  const select = document.getElementById('new-version');
  const betaEl = document.getElementById('mc-show-beta');
  if (!loaderEl || !select) return;

  const loader = loaderEl.value;
  const includeBeta = betaEl?.checked || false;
  select.innerHTML = '<option>Lädt...</option>';

  try {
    const versions = await api(`/api/versions/${loader}?beta=${includeBeta}`);
    if (!versions) return;

    let list = Array.isArray(versions) ? versions : [];
    select.innerHTML = list.slice(0, 80).map(v =>
      `<option value="${v}">${v}</option>`
    ).join('');
  } catch(e) {
    select.innerHTML = '<option>Fehler beim Laden</option>';
  }
}


function openModal() {
  document.getElementById('modal').style.display = 'flex';
  // Kurz warten bis das Modal im DOM ist
  setTimeout(() => {
    onGameChange();
  }, 50);
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

async function createServer() {
  const name = document.getElementById('new-name').value;
  const game = document.getElementById('new-game').value;
  const port = document.getElementById('new-port').value;
  const max_players = document.getElementById('new-maxplayers').value;
  const ram = document.getElementById('new-ram').value;
  const version = game === 'Minecraft' ? document.getElementById('new-version').value : null;
  const loader = game === 'Minecraft' ? document.getElementById('new-loader').value : null;

  if (!name) return alert('Bitte einen Namen eingeben!');

  const res = await api('/api/servers', {
    method: 'POST',
    body: JSON.stringify({
      name, game, version, loader,
      port: parseInt(port),
      max_players: parseInt(max_players),
      ram: parseInt(ram)
    })
  });

  if (res?.error) return alert(res.error);
  closeModal();
  loadDashboard();
  loadServers();
}

// ─── BENUTZER ────────────────────────────────────────
async function loadUsers() {
  const users = await api('/api/auth/users');
  if (!users) return;

  const container = document.getElementById('user-list');
  container.innerHTML = users.map(u => `
    <div class="server-card" style="flex-direction:column;align-items:flex-start;gap:10px">
      <div style="display:flex;align-items:center;width:100%;gap:12px">
        <div style="flex:1">
          <div class="server-name">${u.username}</div>
          <div class="server-meta">${u.email || 'Keine E-Mail'} · ${u.role}</div>
        </div>
        <div class="server-actions">
          <button class="btn" onclick="toggleUserPerms(${u.id})">🔑 Berechtigungen</button>
          ${u.id !== currentUser.id
            ? `<button class="btn red" onclick="deleteUser(${u.id})">✕</button>`
            : '<span style="font-size:11px;color:#8b949e">(du)</span>'
          }
        </div>
      </div>
      <div id="perms-${u.id}" style="display:none;width:100%"></div>
    </div>
  `).join('');
}

async function toggleUserPerms(userId) {
  const el = document.getElementById(`perms-${userId}`);
  if (el.style.display !== 'none') {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = '<div style="color:#8b949e;font-size:12px">Lade Server...</div>';

  const servers = await api('/api/servers');
  if (!servers || !servers.length) {
    el.innerHTML = '<div style="color:#8b949e;font-size:12px">Keine Server vorhanden</div>';
    return;
  }

  // Berechtigungen für jeden Server laden
  const permsData = await Promise.all(
    servers.map(s => api(`/api/permissions/server/${s.id}/users`)
      .then(users => ({ serverId: s.id, users }))
    )
  );

  const permsMap = {};
  permsData.forEach(({ serverId, users }) => {
    const userPerm = users?.find(u => u.id === userId);
    permsMap[serverId] = userPerm || {};
  });

  const permKeys = [
  { key: 'can_view', label: '👁️ Sichtbar' },
  { key: 'can_start', label: '▶ Starten' },
  { key: 'can_stop', label: '■ Stoppen' },
  { key: 'can_console', label: '💻 Console' },
  { key: 'can_files', label: '📁 Dateien' },
  { key: 'can_backups', label: '💾 Backups' },
  { key: 'can_settings', label: '⚙️ Einstellungen' },
  { key: 'can_delete', label: '🗑️ Löschen' },
];

  el.innerHTML = `
    <div style="border-top:1px solid #21262d;padding-top:10px">
      <div style="font-size:11px;font-weight:500;color:#8b949e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
        Server-Berechtigungen
      </div>
      ${servers.map(s => `
        <div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:12px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:500;color:#f0f6fc;margin-bottom:10px">
            🖥️ ${s.name}
            <span style="font-size:10px;color:#8b949e;font-weight:400;margin-left:6px">${s.game}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${permKeys.map(p => `
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:#e2e8f0">
                <input type="checkbox"
                  id="perm-${userId}-${s.id}-${p.key}"
                  ${permsMap[s.id]?.[p.key] ? 'checked' : ''}
                  onchange="savePerm(${userId}, ${s.id})"
                  style="accent-color:#16a34a">
                ${p.label}
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function savePerm(userId, serverId) {
  const permKeys = ['can_view','can_start','can_stop','can_console','can_files','can_backups','can_settings','can_delete'];
  const body = {};
  permKeys.forEach(k => {
    const el = document.getElementById(`perm-${userId}-${serverId}-${k}`);
    body[k] = el ? el.checked : false;
  });

  await api(`/api/permissions/server/${serverId}/users/${userId}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

function openUserModal() {
  document.getElementById('user-modal').style.display = 'flex';
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
}

let currentOtpUsername = '';
let currentOtpCode = '';
let currentOtpValidity = 24;

async function createUser() {
  const username = document.getElementById('new-user-name').value;
  const email = document.getElementById('new-user-email').value;
  const role = document.getElementById('new-user-role').value;

  if (!username) return alert('Bitte Username eingeben!');

  const res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, role, validity_hours: currentOtpValidity })
  });

  if (!res || res.error) return alert(res?.error || 'Fehler');

  closeUserModal();
  loadUsers();

  // OTP Modal anzeigen
  currentOtpUsername = username;
  currentOtpCode = res.otp;
  currentOtpValidity = 24;

  document.getElementById('otp-display-username').textContent = username;
  document.getElementById('otp-display-code').textContent = res.otp;
  document.getElementById('otp-validity-text').textContent = '24 Stunden';
  document.getElementById('otp-validity-btn').textContent = 'Auf 7 Tage erweitern';
  document.getElementById('otp-modal').style.display = 'flex';
}

function closeOtpModal() {
  document.getElementById('otp-modal').style.display = 'none';
}

function copyOtp() {
  const otp = document.getElementById('otp-display-code').textContent;
  navigator.clipboard.writeText(otp).then(() => {
    const btn = document.getElementById('otp-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => btn.textContent = '📋 Kopieren', 2000);
  });
}

async function toggleOtpValidity() {
  const btn = document.getElementById('otp-validity-btn');
  const text = document.getElementById('otp-validity-text');

  if (currentOtpValidity === 24) {
    // Auf 7 Tage erweitern
    const res = await api('/api/auth/extend-otp', {
      method: 'POST',
      body: JSON.stringify({ username: currentOtpUsername, hours: 168 })
    });
    if (res?.success) {
      currentOtpValidity = 168;
      text.textContent = '7 Tage';
      btn.textContent = 'Auf 24 Stunden reduzieren';
    }
  } else {
    // Auf 24 Stunden reduzieren
    const res = await api('/api/auth/extend-otp', {
      method: 'POST',
      body: JSON.stringify({ username: currentOtpUsername, hours: 24 })
    });
    if (res?.success) {
      currentOtpValidity = 24;
      text.textContent = '24 Stunden';
      btn.textContent = 'Auf 7 Tage erweitern';
    }
  }
}

async function deleteUser(id) {
  if (!confirm('Benutzer wirklich löschen?')) return;
  await api(`/api/auth/users/${id}`, { method: 'DELETE' });
  loadUsers();
}

// ─── SOCKET ──────────────────────────────────────────
socket.on('log', (data) => {
  console.log(`[${data.time}] ${data.message}`);
});

socket.on('servers-updated', () => {
  // Dashboard neu laden wenn aktiv
  const dashboard = document.getElementById('page-dashboard');
  if (dashboard && dashboard.classList.contains('active')) {
    loadDashboard();
  }
  // Server-Liste neu laden wenn aktiv
  const serversPage = document.getElementById('page-servers');
  if (serversPage && serversPage.classList.contains('active')) {
    loadServers();
  }
});

// ─── START ───────────────────────────────────────────
async function init() {
  if (!token) { showScreen('login'); return; }

  const user = await api('/api/auth/me');
  if (!user) { showScreen('login'); return; }

  currentUser = user;
  if (user.is_temp) {
    showScreen('setup');
  } else if (user.must_change_password) {
    showScreen('change-password');
  } else {
    showScreen('app');
    initApp();
  }
}

async function redeemOtp() {
  const username = document.getElementById('otp-username').value;
  const otp = document.getElementById('otp-code').value;
  const password = document.getElementById('otp-password').value;
  const password2 = document.getElementById('otp-password2').value;
  const errEl = document.getElementById('otp-error');

  if (!username || !otp || !password || !password2) {
    errEl.textContent = 'Bitte alle Felder ausfüllen';
    errEl.style.display = 'block';
    return;
  }

  if (password !== password2) {
    errEl.textContent = 'Passwörter stimmen nicht überein';
    errEl.style.display = 'block';
    return;
  }

  const res = await fetch('/api/auth/redeem-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, otp, password, password2 })
  });

  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.style.display = 'block';
    return;
  }

  // Direkt einloggen
  token = data.token;
  currentUser = data.user;
  localStorage.setItem('token', token);
  errEl.style.display = 'none';
  showScreen('app');
  initApp();
}

async function changePassword() {
  const password = document.getElementById('cp-password').value;
  const password2 = document.getElementById('cp-password2').value;
  const errEl = document.getElementById('cp-error');

  if (!password || !password2) {
    errEl.textContent = 'Bitte beide Felder ausfüllen';
    errEl.style.display = 'block';
    return;
  }
  if (password !== password2) {
    errEl.textContent = 'Passwörter stimmen nicht überein';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 8) {
    errEl.textContent = 'Passwort muss mindestens 8 Zeichen lang sein';
    errEl.style.display = 'block';
    return;
  }

  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ password, password2 })
  });

  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.style.display = 'block';
    return;
  }

  token = data.token;
  currentUser = data.user;
  localStorage.setItem('token', token);
  errEl.style.display = 'none';
  showScreen('app');
  initApp();
}

init();
function openServerDetail(id) {
  window.location.href = `/server/${id}`;
}