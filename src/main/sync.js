/**
 * Encrypted sync of finished meetings between a person's computers.
 *
 * - Every meeting is encrypted HERE (AES-256-GCM, the meeting id is bound into it) before it is uploaded. The key is a random
 *   32-byte data key; the server keeps it only in locked form, locked with a key made (scrypt) from a passphrase that never leaves
 *   this computer. Lose the passphrase and the cloud copies cannot be opened; the meetings on this computer are untouched.
 * - Pull first (what changed on the server), then push (what changed here), then deletions. Every upload says which version it builds
 *   on, so two computers can never silently overwrite each other: when both changed the same meeting, the other computer's version
 *   becomes the meeting and this computer's version is kept as a separate copy ("cópia em conflito"). Nothing is ever lost.
 * - Deleting a meeting deletes its cloud copy (a tombstone), and the other computers delete it too. A meeting marked "não sincronizar"
 *   is removed from the cloud and never uploaded.
 * - Syncing is tied to the account that turned it on: if another account signs in on this computer, syncing is switched off.
 */
const crypto = require('crypto');
const zlib = require('zlib');
const { uid, nowIso } = require('./util');

const KDF = { name: 'scrypt', n: 32768, r: 8, p: 1 };
const BLOB_VERSION = 1;
const ACTIVE = new Set(['recording', 'paused', 'processing']);

const coded = (code, message) => { const e = new Error(message); e.code = code; return e; };
const b64 = (buf) => Buffer.from(buf).toString('base64');

/** Same JSON for the same data, whatever order the keys were created in (used to notice real changes). */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function deriveKek(passphrase, salt, kdf = KDF) {
  return crypto.scryptSync(String(passphrase), Buffer.from(salt, 'base64'), 32, { N: kdf.n, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 });
}

/** Lock the data key with the passphrase: iv | ciphertext | tag, base64. */
function wrapKey(dataKey, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKek(passphrase, b64(salt)), iv);
  cipher.setAAD(Buffer.from('ivuenu-sync-key'));
  const ct = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return { wrapped_key: b64(Buffer.concat([iv, ct, cipher.getAuthTag()])), salt: b64(salt), kdf: KDF };
}

function unwrapKey(remote, passphrase) {
  try {
    const raw = Buffer.from(remote.wrapped_key, 'base64');
    const iv = raw.subarray(0, 12), tag = raw.subarray(raw.length - 16), ct = raw.subarray(12, raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKek(passphrase, remote.salt, remote.kdf), iv);
    decipher.setAAD(Buffer.from('ivuenu-sync-key'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw coded('wrong_passphrase', 'A frase-passe não está certa.');
  }
}

/** version byte | iv | tag | ciphertext of gzip(JSON). The meeting id is authenticated, so a blob cannot be moved to another meeting. */
function encryptItem(key, id, object) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`ivuenu-meeting:${id}`));
  const ct = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(object), 'utf8'))), cipher.final()]);
  return Buffer.concat([Buffer.from([BLOB_VERSION]), iv, cipher.getAuthTag(), ct]);
}

function decryptItem(key, id, blob) {
  if (blob[0] !== BLOB_VERSION) throw coded('unknown_blob', 'Formato de cópia desconhecido.');
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(`ivuenu-meeting:${id}`));
  decipher.setAuthTag(tag);
  return JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(ct), decipher.final()])).toString('utf8'));
}

const snapshot = (m) => { const { syncOff, audio, liveSegments, ...rest } = m; return rest; };      // these belong to this computer only: the kept audio and the transcript set aside

class SyncManager {
  constructor({ repo, store, api, secure, emit = () => {}, now = () => new Date() }) {
    this.repo = repo; this.store = store; this.api = api; this.secure = secure; this.emit = emit; this.now = now;
    this.running = null; this.timer = null; this.interval = null;
  }

  get s() { return this.store.data.sync; }
  _set(fn) { this.store.mutate((d) => fn(d.sync)); }
  _key() { const k = this.secure.get('syncKey'); return k ? Buffer.from(k, 'base64') : null; }

  /** Turn sync on. First time: make the data key and lock it with the passphrase. Another computer: unlock the existing key. */
  async enable(passphrase) {
    const me = await this.api.me();
    let remote = null;
    try { remote = await this.api.syncKey(); } catch (e) { if (e.status !== 404) throw e; }
    let dataKey;
    if (remote) {
      dataKey = unwrapKey(remote, passphrase);
    } else {
      if (String(passphrase || '').length < 8) throw coded('weak_passphrase', 'Usa pelo menos 8 caracteres.');
      dataKey = crypto.randomBytes(32);
      await this.api.putSyncKey(wrapKey(dataKey, passphrase));
    }
    this.secure.set('syncKey', b64(dataKey));
    this._set((s) => { Object.assign(s, { enabled: true, userId: me.id, cursor: 0, items: {}, lastError: '' }); });
    this.emit();
    return this.syncNow();
  }

  /** Stop syncing on this computer. The cloud copies stay; this computer forgets the key. */
  disable() {
    this.secure.set('syncKey', null);
    this._set((s) => { Object.assign(s, { enabled: false, userId: null, cursor: 0, items: {}, lastError: '' }); });
    this.emit();
    return this.status();
  }

  /** Delete every cloud copy and the locked key, then stop. Meetings on this computer are kept. */
  async wipeCloud() {
    await this.api.syncWipe();
    return this.disable();
  }

  _untrack(id) { this._set((s) => { delete s.items[id]; }); }
  _track(id, version, hash) { this._set((s) => { s.items[id] = { version, hash }; }); }
  _fail(message) { (this.warnings ||= []).push(message); this._set((s) => { s.lastError = message; }); }

  pendingCount() {
    return this.repo.d.meetings.filter((m) => m.status === 'done' && !m.syncOff && (this.s.items[m.id] || {}).hash !== sha(canon(snapshot(m)))).length;
  }

  async status({ withUsage = false } = {}) {
    const out = { enabled: !!this.s.enabled, hasKey: !!this._key(), lastRun: this.s.lastRun, lastError: this.s.lastError, pending: this.s.enabled ? this.pendingCount() : 0, synced: Object.keys(this.s.items).length };
    if (withUsage && this.s.enabled) { try { out.usage = await this.api.syncUsage(); } catch { /* offline: no numbers */ } }
    return out;
  }

  /** Ask for a sync soon (after a meeting changed). Many changes become one run. */
  schedule(ms = 20000) {
    if (!this.s.enabled || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.syncNow().catch(() => {}); }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  start(everyMs = 5 * 60 * 1000) {
    if (this.interval) return;
    this.interval = setInterval(() => { if (this.s.enabled) this.syncNow().catch(() => {}); }, everyMs);
    if (this.interval.unref) this.interval.unref();
  }

  stop() { clearInterval(this.interval); clearTimeout(this.timer); this.interval = this.timer = null; }

  /** One round: pull, push, deletions. Never throws for "no network"; returns the status. */
  async syncNow() {
    if (this.running) return this.running;
    this.running = (async () => {
      if (!this.s.enabled || !this.api.signedIn()) return this.status();
      this.warnings = [];
      const key = this._key();
      if (!key) { this._fail('A chave desta cópia não está neste computador. Volta a ativar a sincronização.'); return this.status(); }
      try {
        const me = await this.api.me();
        if (this.s.userId && me.id !== this.s.userId) {                    // another account signed in here: never mix their meetings
          this.disable();
          this._fail('A sincronização foi desligada porque entrou outra conta neste computador.');
          return this.status();
        }
        await this._pull(key);
        const conflicts = await this._push(key);
        if (conflicts.length) { await this._pull(key); await this._push(key); }
        await this._deletions();
        this._set((s) => { s.lastRun = nowIso(); s.lastError = [...new Set(this.warnings)].join(' '); });   // problems with single items stay visible
      } catch (err) {
        this._fail(err.code === 'offline' ? 'Sem ligação: tenta outra vez mais tarde.' : (err.message || 'A sincronização falhou.'));
      }
      this.emit();
      return this.status();
    })().finally(() => { this.running = null; });
    return this.running;
  }

  async _pull(key) {
    for (;;) {
      const page = await this.api.syncList(this.s.cursor);
      for (const it of page.items) await this._applyRemote(key, it);
      this._set((s) => { s.cursor = page.next_after; });
      if (!page.has_more) break;
    }
  }

  async _applyRemote(key, it) {
    const tracked = this.s.items[it.id];
    const local = this.repo.getMeeting(it.id);
    if (it.deleted) {
      this._untrack(it.id);
      if (local && !ACTIVE.has(local.status)) this.repo.deleteMeeting(it.id);        // deleted on another computer
      return;
    }
    if (tracked && tracked.version === it.version) return;                              // that is our own write
    if (local && ACTIVE.has(local.status)) return;                                      // never touch a meeting that is being recorded
    const { data, version } = await this.api.syncGet(it.id);
    let remote;
    try { remote = decryptItem(key, it.id, data); } catch { this._fail('Uma cópia na nuvem não pôde ser aberta.'); return; }
    if (local) {
      const unchanged = tracked && tracked.hash === sha(canon(snapshot(local)));
      if (!unchanged && canon(snapshot(local)) !== canon(remote)) this._keepAsCopy(local);   // both sides changed: keep the local one too
    }
    this._place({ ...remote, id: it.id }, local && local.syncOff);
    this._track(it.id, version || it.version, sha(canon(snapshot(this.repo.getMeeting(it.id)))));
  }

  _keepAsCopy(local) {
    const copy = { ...JSON.parse(JSON.stringify(local)), id: uid('mtg'), title: `${local.title || 'Reunião'} (cópia em conflito)` };
    delete copy.syncOff;
    this.store.mutate((d) => { d.meetings.push(copy); });
  }

  _place(meeting, syncOff) {
    this.store.mutate((d) => {
      const i = d.meetings.findIndex((m) => m.id === meeting.id);
      const next = syncOff ? { ...meeting, syncOff: true } : meeting;
      if (i >= 0) d.meetings[i] = next; else d.meetings.push(next);
    });
    this.repo.emit('meetings', meeting.id);
  }

  /** Upload what changed here. Returns the ids that were refused because they changed somewhere else too. */
  async _push(key) {
    const conflicts = [];
    for (const m of [...this.repo.d.meetings]) {
      if (m.status !== 'done' || m.syncOff) continue;
      const snap = snapshot(m);
      const hash = sha(canon(snap));
      const tr = this.s.items[m.id];
      if (tr && tr.hash === hash) continue;
      try {
        const day = (m.startedAt || m.createdAt || '').slice(0, 10) || undefined;
        const r = await this.api.syncPut(m.id, encryptItem(key, m.id, snap), tr ? tr.version : 0, day);
        this._track(m.id, r.version, hash);
      } catch (e) {
        if (e.code === 'version_conflict') conflicts.push(m.id);
        else if (e.code === 'item_too_large' || e.code === 'quota_exceeded') this._fail(e.code === 'quota_exceeded' ? 'A cópia na nuvem está cheia.' : 'Uma reunião é grande demais para sincronizar.');
        else throw e;
      }
    }
    return conflicts;
  }

  /** Meetings deleted here, or marked "não sincronizar", disappear from the cloud. */
  async _deletions() {
    for (const id of Object.keys(this.s.items)) {
      const m = this.repo.getMeeting(id);
      if (m && !m.syncOff) continue;
      try { await this.api.syncDelete(id); } catch (e) { if (e.status !== 404) throw e; }
      this._untrack(id);
    }
  }
}

module.exports = { SyncManager, wrapKey, unwrapKey, encryptItem, decryptItem, canon, snapshot, KDF };
