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

  const res = await fetch('/api/auth/register', {
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
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      ...options.headers
    }
  });
  if (res.status === 401) { logout(); return null; }
  return res.json();
}

// ─── DASHBOARD ───────────────────────────────────────
async function loadDashboard() {
  const servers = await api('/api/servers');
  if (!servers) return;

  const online = servers.filter(s => s.status === 'online').length;
  document.getElementById('stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Server gesamt</div>
      <div class="stat-value">${servers.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Online</div>
      <div class="stat-value" style="color:#22c55e">${online}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Offline</div>
      <div class="stat-value" style="color:#ef4444">${servers.length - online}</div>
    </div>
  `;
  renderServerList('server-list', servers);
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
        <div class="status-dot ${s.status === 'online' ? 'dot-online' : 'dot-offline'}"></div>
        ${s.status === 'online' ? 'Online' : 'Offline'}
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
  if (!confirm('Server wirklich löschen?')) return;
  await api(`/api/servers/${id}`, { method: 'DELETE' });
  loadDashboard();
  loadServers();
}

// ─── SERVER MODAL ────────────────────────────────────
const defaultPorts = {
  Minecraft: 25565, Satisfactory: 7777,
  CS2: 27015, Valheim: 2456, ARK: 7778
};

function onGameChange() {
  const game = document.getElementById('new-game').value;
  document.getElementById('mc-options').style.display = game === 'Minecraft' ? 'block' : 'none';
  document.getElementById('new-port').value = defaultPorts[game] || 25565;
}

function openModal() {
  document.getElementById('modal').style.display = 'flex';
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

  await api('/api/servers', {
    method: 'POST',
    body: JSON.stringify({ name, game, version, loader, port: parseInt(port), max_players: parseInt(max_players), ram: parseInt(ram) })
  });

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
    { key: 'can_start', label: 'Starten' },
    { key: 'can_stop', label: 'Stoppen' },
    { key: 'can_console', label: 'Console' },
    { key: 'can_files', label: 'Dateien' },
    { key: 'can_backups', label: 'Backups' },
    { key: 'can_settings', label: 'Einstellungen' },
    { key: 'can_delete', label: 'Löschen' },
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
  const permKeys = ['can_start','can_stop','can_console','can_files','can_backups','can_settings','can_delete'];
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

async function createUser() {
  const username = document.getElementById('new-user-name').value;
  const email = document.getElementById('new-user-email').value;
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;

  if (!username || !password) return alert('Bitte Name und Passwort eingeben!');

  const res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, role })
  });

  if (res.error) return alert(res.error);
  closeUserModal();
  loadUsers();
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

// ─── START ───────────────────────────────────────────
async function init() {
  if (!token) { showScreen('login'); return; }

  const user = await api('/api/auth/me');
  if (!user) { showScreen('login'); return; }

  currentUser = user;
  if (user.is_temp) {
    showScreen('setup');
  } else {
    showScreen('app');
    initApp();
  }
}

init();
function openServerDetail(id) {
  window.location.href = `/server/${id}`;
}