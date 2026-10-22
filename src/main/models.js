const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');

/**
 * Installs a model file on this computer (today only the small voice model that tells speakers apart, see voices.js): a one-time download the person agrees to,
 * resumable, checked against a pinned SHA-256 before it is used, and moved into place only when whole. Nothing else is ever downloaded.
 * Two shapes: an archive that is unpacked into a folder (`files` must then exist inside `name`), or `single: true`, one file saved as `name`.
 *
 * States: ready | missing | downloading | verifying | extracting | error. `status()` is what the screens show; 'progress' is emitted
 * (at most every 250 ms) while it changes. Cancelling keeps the partial file so the next start continues where it stopped.
 */
const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };

/** The system tar (Windows 10+, macOS and Linux ship one that reads .tar.bz2). On Windows use System32's, never a GNU tar that may be first on PATH: it reads "C:\..." as a remote host. */
function tarCommand() {
  if (process.platform !== 'win32') return 'tar';
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
}

function defaultExtract(archive, into) {
  return new Promise((resolve, reject) => execFile(tarCommand(), ['-xjf', archive, '-C', into], { windowsHide: true, maxBuffer: 1 << 20 }, (err, _o, stderr) => (err ? reject(fail('extract_failed', String(stderr || err.message).slice(0, 300))) : resolve())));
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

class SpeechModelManager extends EventEmitter {
  /**
   * dir: where models live (<userData>/models). name/files: the unpacked folder and the files that must be in it.
   * url, sha256, sizeBytes: the archive. unpackedBytes: space needed on top while unpacking.
   */
  constructor({ dir, name, files = [], single = false, url, sha256, sizeBytes, unpackedBytes = 0, isInstalled, freeBytes = async () => Infinity, fetchImpl = (...a) => fetch(...a), extract = defaultExtract, allowInsecure = false, progressMs = 250 }) {
    super();
    Object.assign(this, { dir, name, files, single, url, sha256, sizeBytes, unpackedBytes, freeBytes, fetchImpl, extract, progressMs });
    if (!allowInsecure && !/^https:\/\//i.test(url)) throw new Error('the model address must be https');
    this.isInstalled = isInstalled || (() => (single ? this._isFile(path.join(dir, name)) : files.every((f) => this._isFile(path.join(dir, name, f)))));
    this.workDir = path.join(dir, '.download');
    this.part = path.join(this.workDir, single ? `${name}.part` : `${name}.tar.bz2.part`);
    this._state = 'idle'; this._error = null; this._downloaded = 0; this._abort = null; this._run = null; this._lastEmit = 0;
  }

  _isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
  _partialBytes() { try { return fs.statSync(this.part).size; } catch { return 0; } }

  status() {
    const sizeMb = Math.round(this.sizeBytes / 1e6);
    let host = ''; try { host = new URL(this.url).host; } catch { /* shown empty */ }
    const base = { sizeMb, host, sizeBytes: this.sizeBytes };
    if (this._run) return { ...base, state: this._state, downloaded: this._downloaded, total: this.sizeBytes, progress: Math.min(1, this._downloaded / this.sizeBytes) };
    if (this.isInstalled()) return { ...base, state: 'ready' };
    if (this._state === 'error') return { ...base, state: 'error', error: this._error, partial: this._partialBytes() };
    return { ...base, state: 'missing', partial: this._partialBytes() };
  }

  _emit(force = false) {
    const now = Date.now();
    if (!force && now - this._lastEmit < this.progressMs) return;
    this._lastEmit = now; this.emit('progress', this.status());
  }

  /** Begin (or continue) the installation. Returns at once; follow 'progress'. The returned promise settles when it ends. */
  start() {
    if (this._run) return this._run;
    if (this.isInstalled()) { this._state = 'idle'; return Promise.resolve(this.status()); }
    this._error = null; this._state = 'downloading'; this._abort = new AbortController();
    this._downloaded = this._partialBytes();
    this._run = this._install().then(
      () => { this._state = 'idle'; },
      (err) => {
        if (err.code === 'cancelled') this._state = 'idle';
        else { this._state = 'error'; this._error = { code: err.code || 'error', message: err.message }; }
      },
    ).finally(() => { this._run = null; this._abort = null; this._emit(true); });
    this._emit(true);
    return this._run;
  }

  /** Stop. The partial download is kept (so "continue" works) unless discard is true. */
  cancel({ discard = false } = {}) {
    if (this._abort) this._abort.abort();
    const done = this._run || Promise.resolve();
    return done.then(() => { if (discard) { try { fs.rmSync(this.workDir, { recursive: true, force: true }); } catch { /* nothing to remove */ } this._downloaded = 0; } this._emit(true); });
  }

  async _install() {
    fs.mkdirSync(this.workDir, { recursive: true });
    const have = this._partialBytes();
    const need = Math.max(0, this.sizeBytes - have) + this.unpackedBytes;
    if ((await this.freeBytes(this.dir)) < need) throw fail('disk_full', `Faltam ${Math.ceil(need / 1e9 * 10) / 10} GB livres.`);
    if (have < this.sizeBytes) await this._download();
    this._state = 'verifying'; this._emit(true);
    if (this._partialBytes() !== this.sizeBytes || (await sha256File(this.part)) !== this.sha256) {
      try { fs.rmSync(this.part, { force: true }); } catch { /* gone already */ }
      throw fail('checksum', 'O ficheiro transferido está corrompido. Tenta outra vez.');
    }
    if (this.single) {                                                      // a plain file: it is whole and checked, so it moves into place
      fs.mkdirSync(this.dir, { recursive: true });
      fs.renameSync(this.part, path.join(this.dir, this.name));
      try { fs.rmSync(this.workDir, { recursive: true, force: true }); } catch { /* harmless */ }
      return;
    }
    this._state = 'extracting'; this._emit(true);
    const tmp = fs.mkdtempSync(path.join(this.workDir, 'unpack-'));
    try {
      await this.extract(this.part, tmp);
      const src = path.join(tmp, this.name);
      if (!this.files.every((f) => this._isFile(path.join(src, f)))) throw fail('extract_failed', 'O modelo ficou incompleto depois de abrir o ficheiro.');
      const dest = path.join(this.dir, this.name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(src, dest);                                  // whole or not at all
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp is temp */ } }
    try { fs.rmSync(this.workDir, { recursive: true, force: true }); } catch { /* the archive may linger; harmless */ }
  }

  async _download() {
    const have = this._partialBytes();
    let res;
    try {
      res = await this.fetchImpl(this.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: this._abort.signal, redirect: 'follow' });
    } catch (e) {
      if (this._abort.signal.aborted) throw fail('cancelled', 'Cancelado.');
      throw fail('offline', 'Sem ligação à internet.');
    }
    if (res.status === 416) { fs.rmSync(this.part, { force: true }); this._downloaded = 0; throw fail('network', 'A transferência anterior estava inválida. Tenta outra vez.'); }
    if (res.status !== 200 && res.status !== 206) throw fail('network', `O servidor respondeu ${res.status}. Tenta outra vez mais tarde.`);
    const resumed = res.status === 206 && have > 0;
    if (!resumed && have) { fs.rmSync(this.part, { force: true }); }              // the server ignored Range: start again
    this._downloaded = resumed ? have : 0;
    const out = fs.createWriteStream(this.part, { flags: resumed ? 'a' : 'w' });
    const counter = async function* counterGen(source, self) { for await (const chunk of source) { self._downloaded += chunk.length; self._emit(); yield chunk; } };
    try {
      await pipeline(Readable.fromWeb(res.body), (src) => counter(src, this), out, { signal: this._abort.signal });
    } catch (e) {
      if (this._abort.signal.aborted) throw fail('cancelled', 'Cancelado.');
      throw fail('offline', 'A ligação caiu. O que já foi transferido fica guardado.');
    }
  }
}

module.exports = { SpeechModelManager, sha256File, tarCommand };
