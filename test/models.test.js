// The speech-model installer against a real local HTTP server and a real (small) .tar.bz2.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { SpeechModelManager, tarCommand } = require('../src/main/models');
const { tmpDir } = require('./helpers');

const NAME = 'fake-model-int8';
const FILES = ['encoder.int8.onnx', 'tokens.txt'];

/** Build a .tar.bz2 holding NAME/<files> with `omit` left out; returns { archive, bytes, sha }. */
function makeArchive({ omit = [] } = {}) {
  const src = tmpDir(); const folder = path.join(src, NAME); fs.mkdirSync(folder);
  for (const f of FILES) if (!omit.includes(f)) fs.writeFileSync(path.join(folder, f), crypto.randomBytes(300 * 1024));
  const archive = path.join(tmpDir(), `${NAME}.tar.bz2`);
  execFileSync(tarCommand(), ['-cjf', archive, '-C', src, NAME]);
  const bytes = fs.readFileSync(archive);
  return { archive, bytes, sha: crypto.createHash('sha256').update(bytes).digest('hex') };
}

/** Serves `bytes`, honours Range unless ignoreRange, trickles in small pieces so a download can be interrupted. */
function serve(bytes, { ignoreRange = false, delayMs = 0, status = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.range || null);
    if (status !== 200) { res.statusCode = status; return res.end(); }
    let start = 0;
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    if (m && !ignoreRange) start = Number(m[1]);
    res.statusCode = start ? 206 : 200;
    res.setHeader('content-length', bytes.length - start);
    let at = start;
    const pump = () => {
      if (at >= bytes.length) return res.end();
      res.write(bytes.subarray(at, at + 16384)); at += 16384;
      delayMs ? setTimeout(pump, delayMs) : setImmediate(pump);
    };
    pump();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/m.tar.bz2` })));
}

function manager(arc, url, over = {}) {
  return new SpeechModelManager({
    dir: tmpDir(), name: NAME, files: FILES, url, sha256: arc.sha, sizeBytes: arc.bytes.length, unpackedBytes: 1024, allowInsecure: true, progressMs: 0, ...over,
  });
}

test('the model address must be https in production', () => {
  assert.throws(() => new SpeechModelManager({ dir: tmpDir(), name: NAME, files: FILES, url: 'http://example.com/m.tar.bz2', sha256: 'x', sizeBytes: 1, unpackedBytes: 1 }), /https/);
});

test('download, check, unpack and move into place; progress is reported; the work folder is cleaned', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes);
  const m = manager(arc, s.url); const seen = [];
  m.on('progress', (p) => seen.push(p));
  assert.equal(m.status().state, 'missing');
  await m.start();
  s.server.close();
  assert.equal(m.status().state, 'ready');
  for (const f of FILES) assert.ok(fs.statSync(path.join(m.dir, NAME, f)).size > 1000);
  assert.equal(fs.existsSync(m.workDir), false);
  const states = [...new Set(seen.map((p) => p.state))];
  assert.deepEqual(states.filter((x) => x !== 'missing'), ['downloading', 'verifying', 'extracting', 'ready']);
  const mid = seen.find((p) => p.state === 'downloading' && p.downloaded > 0 && p.progress < 1);
  assert.ok(mid, 'saw a progress value between 0 and 1');
});

test('a corrupt download is thrown away and nothing is installed', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes);
  const m = manager({ ...arc, sha: 'f'.repeat(64) }, s.url);
  await m.start(); s.server.close();
  const st = m.status();
  assert.equal(st.state, 'error'); assert.equal(st.error.code, 'checksum');
  assert.equal(fs.existsSync(path.join(m.dir, NAME)), false);
  assert.equal(st.partial, 0);                                       // the bad file is gone: the next try starts clean
});

test('cancel keeps the partial file and the next start continues with a Range request', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes, { delayMs: 15 });
  const m = manager(arc, s.url);
  const run = m.start();
  await new Promise((r) => setTimeout(r, 120));
  await m.cancel(); await run;
  const partial = m.status().partial;
  assert.ok(partial > 0 && partial < arc.bytes.length, `partial ${partial} of ${arc.bytes.length}`);
  assert.equal(m.status().state, 'missing');
  await m.start(); s.server.close();
  assert.equal(m.status().state, 'ready');
  assert.equal(s.seen[0], null); assert.match(s.seen[1], /^bytes=\d+-$/);
});

test('discarding on cancel removes the partial file', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes, { delayMs: 15 });
  const m = manager(arc, s.url);
  const run = m.start(); await new Promise((r) => setTimeout(r, 100));
  await m.cancel({ discard: true }); await run; s.server.close();
  assert.equal(m.status().partial, 0);
});

test('a server that ignores Range makes it start over, and the result is still right', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes, { ignoreRange: true, delayMs: 10 });
  const m = manager(arc, s.url);
  const run = m.start(); await new Promise((r) => setTimeout(r, 80)); await m.cancel(); await run;
  await m.start(); s.server.close();
  assert.equal(m.status().state, 'ready');
});

test('no connection: an offline error, the retry works once the server is back', async () => {
  const arc = makeArchive();
  const closed = await serve(arc.bytes); const url = closed.url; await new Promise((r) => closed.server.close(r));
  const m = manager(arc, url);
  await m.start();
  assert.equal(m.status().state, 'error'); assert.equal(m.status().error.code, 'offline');
  const port = new URL(url).port;
  const up = await new Promise((resolve) => { const s2 = http.createServer((q, r) => r.end(arc.bytes)); s2.listen(Number(port), '127.0.0.1', () => resolve(s2)); });
  await m.start(); up.close();
  assert.equal(m.status().state, 'ready');
});

test('a server error is reported with its status', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes, { status: 503 });
  const m = manager(arc, s.url); await m.start(); s.server.close();
  assert.equal(m.status().error.code, 'network'); assert.match(m.status().error.message, /503/);
});

test('not enough disk space stops before downloading anything', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes);
  const m = manager(arc, s.url, { freeBytes: async () => 1000 });
  await m.start(); s.server.close();
  assert.equal(m.status().error.code, 'disk_full'); assert.deepEqual(s.seen, []);
});

test('an archive with a file missing is refused and nothing half-installed is left', async () => {
  const arc = makeArchive({ omit: ['tokens.txt'] }); const s = await serve(arc.bytes);
  const m = manager(arc, s.url); await m.start(); s.server.close();
  assert.equal(m.status().error.code, 'extract_failed');
  assert.equal(fs.existsSync(path.join(m.dir, NAME)), false);
});

test('already installed: nothing is fetched', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes);
  const m = manager(arc, s.url);
  fs.mkdirSync(path.join(m.dir, NAME), { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(m.dir, NAME, f), 'x');
  assert.equal(m.status().state, 'ready');
  await m.start(); s.server.close();
  assert.deepEqual(s.seen, []);
});

test('starting twice at once runs one installation', async () => {
  const arc = makeArchive(); const s = await serve(arc.bytes, { delayMs: 5 });
  const m = manager(arc, s.url);
  const a = m.start(); const b = m.start();
  assert.equal(a, b);
  await a; s.server.close();
  assert.equal(s.seen.length, 1);
});
