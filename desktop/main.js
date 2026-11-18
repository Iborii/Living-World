// Living World desktop shell.
// The app's screens live in one file (app/index.html). Updates replace that file:
// the shell downloads a newer copy into the user's app data folder, checks it,
// and loads it on "Restart now" or the next launch. No reinstall needed.
const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pkg = require('./package.json');

const SHELL_VERSION = pkg.version;                      // version of this .exe
const UPDATE_URL = (pkg.livingWorld && pkg.livingWorld.updateUrl) || '';  // folder that holds latest.json
const CHECK_EVERY_MS = 30 * 60 * 1000;
const updDir = () => path.join(app.getPath('userData'), 'app-updates');
let win = null, ready = null, timer = null;

function vcmp(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }
function bundledVersion() { return pkg.livingWorld && pkg.livingWorld.uiVersion || SHELL_VERSION; }
function downloadedVersions() {
  try { return fs.readdirSync(updDir()).filter(v => fs.existsSync(path.join(updDir(), v, 'index.html')) && fs.existsSync(path.join(updDir(), v, 'ok'))).sort(vcmp); }
  catch (e) { return []; }
}
function bestUI() {
  let v = bundledVersion(), file = path.join(__dirname, 'app', 'index.html');
  for (const d of downloadedVersions()) {
    const meta = readJSON(path.join(updDir(), d, 'meta.json'));
    if (vcmp(d, v) > 0 && (!meta || !meta.minShell || vcmp(SHELL_VERSION, meta.minShell) >= 0)) { v = d; file = path.join(updDir(), d, 'index.html'); }
  }
  return { version: v, file };
}
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
let current = null;

function createWindow() {
  current = bestUI();
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600, title: 'Living World', backgroundColor: '#14151a',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  win.loadFile(current.file);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-finish-load', () => { if (ready) win.webContents.send('lw-update-ready', ready); });
}

function status(msg) { if (win) win.webContents.send('lw-update-status', msg); return msg; }

async function check(manual) {
  if (!UPDATE_URL) return { message: 'updates are not connected yet' };
  try {
    const base = UPDATE_URL.replace(/\/$/, '');
    const res = await fetch(base + '/latest.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('server said ' + res.status);
    const info = await res.json();
    const have = ready ? ready.version : current.version;
    if (vcmp(info.version, have) <= 0) return { message: ready ? `version ${ready.version} is ready to install` : 'you have the latest version' };
    if (info.minShell && vcmp(SHELL_VERSION, info.minShell) < 0) {
      const m = `version ${info.version} needs a new download of the app` + (info.exeUrl ? ' (link in the update log)' : '');
      if (win) win.webContents.send('lw-update-ready', { version: info.version, notes: info.notes, needsInstaller: true, exeUrl: info.exeUrl });
      return { message: status(m) };
    }
    const fileRes = await fetch(base + '/' + (info.file || 'index.html') + '?t=' + Date.now(), { cache: 'no-store' });
    if (!fileRes.ok) throw new Error('download failed (' + fileRes.status + ')');
    const buf = Buffer.from(await fileRes.arrayBuffer());
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (info.sha256 && sha !== info.sha256) throw new Error('downloaded file did not match, skipped');
    const dir = path.join(updDir(), info.version);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buf);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(info));
    fs.writeFileSync(path.join(dir, 'ok'), sha);
    ready = { version: info.version, notes: info.notes || [] };
    if (win) win.webContents.send('lw-update-ready', ready);
    return { message: status(`version ${info.version} downloaded and ready`) };
  } catch (e) {
    return { message: manual ? 'could not check: ' + e.message : 'offline' };
  }
}

ipcMain.handle('lw-update-check', () => check(true));
ipcMain.on('lw-update-restart', () => { if (!win) return; current = bestUI(); ready = null; win.loadFile(current.file); });
ipcMain.on('lw-update-later', () => {});                // applied automatically on next launch
// ---- Data & privacy ----
// The uninstaller (build/installer.nsh) deletes the whole app-data folder only if this flag file exists.
const wipeFlag = () => path.join(app.getPath('userData'), 'wipe-on-uninstall');
ipcMain.handle('lw-get-wipe', () => fs.existsSync(wipeFlag()));
ipcMain.handle('lw-set-wipe', (_e, on) => { try { if (on) fs.writeFileSync(wipeFlag(), 'yes'); else if (fs.existsSync(wipeFlag())) fs.unlinkSync(wipeFlag()); } catch (e) {} return fs.existsSync(wipeFlag()); });
ipcMain.handle('lw-wipe-all', async () => {
  const { session } = require('electron');
  try { await session.defaultSession.clearStorageData(); } catch (e) {}
  try { await session.defaultSession.clearCache(); } catch (e) {}
  try { fs.rmSync(updDir(), { recursive: true, force: true }); } catch (e) {}
  try { if (fs.existsSync(wipeFlag())) fs.unlinkSync(wipeFlag()); } catch (e) {}
  ready = null;
  app.relaunch(); app.exit(0);
});
ipcMain.handle('lw-version', () => ({ shell: SHELL_VERSION, ui: current && current.version }));

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'File', submenu: [{ role: 'reload', label: 'Reload' }, { type: 'separator' }, { role: 'quit' }] },
  { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
  { label: 'Help', submenu: [{ label: 'Check for updates', click: () => check(true).then(r => status(r.message)) }] }
]));

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => check(false), 8000);
  timer = setInterval(() => check(false), CHECK_EVERY_MS);
});
app.on('window-all-closed', () => app.quit());
