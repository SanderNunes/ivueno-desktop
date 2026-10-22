const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, dialog, clipboard, shell, nativeImage, nativeTheme, safeStorage,
  session: electronSession, desktopCapturer, globalShortcut,
} = require('electron');

const { Store } = require('./store');
const { Repo } = require('./repo');
const { SecureStore } = require('./secure');
const { ApiClient } = require('./api');
const { LicenceManager } = require('./licence');
const { createEngine } = require('./engine');
const { CloudEngine } = require('./engine/cloud');
const { AudioImporter } = require('./importer');
const { SpeechModelManager } = require('./models');
const voicesLib = require('./voices');
const { VOICE_MODEL } = voicesLib;
const { EngineRouter } = require('./engine/router');
const { Session } = require('./session');
const { createHandlers } = require('./handlers');
const { createMain, createIsland } = require('./windows');
const { png } = require('./icons');
const { clock } = require('./util');
const brand = require('./brand');
const { Dictation } = require('./dictation');
const { UsageReporter } = require('./usage');
const { SyncManager } = require('./sync');
const { Pairing } = require('./pairing');
const { AudioArchive, retentionUntil, purgeExpired } = require('./audio-archive');
const { Refiner } = require('./refiner');

app.setAppUserModelId('ao.ivuenu.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const userData = app.getPath('userData');
const store = new Store(path.join(userData, 'ivuenu-data.json'));
const secure = new SecureStore(path.join(userData, 'ivuenu-secure.bin'), safeStorage);
const apiBase = () => process.env.IVUENU_API_BASE || store.data.settings.apiBase;
const isLocalApi = () => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(apiBase());

let mainWin = null;
let islandWin = null;
let tray = null;
let quitting = false;

const broadcast = (channel, payload) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
};

let syncRef = null;      // set below; a change to meetings asks it to sync soon
const repo = new Repo(store, (kind, id) => { broadcast('data:changed', { kind, id }); if (kind === 'meetings' && syncRef) syncRef.schedule(); });
// Everything that needs AI runs in the cloud (the Ivuenu server, which uses Groq): see engine/router.js. The demonstration engine only supplies the plain,
// rule-based text writers as a fallback (and the scripted conversation when IVUENU_ENGINE=demo, for development).
const demoEngine = createEngine('demo', { stepMs: Number(process.env.IVUENU_DEMO_STEP_MS) || 6000 });
let licenceRef = null;      // set below; the router asks which plan features are on
let apiRef = null;
const cloudEngine = new CloudEngine({
  api: { cloudTranscribe: (...a) => apiRef.cloudTranscribe(...a), cloudNotes: (...a) => apiRef.cloudNotes(...a), cloudAsk: (...a) => apiRef.cloudAsk(...a), cloudRecipe: (...a) => apiRef.cloudRecipe(...a),
    cloudSummarize: (...a) => apiRef.cloudSummarize(...a), cloudEmail: (...a) => apiRef.cloudEmail(...a), cloudClassify: (...a) => apiRef.cloudClassify(...a) },
  getSettings: () => store.data.settings, fallback: demoEngine,
});
const engine = new EngineRouter({ cloud: cloudEngine, demo: demoEngine, demoSpeech: process.env.IVUENU_ENGINE === 'demo', getSettings: () => store.data.settings, hasFeature: (f) => ((licenceRef && licenceRef.status().features) || []).includes(f) });
const session = new Session({ repo, engine });
// Telling the voices of an imported recording apart needs one small model file (40 MB), downloaded only if the person agrees: see models.js and voices.js.
const voiceDirs = [require('path').join(userData, 'models', 'voices'), require('path').join(require('os').homedir(), '.ivuenu', 'models', 'diarization')];
const voiceModelPath = () => { for (const dir of voiceDirs) { const f = require('path').join(dir, VOICE_MODEL.name); try { if (fs.statSync(f).size === VOICE_MODEL.sizeBytes) return f; } catch { /* not here */ } } return null; };
const voiceModels = new SpeechModelManager({
  dir: voiceDirs[0], name: VOICE_MODEL.name, single: true, sha256: VOICE_MODEL.sha256, sizeBytes: VOICE_MODEL.sizeBytes,
  url: (!app.isPackaged && process.env.IVUENU_VOICE_MODEL_URL) || VOICE_MODEL.url, allowInsecure: !app.isPackaged && !!process.env.IVUENU_VOICE_MODEL_URL,
  isInstalled: () => !!voiceModelPath(), freeBytes: () => services.freeDiskBytes(),
});
voiceModels.on('progress', (st) => broadcast('voices:progress', st));
const voices = { available: () => !!voiceModelPath(), modelPath: voiceModelPath, identify: voicesLib.identify };
const importer = new AudioImporter({ repo, engine, voices, tmpDir: require('os').tmpdir(), notes: (id) => session.generateNotes(id) });

// The accurate pass over a meeting's kept audio. The window decodes audio (Chromium has the decoders), so the refiner asks it for the samples of a block and waits.
const pendingDecodes = new Map();
function decodeInWindow(bytes) {
  return new Promise((resolve, reject) => {
    if (!mainWin || mainWin.isDestroyed()) { reject(Object.assign(new Error('no window'), { code: 'no_window' })); return; }
    const reqId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { pendingDecodes.delete(reqId); reject(Object.assign(new Error('decode timeout'), { code: 'decode_timeout' })); }, 90_000);
    pendingDecodes.set(reqId, { resolve, reject, timer });
    mainWin.webContents.send('refine:decode', { reqId, data: bytes });
  });
}
function decodeReply(reqId, pcm, error) {
  const pending = pendingDecodes.get(reqId);
  if (!pending) return;
  clearTimeout(pending.timer); pendingDecodes.delete(reqId);
  if (error || !pcm) pending.reject(Object.assign(new Error('decode failed'), { code: 'decode_failed' }));
  else pending.resolve(Buffer.from(pcm.buffer ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) : new Uint8Array(pcm)));
}
const refiner = new Refiner({ repo, engine, archive, voices, notes: (id) => session.generateNotes(id), decode: decodeInWindow, policy: () => store.data.settings.audioKeep });
refiner.on('progress', (p) => broadcast('refine:progress', p));

// When a meeting ends with its audio kept: decide until when, and (unless the person turned it off) improve the transcript from that audio.
session.on('finished', (id) => {
  const m = repo.getMeeting(id);
  if (!m || !m.audio || !m.audio.keep) return;
  if (!archive.has(id)) { repo.updateMeeting(id, { audio: null }); return; }
  repo.updateMeeting(id, { audio: { ...m.audio, keepUntil: retentionUntil(store.data.settings.audioKeep, Date.now()) } });
  if (store.data.settings.refineAuto !== false) refiner.run(id).catch(() => {});
});
// Audio past its date is deleted when the app starts and every few hours after.
for (const m of repo.d.meetings) if (m.refine && m.refine.state === 'running') repo.updateMeeting(m.id, { refine: { ...m.refine, state: 'failed', error: 'interrupted' } });      // the app closed in the middle of it
const purgeAudio = () => { try { purgeExpired({ repo, archive }); } catch (e) { console.error('[audio] purge failed:', e && e.message); } };
purgeAudio();
setInterval(purgeAudio, 6 * 60 * 60 * 1000).unref();
importer.on('progress', (p) => broadcast('import:progress', p));
repo.recoverImports();
const api = new ApiClient({ getBase: apiBase, secure, deviceName: `Ivuenu desktop em ${require('os').hostname()}` });
apiRef = api;
const sync = new SyncManager({ repo, store, api, secure, emit: () => broadcast('data:changed', { kind: 'sync' }) });
syncRef = sync;
const pairing = new Pairing({ api, secure, getBase: apiBase });
const archive = new AudioArchive({ dir: require('path').join(userData, 'audio') });
// Public keys that may sign licences, shipped inside the app. Empty in development (then the key is pinned on first
// sign-in). In a release build this list must hold the production key(s): see backend/scripts/make_licence_key.py.
function readKeyList(name) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', name), 'utf8')); } catch { return []; }
}
// Release keys always; the development key only when running from source, never in a packaged build.
function embeddedLicenceKeys() {
  return [...readKeyList('licence-public-keys.json'), ...(app.isPackaged ? [] : readKeyList('licence-public-keys.dev.json'))];
}
// What a packaged build must have: the release list alone.
const releaseKeyCount = () => readKeyList('licence-public-keys.json').length;
const licence = new LicenceManager({ secure, api, autoRepin: isLocalApi(), embeddedKeys: embeddedLicenceKeys() });
licenceRef = licence;

// --- services the handlers need from Electron -------------------------------------------------------

const services = {
  async gpuInfo() {
    try {
      const info = await app.getGPUInfo('basic');
      const dev = (info.gpuDevice || []).find((d) => d.vendorId === 0x10de || d.vendorId === 0x1002);
      return { hasDiscreteGpu: !!dev, name: dev ? `${dev.vendorId === 0x10de ? 'NVIDIA' : 'AMD'} ${dev.deviceString || ''}`.trim() : '' };
    } catch { return { hasDiscreteGpu: false }; }
  },
  async freeDiskBytes() {
    try { const s = fs.statfsSync(userData); return s.bavail * s.bsize; } catch { return 0; }
  },
  openExternal: (url) => shell.openExternal(url),
  async saveFile(name, buf, filters) {
    const r = await dialog.showSaveDialog(mainWin, { defaultPath: name, filters });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, buf);
    return { saved: true, name: path.basename(r.filePath), path: r.filePath };
  },
  writeClipboard: (text) => clipboard.writeText(text),
  // Dictation: put the text on the clipboard and press Ctrl+V in whatever app has the focus (the island never takes it), then give the clipboard back.
  async insertText(text) {
    const before = clipboard.readText();
    clipboard.writeText(text);
    if (process.platform !== 'win32') { const e = new Error('unsupported'); e.code = 'unsupported'; throw e; }
    await new Promise((resolve, reject) => require('child_process').execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"],
      { windowsHide: true, timeout: 8000 }, (err) => (err ? reject(err) : resolve())));
    const t = setTimeout(() => { try { if (clipboard.readText() === text) clipboard.writeText(before); } catch { /* keep what we have */ } }, 700);
    if (t.unref) t.unref();
  },
  revealFile: (file) => shell.showItemInFolder(file),
  async printPdf(html, { paper = 'A4' } = {}) {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await win.webContents.printToPDF({ pageSize: paper === 'Letter' ? 'Letter' : 'A4', printBackground: true });
    } finally { win.destroy(); }
  },
  async fetchText(url) {
    if (!/^https:/i.test(url)) throw Object.assign(new Error('Só são aceites endereços https.'), { code: 'invalid' });
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw Object.assign(new Error(`O calendário respondeu ${res.status}.`), { code: 'calendar_unreachable' });
    const text = await res.text();
    if (text.length > 8_000_000) throw Object.assign(new Error('O calendário é demasiado grande.'), { code: 'invalid' });
    return text;
  },
  async wipeLocal() {
    store.wipe(); secure.clear();
    broadcast('data:changed', { kind: 'all' });
  },
  setTheme: (t) => { nativeTheme.themeSource = t; },
  setIsland: () => syncIsland(session.snapshot()),
};

let flushWaiter = null;
session.beforeStop = () => new Promise((resolve) => {
  const timer = setTimeout(() => { flushWaiter = null; resolve(); }, 4000);
  flushWaiter = () => { clearTimeout(timer); flushWaiter = null; resolve(); };
  broadcast('audio:flush');
});
services.audioFlushed = () => { if (flushWaiter) flushWaiter(); };

const dictation = new Dictation({ engine, getSettings: () => store.data.settings, insertText: (t) => services.insertText(t) });
const usage = new UsageReporter({ api, secure });

// Global hotkeys: one to dictate, one to open/close the island. Each reports whether Windows let us have it.
let hotkeyResult = { dictation: null, island: null };
function applyHotkeys() {
  globalShortcut.unregisterAll();
  const s = store.data.settings;
  const reg = (accel, fn) => { try { return accel ? globalShortcut.register(accel, fn) : null; } catch { return false; } };
  hotkeyResult = {
    dictation: s.dictation ? reg(s.hotkeyDictation, () => dictation.toggle()) : null,
    island: reg(s.hotkeyIsland, () => ipcMain.emit('island:toggle')),
  };
  broadcast('data:changed', { kind: 'hotkeys' });
}
services.applyHotkeys = applyHotkeys;
services.hotkeyStatus = () => hotkeyResult;

const handlers = createHandlers({ repo, session, engine, api, licence, secure, services, dictation, usage, sync, pairing, archive, refiner, decodeReply, importer, voices, voiceModels, version: app.getVersion() });

// Allowed senders: our own pages only.
const senderIsApp = (e) => {
  const url = e.senderFrame ? e.senderFrame.url : '';
  return process.env.VITE_DEV_URL ? url.startsWith(process.env.VITE_DEV_URL) : url.startsWith('file://');
};

ipcMain.handle('ivuenu:call', async (event, channel, arg) => {
  if (!senderIsApp(event)) return { error: { code: 'forbidden', message: 'Origem não permitida.' } };
  const fn = handlers[channel];
  if (!fn) return { error: { code: 'unknown_channel', message: `Pedido desconhecido: ${channel}` } };
  try {
    return { value: await fn(arg) };
  } catch (err) {
    const { code, message, stack, ...extra } = err;
    return { error: { code: err.code || 'error', message: err.message || 'Algo correu mal.', extra: { ...extra, status: err.status } } };
  }
});

ipcMain.on('rec:levels', (event, levels) => session.pushLevels(levels || {}));
ipcMain.on('island:expand', () => setIslandMode('expanded'));
ipcMain.on('island:collapse', () => setIslandMode('collapsed'));
ipcMain.on('island:toggle', () => setIslandMode(islandWin && islandWin.mode === 'expanded' ? 'collapsed' : 'expanded'));
ipcMain.on('island:open-main', () => showMain());

// Window buttons of our own title bar (the window is frameless so it is one rounded surface).
ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('win:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
});
ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

// --- the island -------------------------------------------------------------------------------------

function setIslandMode(mode) {
  if (!islandWin || islandWin.isDestroyed()) return;
  islandWin.place(mode);
  islandWin.webContents.send('island:mode', mode);
}

function syncIsland(snap) {
  const dictating = dictation.phase !== 'idle';
  const want = (store.data.settings.island && ['recording', 'paused', 'writing', 'done'].includes(snap.phase)) || dictating;
  if (want && (!islandWin || islandWin.isDestroyed())) {
    islandWin = createIsland({ saved: store.data.settings.islandPos, onMoved: (p) => repo.patchSettings({ islandPos: p }) });
    islandWin.once('ready-to-show', () => islandWin.showInactive());
  } else if (!want && islandWin && !islandWin.isDestroyed()) {
    islandWin.close(); islandWin = null;
  }
}

// --- tray -------------------------------------------------------------------------------------------

function trayImage(recording) { return brand.icon(32, recording); }

// Keep the three window buttons readable in both themes.
function syncOverlay() {
  const dark = nativeTheme.shouldUseDarkColors;
  if (mainWin && !mainWin.isDestroyed() && mainWin.setTitleBarOverlay) {
    mainWin.setTitleBarOverlay({ color: dark ? '#151412' : '#F7F5F2', symbolColor: dark ? '#EDE9E3' : '#1F1D1A', height: 32 });
  }
}
nativeTheme.on('updated', syncOverlay);

function buildTray(snap) {
  const recording = snap.phase === 'recording' || snap.phase === 'paused';
  if (!tray) { tray = new Tray(trayImage(false)); tray.on('click', showMain); }
  tray.setImage(trayImage(snap.phase === 'recording'));
  tray.setToolTip(recording ? `Ivuenu · ${snap.phase === 'paused' ? 'em pausa' : 'a gravar'} ${clock(snap.elapsedMs)}` : 'Ivuenu');
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(recording ? [{ label: `${snap.phase === 'paused' ? 'Em pausa' : 'A gravar'} · ${clock(snap.elapsedMs)}`, enabled: false },
      { label: 'Parar a gravação', click: () => session.stop() }] : []),
    { label: 'Abrir a Ivuenu', click: showMain },
    { label: 'Mostrar mini gravador', enabled: recording, click: () => setIslandMode('expanded') },
    { type: 'separator' },
    { label: 'Sair', click: quitApp },
  ]));
}

let lastTrayKey = '';
session.on('state', (snap) => {
  broadcast('rec:state', snap);
  syncIsland(snap);
  const key = `${snap.phase}|${Math.floor(snap.elapsedMs / 1000)}`;
  if (key !== lastTrayKey) { lastTrayKey = key; buildTray(snap); }
});
dictation.on('state', (snap) => {
  broadcast('dictation:state', snap);
  syncIsland(session.snapshot());
  if (snap.phase !== 'idle' && islandWin && !islandWin.isDestroyed()) setIslandMode('collapsed');
});
ipcMain.on('dictation:levels', (_e, levels) => { if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('rec:levels', levels); });
session.on('segment', (payload) => broadcast('rec:segment', payload));
session.on('levels', (levels) => { if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('rec:levels', levels); });
session.on('notes-state', (payload) => broadcast('data:changed', { kind: 'notes', ...payload }));
session.on('notes', (id) => broadcast('data:changed', { kind: 'notes', id }));

// --- app lifecycle ----------------------------------------------------------------------------------

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) { openMain(); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

function openMain() {
  mainWin = createMain({
    onClose: (event) => {
      const busy = session.phase === 'recording' || session.phase === 'paused' || session.phase === 'writing';
      if (!quitting && busy) { event.preventDefault(); mainWin.hide(); }      // keep recording in the background
    },
  });
  mainWin.on('closed', () => { mainWin = null; if (!quitting && process.platform !== 'darwin') app.quit(); });
}

async function quitApp() {
  const busy = session.phase === 'recording' || session.phase === 'paused';
  if (busy) {
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Parar e sair', 'Continuar a gravar'], defaultId: 1, cancelId: 1,
      message: 'Está a decorrer uma gravação.', detail: 'Se saíres agora, a gravação pára e as notas são escritas primeiro.',
    });
    if (r.response !== 0) return;
    await session.stop();
  }
  quitting = true; store.flush(); app.quit();
}

app.on('second-instance', showMain);
app.on('before-quit', () => { quitting = true; store.flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* the tray keeps the app alive while recording */ });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // A packaged (release) app must carry the production licence public key. Without it the app would trust whatever key the
  // server shows on first sign-in, which is only acceptable while developing. Refuse to start instead of shipping that.
  if (app.isPackaged && releaseKeyCount() === 0) {
    dialog.showErrorBox('Ivuenu', 'Esta versão foi criada sem a chave de licença (assets/licence-public-keys.json). Não pode ser usada.\n\nThis build was made without the licence key and cannot be used.');
    app.quit();
    return;
  }
  await brand.prewarm();
  nativeTheme.themeSource = store.data.settings.theme;

  const ses = electronSession.defaultSession;
  // Microphone and computer sound for our own pages only; nothing else may ask for anything.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture'].includes(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ['media', 'display-capture'].includes(permission));
  // "Computer sound" = Windows loopback audio, taken through the screen-capture API with the picture thrown away.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  }, { useSystemPicker: false });

  openMain();
  mainWin.once('ready-to-show', syncOverlay);
  buildTray(session.snapshot());
  applyHotkeys();
  // Try to renew the licence quietly at start (works offline: the stored one keeps working).
  if (api.signedIn()) usage.flush().catch(() => {});
  sync.start();
  if (api.signedIn()) sync.syncNow().catch(() => {});
  if (api.signedIn()) licence.refresh().then(() => broadcast('licence:changed', licence.status())).catch(() => {});
});
