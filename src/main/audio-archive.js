const fs = require('fs');
const path = require('path');

/**
 * The audio of a meeting, kept on THIS computer for a while so it can be transcribed again more accurately after the meeting, and so a wrong line can be checked
 * against what was really said. Nothing here is ever uploaded by itself: the refiner sends a block only to be transcribed, and the server keeps nothing.
 *
 * Layout: <dir>/<meeting id>/<source>-<n>.webm (blocks of about 8 to 10 minutes, each a file that opens on its own) and manifest.json describing them.
 * How long it stays is the person's choice (settings.audioKeep: off | final | 7d | 30d): see retentionUntil() and purgeExpired().
 */
const DAY = 24 * 60 * 60 * 1000;
const MAX_BLOCK_BYTES = 60 * 1024 * 1024;
const MAX_BLOCKS = 400;
const ID = /^mtg_[A-Za-z0-9]{6,40}$/;
const SOURCES = new Set(['mic', 'system']);

const fail = (code, message) => Object.assign(new Error(message), { code });

class AudioArchive {
  constructor({ dir, now = () => Date.now() }) { this.dir = dir; this.now = now; }

  _folder(id) {
    if (!ID.test(String(id))) throw fail('invalid', 'Reunião inválida.');
    return path.join(this.dir, String(id));
  }

  _manifest(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this._folder(id), 'manifest.json'), 'utf8')); } catch { return { blocks: [] }; }
  }

  /** Store one block. `data`: ArrayBuffer | Uint8Array | Buffer. Returns { blocks, bytes } for the meeting so far. */
  add(id, { source, startMs, seconds, data }) {
    if (!SOURCES.has(source)) throw fail('invalid', 'Fonte de áudio inválida.');
    const buf = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
    if (!buf.length || buf.length > MAX_BLOCK_BYTES) throw fail('invalid', 'Bloco de áudio inválido.');
    const folder = this._folder(id);
    const manifest = this._manifest(id);
    if (manifest.blocks.length >= MAX_BLOCKS) throw fail('too_many', 'Áudio a mais para esta reunião.');
    fs.mkdirSync(folder, { recursive: true });
    const n = manifest.blocks.filter((b) => b.source === source).length;
    const file = `${source}-${String(n).padStart(3, '0')}.webm`;
    fs.writeFileSync(path.join(folder, file), buf);
    manifest.blocks.push({ file, source, startMs: Math.max(0, Math.round(startMs) || 0), seconds: Math.max(0.1, Number(seconds) || 0), bytes: buf.length });
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
    return { blocks: manifest.blocks.length, bytes: manifest.blocks.reduce((a, b) => a + b.bytes, 0) };
  }

  /** The blocks of a meeting, by source then time. */
  blocks(id) {
    return this._manifest(id).blocks.slice().sort((a, b) => (a.source === b.source ? a.startMs - b.startMs : a.source < b.source ? -1 : 1));
  }

  read(id, file) {
    const known = this._manifest(id).blocks.find((b) => b.file === file);
    if (!known) throw fail('not_found', 'Esse áudio já não existe.');
    return fs.readFileSync(path.join(this._folder(id), path.basename(known.file)));
  }

  bytes(id) { return this._manifest(id).blocks.reduce((a, b) => a + b.bytes, 0); }

  has(id) { try { return this._manifest(id).blocks.length > 0; } catch { return false; } }

  remove(id) { try { fs.rmSync(this._folder(id), { recursive: true, force: true }); } catch { /* already gone */ } }

  /** Meeting ids that have a folder here. */
  ids() { try { return fs.readdirSync(this.dir).filter((n) => ID.test(n)); } catch { return []; } }

  /** Total bytes kept, and in how many meetings. */
  usage() {
    const ids = this.ids();
    return { meetings: ids.filter((i) => this.has(i)).length, bytes: ids.reduce((a, i) => a + this.bytes(i), 0) };
  }
}

/** When the audio of a meeting that has just ended may be deleted, as an ISO time, or null for "never kept". `final` waits for the accurate pass (7 days at most). */
function retentionUntil(policy, nowMs) {
  const days = { '7d': 7, '30d': 30, final: 7 }[policy];
  return days ? new Date(nowMs + days * DAY).toISOString() : null;
}

/**
 * Delete what is past its date, and folders whose meeting no longer exists. Returns how many meetings' audio was removed.
 * The live transcript that was set aside when the accurate one replaced it goes with the audio (it is only there to compare).
 */
function purgeExpired({ repo, archive, now = () => Date.now() }) {
  let removed = 0;
  const known = new Set(repo.d.meetings.map((m) => m.id));
  for (const id of archive.ids()) if (!known.has(id)) { archive.remove(id); removed += 1; }
  for (const m of repo.d.meetings) {
    if (!m.audio || !m.audio.keepUntil) continue;
    if (Date.parse(m.audio.keepUntil) > now()) continue;
    archive.remove(m.id);
    repo.updateMeeting(m.id, { audio: null, liveSegments: null });
    removed += 1;
  }
  return removed;
}

module.exports = { AudioArchive, retentionUntil, purgeExpired, DAY };
