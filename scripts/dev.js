// Development: start the Vite dev server for the pages, then Electron pointing at it.
// Usage: npm run dev   (needs `npm install` first; the backend is optional: node ../backend ... see README)
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const URL_ = 'http://localhost:5173';

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit' });

function up(cb) {
  http.get(`${URL_}/index.html`, (res) => { res.resume(); cb(res.statusCode < 500); }).on('error', () => cb(false));
}

(function wait() {
  up((ok) => {
    if (!ok) return setTimeout(wait, 300);
    const electron = require('electron');
    const child = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: URL_ } });
    child.on('exit', () => { vite.kill(); process.exit(0); });
  });
}());
