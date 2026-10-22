const path = require('path');
const { BrowserWindow, screen, nativeImage, shell } = require('electron');
const { png } = require('./icons');

const DEV_URL = process.env.VITE_DEV_URL || '';
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const DIST = path.join(__dirname, '..', '..', 'dist', 'renderer');

const appIcon = () => require('./brand').icon(256);

function pageUrl(page) {
  return DEV_URL ? `${DEV_URL}/${page}` : `file://${path.join(DIST, page).replace(/\\/g, '/')}`;
}

function isAppUrl(url) {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://') && url.includes('/dist/renderer/');
}

function lockDown(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
}

function createMain({ onClose } = {}) {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 940, minHeight: 640, show: false, title: 'Ivuenu',
    backgroundColor: '#F7F5F2', icon: appIcon(),
    // No title bar: the content reaches the top edge; Windows draws only its three buttons over it (and rounds the corners).
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#F7F5F2', symbolColor: '#1F1D1A', height: 32 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  lockDown(win);
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => onClose && onClose(event));
  win.loadURL(pageUrl('index.html'));
  return win;
}

// The recording island: a small always-on-top pill, excluded from screen sharing, that never takes keyboard focus.
const SIZES = { collapsed: { w: 372, h: 72 }, expanded: { w: 492, h: 236 }, prompt: { w: 452, h: 196 } };

function createIsland({ saved, onMoved }) {
  const s = SIZES.collapsed;
  const win = new BrowserWindow({
    width: s.w, height: s.h, frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, show: false, hasShadow: false, alwaysOnTop: true, title: 'Ivuenu · a gravar',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);                       // not captured by screen sharing or recording
  lockDown(win);
  win.mode = 'collapsed';
  win.place = (mode) => {
    win.mode = mode;
    const size = SIZES[mode];
    const area = screen.getPrimaryDisplay().workArea;
    const cx = saved && saved.cx != null ? saved.cx : area.x + area.width / 2;
    const y = saved && saved.y != null ? saved.y : area.y;
    win.setBounds({ x: Math.round(cx - size.w / 2), y: Math.round(y), width: size.w, height: size.h });
  };
  win.on('moved', () => {
    const b = win.getBounds();
    saved = { cx: b.x + b.width / 2, y: b.y };
    onMoved && onMoved(saved);
  });
  win.place('collapsed');
  win.loadURL(pageUrl('island.html'));
  return win;
}

module.exports = { createMain, createIsland, appIcon, SIZES, pageUrl };
