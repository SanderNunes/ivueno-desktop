const fs = require('fs');
const path = require('path');
const { BrowserWindow, nativeImage } = require('electron');
const { png } = require('./icons');

// The app and tray icons come from the designer's app-icon.svg. Electron cannot load an SVG as an icon on Windows,
// so each size is drawn once at start by a hidden page and kept. If that fails, the old drawn mark is used instead.
const SVG = path.join(__dirname, '..', '..', 'assets', 'app-icon.svg');
const cache = new Map();

async function render(size, recording) {
  const win = new BrowserWindow({ show: false, width: size, height: size, frame: false, transparent: true, useContentSize: true,
    webPreferences: { sandbox: true, javascript: false } });
  try {
    const b64 = fs.readFileSync(SVG).toString('base64');
    const dot = recording ? `<div style="position:absolute;right:${size * 0.02}px;bottom:${size * 0.02}px;width:${size * 0.34}px;height:${size * 0.34}px;border-radius:50%;background:#D92D20;border:${Math.max(1, size * 0.05)}px solid #fff"></div>` : '';
    const html = `<body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${b64}" style="width:${size}px;height:${size}px;display:block">${dot}</body>`;
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage();
    return img.isEmpty() ? null : img.resize({ width: size, height: size });
  } catch { return null; } finally { win.destroy(); }
}

async function prewarm() {
  for (const [size, rec] of [[256, false], [32, false], [32, true]]) {
    const img = await render(size, rec);
    if (img) cache.set(`${size}${rec ? 'r' : ''}`, img);
  }
}

/** The brand icon at 256 (window) or 32 (tray), with the red dot when recording. */
function icon(size, recording = false) {
  return cache.get(`${size}${recording ? 'r' : ''}`) || nativeImage.createFromBuffer(png(size, { recording, dark: true }));
}

module.exports = { prewarm, icon };
