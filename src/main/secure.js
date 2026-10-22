const fs = require('fs');
const path = require('path');

/**
 * Small secrets (sign-in tokens, the calendar address) in one file encrypted with the operating system's credential
 * store (Electron safeStorage = Windows DPAPI). `crypto` is injected so tests can run without Electron; the plain
 * fallback is for tests only and refuses to run when `requireEncryption` is set.
 */
class SecureStore {
  constructor(file, crypto, { requireEncryption = true } = {}) {
    this.file = file;
    this.crypto = crypto;
    this.requireEncryption = requireEncryption;
  }

  _encrypted() { return !!(this.crypto && this.crypto.isEncryptionAvailable && this.crypto.isEncryptionAvailable()); }

  readAll() {
    let raw;
    try { raw = fs.readFileSync(this.file); } catch { return {}; }
    try {
      const text = this._encrypted() ? this.crypto.decryptString(raw) : raw.toString('utf8');
      return JSON.parse(text);
    } catch {
      return {};                         // unreadable (moved to another Windows account, damaged): start clean
    }
  }

  writeAll(obj) {
    if (!this._encrypted() && this.requireEncryption) {
      const e = new Error('Secure storage is not available on this computer'); e.code = 'no_secure_storage'; throw e;
    }
    const text = JSON.stringify(obj);
    const buf = this._encrypted() ? this.crypto.encryptString(text) : Buffer.from(text, 'utf8');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, buf);
  }

  get(key) { return this.readAll()[key]; }

  set(key, value) {
    const all = this.readAll();
    if (value === undefined || value === null) delete all[key]; else all[key] = value;
    this.writeAll(all);
  }

  clear() { try { fs.rmSync(this.file, { force: true }); } catch { /* nothing to clear */ } }
}

module.exports = { SecureStore };
