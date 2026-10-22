const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8000',
  appLanguage: 'pt',
  theme: 'system',            // system | light | dark
  micId: '',
  captureSystem: true,
  language: 'auto',           // spoken language: auto | pt | en
  template: 'auto',
  keepTranscript: true,
  redact: true,
  island: true,
  dictation: true,
  hotkeyDictation: 'Control+Space',   // press to start, press again to stop
  hotkeyIsland: 'CommandOrControl+Shift+I',
  dataMode: 'cloud',          // kept for old settings files: everything runs in the cloud now
  engine: 'demo',
  recentSearches: [],
  audioKeep: '7d',            // how long the audio of a meeting stays on this computer: off | final (until the accurate pass is done) | 7d | 30d
  refineAuto: true,           // after a meeting, send the kept audio for the more accurate transcription by itself
  meetingPlace: 'both',       // who is where: room (everybody here) | online (a call) | both
  syncPrompted: false,        // the "turn on sync" question was shown once (paid plans)
};

const DEFAULT_DATA = () => ({
  v: 1,
  onboarded: false,
  settings: { ...DEFAULT_SETTINGS },
  meetings: [],
  folders: [],
  recipes: [],
  sync: { enabled: false, userId: null, cursor: 0, items: {}, lastRun: null, lastError: '' },
});

/**
 * One JSON file, written atomically (temp file + rename) and debounced. Good enough for the first versions; the
 * move to SQLite is planned when the engine arrives (docs/ENGINE.md). Corrupt or missing files start empty and the
 * bad file is kept next to it as *.corrupt so nothing is silently lost.
 */
class Store {
  constructor(file, { debounceMs = 300 } = {}) {
    this.file = file;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const base = DEFAULT_DATA();
      return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        try { fs.renameSync(this.file, `${this.file}.corrupt`); } catch { /* keep going with an empty store */ }
      }
      return DEFAULT_DATA();
    }
  }

  mutate(fn) {
    const result = fn(this.data);
    this._schedule();
    return result;
  }

  _schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.debounceMs);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  /** Delete everything on this computer (account deletion). */
  wipe() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.data = DEFAULT_DATA();
    try { fs.rmSync(this.file, { force: true }); } catch { /* already gone */ }
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
