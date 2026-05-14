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

function setupInstallSocket() {
  socket.on(`install-${serverId}`, (data) => {
    const bar = document.getElementById('install-progress');
    const msg = document.getElementById('install-message');
    const wrap = document.getElementById('install-wrap');

    if (wrap) wrap.style.display = 'block';
    if (msg) msg.textContent = data.message;
    if (bar) bar.style.width = data.percent + '%';
  });

  socket.on(`install-done-${serverId}`, (data) => {
    setTimeout(() => {
      const wrap = document.getElementById('install-wrap');
      if (wrap) wrap.style.display = 'none';
      loadServer();
    }, 2000);
  });
}

async function startInstall() {
  if (!confirm('Server jetzt installieren/herunterladen?')) return;
  const res = await api(`/api/servers/${serverId}/install`, { method: 'POST' });
  if (res?.error) return alert(res.error);
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
  setupInstallSocket();
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
  document.getElementById('set-backup-path').value = server.backup_path || '';
loadDrivesForSettings();
  document.getElementById('ov-loader').textContent = server.loader || '—';
  document.getElementById('ov-maxplayers').textContent = server.max_players;
  document.getElementById('ov-path').textContent = server.path;
  document.getElementById('ov-created').textContent =
    new Date(server.created_at).toLocaleDateString('de-DE');

    // Server-Info aktualisieren wenn online
if (server.status === 'online') {
  const info = await api(`/api/servers/${serverId}/info`);
  if (info && !info.error) {
    document.getElementById('ov-pid') && (document.getElementById('ov-pid').textContent = info.pid || '—');
    document.getElementById('ov-uptime') && (document.getElementById('ov-uptime').textContent = formatUptime(info.uptime) || '—');
  }
}

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
  } else if (status === 'booting') {
    dot.className = 'status-dot dot-booting';
    text.textContent = '⏳ Booting...';
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
function appendLog(type, message, time) {
  const out = document.getElementById('console-out');
  if (!out) return;
  const timestamp = time || new Date().toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<span class="log-time">${timestamp}</span><span class="log-${type}">${escapeHtml(message)}</span>`;
  out.appendChild(div);

  updateLogCount();

  // Auto-scroll nur wenn Checkbox aktiv und ganz unten
  const autoScroll = document.getElementById('autoscroll')?.checked !== false;
  if (autoScroll) {
    const isAtBottom = out.scrollHeight - out.clientHeight <= out.scrollTop + 50;
    if (isAtBottom) out.scrollTop = out.scrollHeight;
  }
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
    appendLog(data.type, data.message, data.time);
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

  // Sortieren: Ordner zuerst, dann alphabetisch
  items.sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));

  tree.innerHTML = items.map(item => {
    const icon = item.isDir ? '📁' : getFileIcon(item.name);
    const size = item.isDir ? '' : formatSize(item.size);
    const itemPath = dirPath ? dirPath + '/' + item.name : item.name;
    return `
      <div class="file-item" 
        onclick="${item.isDir ? `loadFiles('${itemPath}')` : `openFile('${itemPath}', '${item.name}')`}"
        oncontextmenu="showFileCtx(event, '${itemPath}', '${item.name}', ${item.isDir})">
        <span>${icon}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name}</span>
        <span style="font-size:10px;color:#6e7681;flex-shrink:0">${size}</span>
      </div>
    `;
  }).join('');
}

async function openFile(filePath, fileName) {
  // Binäre Dateien nicht öffnen
  const binaryExts = ['jar','zip','gz','mca','dat','png','jpg','jpeg','gif','mp3','mp4','ico'];
  const ext = fileName.split('.').pop().toLowerCase();

  if (binaryExts.includes(ext)) {
    if (confirm(`"${fileName}" ist eine Binärdatei und kann nicht bearbeitet werden.\nMöchtest du sie herunterladen?`)) {
      downloadFile(filePath);
    }
    return;
  }

  document.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  currentFile = filePath;

  const data = await api(`/api/servers/${serverId}/files/read?path=${encodeURIComponent(filePath)}`);
  if (!data) return;

  const editor = document.getElementById('file-editor');
  editor.innerHTML = `
    <div class="editor-topbar">
      <span style="font-family:monospace;color:#f0f6fc">${fileName}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:10px;color:#6e7681" id="editor-status">Gespeichert</span>
        <button class="btn" onclick="downloadFile('${filePath}')">⬇ Download</button>
        <button class="btn primary" onclick="saveFile()">💾 Speichern</button>
      </div>
    </div>
    <div style="display:flex;flex:1;overflow:hidden">
      <div id="line-nums" style="padding:12px 8px;font-family:monospace;font-size:12.5px;line-height:1.7;color:#6e7681;text-align:right;border-right:1px solid #21262d;background:#0d1117;user-select:none;min-width:40px;overflow:hidden"></div>
      <textarea class="editor-textarea" id="editor-textarea" 
        oninput="onEditorChange()"
        onscroll="syncLineNums()"
        spellcheck="false">${escapeHtml(data.content)}</textarea>
    </div>
  `;
  updateLineNums();
}

function onEditorChange() {
  updateLineNums();
  const status = document.getElementById('editor-status');
  if (status) status.textContent = 'Ungespeichert ●';
}

function updateLineNums() {
  const ta = document.getElementById('editor-textarea');
  const nums = document.getElementById('line-nums');
  if (!ta || !nums) return;
  const lines = ta.value.split('\n').length;
  nums.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
}

function syncLineNums() {
  const ta = document.getElementById('editor-textarea');
  const nums = document.getElementById('line-nums');
  if (ta && nums) nums.scrollTop = ta.scrollTop;
}

async function saveFile() {
  const content = document.getElementById('editor-textarea')?.value;
  if (!content === undefined || !currentFile) return;

  const res = await api(`/api/servers/${serverId}/files/write`, {
    method: 'POST',
    body: JSON.stringify({ path: currentFile, content })
  });

  const status = document.getElementById('editor-status');
  if (res?.success) {
    if (status) status.textContent = 'Gespeichert ✓';
    setTimeout(() => { if (status) status.textContent = 'Gespeichert'; }, 2000);
  } else {
    if (status) status.textContent = 'Fehler beim Speichern!';
  }
}

function downloadFile(filePath) {
  const url = `/api/servers/${serverId}/files/download?path=${encodeURIComponent(filePath)}&token=${token}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filePath.split('/').pop();
  a.click();
}

function showFileCtx(e, filePath, fileName, isDir) {
  e.preventDefault();
  e.stopPropagation();

  // Altes Menü entfernen
  document.getElementById('file-ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'file-ctx-menu';
  menu.style.cssText = `
    position:fixed;top:${e.clientY}px;left:${e.clientX}px;
    background:#161b22;border:1px solid #21262d;border-radius:8px;
    padding:4px 0;z-index:1000;min-width:160px;
  `;

  const items = [
    !isDir ? `<div class="ctx-item" onclick="openFileFromCtx('${filePath}','${fileName}')">📄 Öffnen</div>` : '',
    !isDir ? `<div class="ctx-item" onclick="downloadFile('${filePath}')">⬇ Herunterladen</div>` : '',
    isDir  ? `<div class="ctx-item" onclick="downloadFolder('${filePath}')">⬇ Als ZIP laden</div>` : '',
    `<div class="ctx-item" onclick="renameItem('${filePath}','${fileName}')">✎ Umbenennen</div>`,
    `<div style="height:1px;background:#21262d;margin:3px 0"></div>`,
    `<div class="ctx-item" style="color:#ef4444" onclick="deleteFile('${filePath}')">🗑 Löschen</div>`,
  ].join('');

  menu.innerHTML = items;
  document.body.appendChild(menu);

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function openFileFromCtx(filePath, fileName) {
  document.getElementById('file-ctx-menu')?.remove();
  openFile(filePath, fileName);
}

function downloadFolder(folderPath) {
  const url = `/api/servers/${serverId}/files/download-folder?path=${encodeURIComponent(folderPath)}&token=${token}`;
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

async function renameItem(oldPath, oldName) {
  const newName = prompt('Neuer Name:', oldName);
  if (!newName || newName === oldName) return;

  const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
  const newPath = dir ? dir + '/' + newName : newName;

  const res = await api(`/api/servers/${serverId}/files/rename`, {
    method: 'POST',
    body: JSON.stringify({ oldPath, newPath })
  });

  if (res?.success) loadFiles(currentFilePath);
  else alert('Fehler beim Umbenennen');
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

async function uploadFiles() {
  const input = document.getElementById('file-upload');
  const files = input.files;
  if (!files.length) return;

  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  formData.append('path', currentFilePath);

  // Upload-Anzeige
  const toolbar = document.querySelector('.files-toolbar');
  const progress = document.createElement('div');
  progress.style.cssText = 'font-size:12px;color:#22c55e;margin-left:8px';
  progress.textContent = `⏳ Lade ${files.length} Datei(en) hoch...`;
  toolbar.appendChild(progress);

  const res = await fetch(`/api/servers/${serverId}/files/upload`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData
  });

  const data = await res.json();
  progress.textContent = data.success
    ? `✓ ${data.uploaded.length} Datei(en) hochgeladen`
    : '✗ Fehler beim Upload';

  setTimeout(() => progress.remove(), 3000);
  input.value = '';
  loadFiles(currentFilePath);
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
      backup_path: document.getElementById('set-backup-path').value || null,
      backup_drive: document.getElementById('set-backup-drive').value || null,
    })
  });
  if (res?.success) {
    alert('Gespeichert!');
    loadServer();
  }
}


async function deleteServer() {
  if (!confirm(`Server "${currentServer?.name}" wirklich löschen? Alle Dateien werden unwiderruflich gelöscht!`)) return;
  
  const res = await api(`/api/servers/${serverId}?deleteFiles=true`, { method: 'DELETE' });
  if (res?.error) return alert(res.error);
  window.location.href = '/';
}

// ─── LOG AKTIONEN ────────────────────────────────────
function getLogText() {
  const lines = document.querySelectorAll('#console-out .log-line');
  return Array.from(lines).map(l => {
    const time = l.querySelector('.log-time')?.textContent || '';
    const msg = l.querySelector('[class^="log-"]')?.textContent || '';
    return `[${time}] ${msg}`;
  }).join('\n');
}

function copyLogs() {
  const text = getLogText();
  if (!text) return alert('Keine Logs vorhanden');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.console-toolbar .btn');
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => btn.textContent = old, 2000);
  });
}

function saveLogs() {
  const text = getLogText();
  if (!text) return alert('Keine Logs vorhanden');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `server-${serverId}-${timestamp}.log`;
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

async function clearLogs() {
  if (!confirm('Logs wirklich leeren? Die Log-Datei auf dem Server wird ebenfalls gelöscht.')) return;
  
  const res = await api(`/api/servers/${serverId}/logs`, { method: 'DELETE' });
  if (res?.error) return alert(res.error);
  
  document.getElementById('console-out').innerHTML = '';
  updateLogCount();
}

function updateLogCount() {
  const count = document.querySelectorAll('#console-out .log-line').length;
  const el = document.getElementById('log-count');
  if (el) el.textContent = `${count} Zeilen`;
}

// ─── TABS ────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');

  if (name === 'files') loadFiles();
  if (name === 'backups') loadBackups();
  if (name === 'console') loadExistingLogs();
}

async function loadExistingLogs() {
  const out = document.getElementById('console-out');
  if (!out) return;
  out.innerHTML = '';

  const logs = await api(`/api/servers/${serverId}/logs`);
  if (!logs || !logs.length) {
    out.innerHTML = '<div style="color:#6e7681;padding:8px">Noch keine Logs vorhanden.</div>';
    return;
  }

  logs.forEach(line => {
    // Format: [2026-05-09T12:00:00.000Z] [info] Nachricht
    const match = line.match(/\[(.+?)\] \[(.+?)\] (.+)/);
    if (match) {
      const time = new Date(match[1]).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      appendLog(match[2], match[3], time);
    } else {
      appendLog('info', line, '—');
    }
  });

  out.scrollTop = out.scrollHeight;
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

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function loadDrivesForSettings() {
  const drives = await api('/api/system/drives');
  if (!drives) return;

  const select = document.getElementById('set-backup-drive');
  if (!select) return;

  const current = document.getElementById('set-backup-path').value;
  select.innerHTML = '<option value="">Standard</option>' +
    drives.map(d => `<option value="${d.mount}" ${current.startsWith(d.mount) ? 'selected' : ''}>
      ${d.mount} (${d.free} GB frei / ${d.size} GB)
    </option>`).join('');
}

function updateBackupPath() {
  const drive = document.getElementById('set-backup-drive').value;
  const pathEl = document.getElementById('set-backup-path');
  if (drive && currentServer) {
    const serverName = currentServer.name.toLowerCase().replace(/\s+/g, '-');
    pathEl.value = drive + '/backups/' + serverName;
  } else if (!drive) {
    pathEl.value = '';
  }
}

init();