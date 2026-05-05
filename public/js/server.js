const token = localStorage.getItem('token');
const socket = io();
const serverId = window.location.pathname.split('/')[2];

let currentServer = null;
let currentFilePath = '';
let currentFile = null;

// ─── AUTH ────────────────────────────────────────────
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

function logout() {
  localStorage.removeItem('token');
  window.location.href = '/';
}

async function init() {
  if (!token) { window.location.href = '/'; return; }
  const user = await api('/api/auth/me');
  if (!user) return;

  document.getElementById('sidebar-user').textContent = '👤 ' + user.username;
  if (user.role === 'admin') {
    document.getElementById('nav-users').style.display = 'block';
  }

  document.getElementById('app').style.display = 'block';
  await loadServer();
  setupSocket();
}

// ─── SERVER LADEN ────────────────────────────────────
async function loadServer() {
  const server = await api(`/api/servers/${serverId}`);
  if (!server) return;
  currentServer = server;

  document.getElementById('server-name').textContent = server.name;
  document.getElementById('server-meta').textContent =
    `${server.game} ${server.version || ''} ${server.loader ? '· ' + server.loader : ''} · Port ${server.port}`;

  document.getElementById('ov-game').textContent = server.game;
  document.getElementById('ov-version').textContent = server.version || '—';
  document.getElementById('ov-port').textContent = server.port;
  document.getElementById('ov-ram').textContent = server.ram + ' GB';
  document.getElementById('ov-loader').textContent = server.loader || '—';
  document.getElementById('ov-maxplayers').textContent = server.max_players;
  document.getElementById('ov-path').textContent = server.path;
  document.getElementById('ov-created').textContent =
    new Date(server.created_at).toLocaleDateString('de-DE');

  document.getElementById('set-name').value = server.name;
  document.getElementById('set-port').value = server.port;
  document.getElementById('set-maxplayers').value = server.max_players;
  document.getElementById('set-ram').value = server.ram;

  updateStatusUI(server.status);
}

function updateStatusUI(status) {
  const dot = document.querySelector('#server-status .status-dot');
  const text = document.getElementById('status-text');
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');

  if (status === 'online') {
    dot.className = 'status-dot dot-online';
    text.textContent = 'Online';
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
  } else {
    dot.className = 'status-dot dot-offline';
    text.textContent = 'Offline';
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
  }
}

// ─── SERVER AKTIONEN ─────────────────────────────────
async function startServer() {
  const res = await api(`/api/servers/${serverId}/start`, { method: 'POST' });
  if (res?.error) return alert(res.error);
  updateStatusUI('online');
  appendLog('info', 'Server wird gestartet...');
}

async function stopServer() {
  const res = await api(`/api/servers/${serverId}/stop`, { method: 'POST' });
  if (res?.error) return alert(res.error);
  updateStatusUI('offline');
  appendLog('warn', 'Server wird gestoppt...');
}

async function restartServer() {
  await stopServer();
  setTimeout(() => startServer(), 2000);
}

// ─── CONSOLE ─────────────────────────────────────────
function appendLog(type, message) {
  const out = document.getElementById('console-out');
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${message}</span>`;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

async function sendCommand() {
  const input = document.getElementById('cmd-input');
  const command = input.value.trim();
  if (!command) return;

  appendLog('warn', '> ' + command);
  input.value = '';

  const res = await api(`/api/servers/${serverId}/command`, {
    method: 'POST',
    body: JSON.stringify({ command })
  });
  if (res?.error) appendLog('error', res.error);
}

function setupSocket() {
  socket.on(`server-log-${serverId}`, (data) => {
    appendLog(data.type, data.message);
  });

  socket.on(`server-status-${serverId}`, (data) => {
    updateStatusUI(data.status);
  });
}

// ─── FILES ───────────────────────────────────────────
async function loadFiles(dirPath = '') {
  currentFilePath = dirPath;
  document.getElementById('current-path').textContent = '/' + dirPath;

  const items = await api(`/api/servers/${serverId}/files?path=${encodeURIComponent(dirPath)}`);
  if (!items) return;

  const tree = document.getElementById('file-tree');
  tree.innerHTML = '';

  // Sortieren: Ordner zuerst
  items.sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'file-item';
    const icon = item.isDir ? '📁' : getFileIcon(item.name);
    const size = item.isDir ? '' : formatSize(item.size);
    div.innerHTML = `
      <span>${icon}</span>
      <span style="flex:1">${item.name}</span>
      <span style="font-size:10px;color:#6e7681">${size}</span>
    `;

    if (item.isDir) {
      div.onclick = () => loadFiles(dirPath ? dirPath + '/' + item.name : item.name);
    } else {
      div.onclick = () => openFile(dirPath ? dirPath + '/' + item.name : item.name, item.name);
    }

    div.oncontextmenu = (e) => {
      e.preventDefault();
      if (confirm(`"${item.name}" löschen?`)) {
        deleteFile(dirPath ? dirPath + '/' + item.name : item.name);
      }
    };

    tree.appendChild(div);
  });
}

async function openFile(filePath, fileName) {
  document.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
  event.currentTarget.classList.add('selected');

  const data = await api(`/api/servers/${serverId}/files/read?path=${encodeURIComponent(filePath)}`);
  if (!data) return;

  currentFile = filePath;
  const editor = document.getElementById('file-editor');
  editor.innerHTML = `
    <div class="editor-topbar">
      <span style="font-family:monospace">${fileName}</span>
      <div style="display:flex;gap:6px">
        <button class="btn primary" onclick="saveFile()">💾 Speichern</button>
      </div>
    </div>
    <textarea class="editor-textarea" id="editor-textarea">${escapeHtml(data.content)}</textarea>
  `;
}

async function saveFile() {
  const content = document.getElementById('editor-textarea').value;
  const res = await api(`/api/servers/${serverId}/files/write`, {
    method: 'POST',
    body: JSON.stringify({ path: currentFile, content })
  });
  if (res?.success) alert('Gespeichert!');
}

async function deleteFile(filePath) {
  await api(`/api/servers/${serverId}/files?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE'
  });
  loadFiles(currentFilePath);
}

function goUpDir() {
  const parts = currentFilePath.split('/').filter(Boolean);
  parts.pop();
  loadFiles(parts.join('/'));
}

function newFilePrompt() {
  const name = prompt('Dateiname:');
  if (!name) return;
  const filePath = currentFilePath ? currentFilePath + '/' + name : name;
  api(`/api/servers/${serverId}/files/write`, {
    method: 'POST',
    body: JSON.stringify({ path: filePath, content: '' })
  }).then(() => loadFiles(currentFilePath));
}

function newFolderPrompt() {
  const name = prompt('Ordnername:');
  if (!name) return;
  const folderPath = currentFilePath ? currentFilePath + '/' + name + '/.keep' : name + '/.keep';
  api(`/api/servers/${serverId}/files/write`, {
    method: 'POST',
    body: JSON.stringify({ path: folderPath, content: '' })
  }).then(() => loadFiles(currentFilePath));
}

// ─── BACKUPS ─────────────────────────────────────────
async function loadBackups() {
  const [backups, schedule] = await Promise.all([
    api(`/api/servers/${serverId}/backups`),
    api(`/api/servers/${serverId}/backup-schedule`)
  ]);

  const container = document.getElementById('backup-list');
  container.innerHTML = `
    <!-- Schedule Einstellungen -->
    <div style="background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:500;color:#8b949e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">
        Automatische Backups
      </div>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="sched-enabled" ${schedule?.enabled ? 'checked' : ''}
            style="accent-color:#16a34a;width:14px;height:14px">
          Aktiviert
        </label>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;color:#8b949e">Intervall:</label>
          <select id="sched-interval" class="form-input" style="width:160px">
            <option value="1" ${schedule?.interval_hours==1?'selected':''}>Stündlich</option>
            <option value="6" ${schedule?.interval_hours==6?'selected':''}>Alle 6 Stunden</option>
            <option value="12" ${schedule?.interval_hours==12?'selected':''}>Alle 12 Stunden</option>
            <option value="24" ${schedule?.interval_hours==24?'selected':''}>Täglich</option>
            <option value="48" ${schedule?.interval_hours==48?'selected':''}>Alle 2 Tage</option>
            <option value="168" ${schedule?.interval_hours==168?'selected':''}>Wöchentlich</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;color:#8b949e">Max. Backups:</label>
          <input type="number" id="sched-max" class="form-input" style="width:70px"
            value="${schedule?.max_backups || 7}" min="1" max="50">
        </div>
        <button class="btn primary" onclick="saveSchedule()">Speichern</button>
      </div>
      ${schedule?.last_backup ? `
        <div style="font-size:11px;color:#8b949e;margin-top:10px">
          Letztes automatisches Backup: ${new Date(schedule.last_backup).toLocaleString('de-DE')}
        </div>
      ` : ''}
    </div>

    <!-- Backup Liste -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:12px;font-weight:500;color:#8b949e;text-transform:uppercase;letter-spacing:.06em">
        Vorhandene Backups
      </div>
      <button class="btn primary" onclick="createBackup()">💾 Jetzt sichern</button>
    </div>
    ${!backups?.length
      ? '<p style="color:#8b949e">Noch keine Backups vorhanden.</p>'
      : backups.map(b => `
          <div class="backup-item">
            <div>
              <div class="backup-name">💾 ${b.name}</div>
              <div class="backup-meta">
                ${formatSize(b.size)} · ${new Date(b.created).toLocaleString('de-DE')}
              </div>
            </div>
          </div>
        `).join('')
    }
  `;
}

async function saveSchedule() {
  const enabled = document.getElementById('sched-enabled').checked;
  const interval_hours = parseInt(document.getElementById('sched-interval').value);
  const max_backups = parseInt(document.getElementById('sched-max').value);

  const res = await api(`/api/servers/${serverId}/backup-schedule`, {
    method: 'POST',
    body: JSON.stringify({ enabled, interval_hours, max_backups })
  });

  if (res?.success) alert('Schedule gespeichert!');
}

async function createBackup() {
  const btn = event.target;
  btn.textContent = '⏳ Erstelle Backup...';
  btn.disabled = true;

  const res = await api(`/api/servers/${serverId}/backup`, { method: 'POST' });

  btn.textContent = '💾 Backup erstellen';
  btn.disabled = false;

  if (res?.success) {
    alert(`Backup erstellt: ${res.file} (${formatSize(res.size)})`);
    loadBackups();
  } else {
    alert('Fehler beim Backup');
  }
}

// ─── EINSTELLUNGEN ───────────────────────────────────
async function saveSettings() {
  const res = await api(`/api/servers/${serverId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: document.getElementById('set-name').value,
      port: parseInt(document.getElementById('set-port').value),
      max_players: parseInt(document.getElementById('set-maxplayers').value),
      ram: parseInt(document.getElementById('set-ram').value),
    })
  });
  if (res?.success) {
    alert('Gespeichert!');
    loadServer();
  }
}

async function deleteServer() {
  if (!confirm(`Server "${currentServer?.name}" wirklich löschen? Alle Dateien bleiben erhalten.`)) return;
  await api(`/api/servers/${serverId}`, { method: 'DELETE' });
  window.location.href = '/';
}

// ─── TABS ────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');

  if (name === 'files') loadFiles();
  if (name === 'backups') loadBackups();
}

// ─── HELPERS ─────────────────────────────────────────
function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    properties: '⚙️', yml: '📄', yaml: '📄', json: '📋',
    txt: '📝', sh: '🖥️', log: '📋', jar: '☕',
    zip: '📦', gz: '📦', mca: '💾', dat: '💾'
  };
  return icons[ext] || '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

init();