const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const STALE_MS = 3 * 60 * 1000;           // an import whose window stopped sending anything for this long is abandoned
const { vocabularyPrompt } = require('./engine/vocab');

/**
 * Turns an audio file the person picks into a meeting. The window decodes the file and sends it in pieces (renderer/lib/segment.mjs: the file as it is when
 * small enough, otherwise WAV pieces); each piece is transcribed by the speech service (the server, which uses Groq Whisper) and stored as transcript lines.
 * The window also sends the 16 kHz samples, which stay in a temporary file on this computer: at the end the voices are told apart (voices.js) and the lines are
 * given to "Orador 1, 2…". Then the notes are written like for any other meeting. A failure to tell the voices apart never fails the import.
 * Only one import runs at a time, and a live recording is never disturbed by it.
 *
 *   begin({fileName, title, durationMs, language, rights, separateVoices, voiceCount}) -> {id, voices}      rights must be 'confirmed' ("I may transcribe this")
 *   piece(id, {startMs, durationMs, mime, data})     pcm(id, {data})      finish(id) -> {meeting, voices, voicesError}      cancel(id)
 * Emits 'progress' {id, stage: 'transcribing'|'voices'|'notes', doneMs, totalMs, value?, done?}.
 */
class AudioImporter extends EventEmitter {
  /** engine: {canTranscribeFile(), transcribeAudio(req)}; notes(id) writes the notes; voices: {available(), modelPath(), identify(job, onProgress)} or null. */
  constructor({ repo, engine, notes, voices = null, tmpDir = os.tmpdir(), now = () => Date.now() }) {
    super();
    this.repo = repo; this.engine = engine; this.notes = notes; this.voices = voices; this.tmpDir = tmpDir; this.now = now;
    this.active = null;
  }

  _get(id) {
    if (!this.active || this.active.id !== id) throw fail('not_found', 'Esta importação já não está em curso.');
    this.active.touched = this.now();
    return this.active;
  }

  begin({ fileName = '', title = '', durationMs = 0, language = undefined, rights, separateVoices = true, voiceCount = 0 } = {}) {
    if (this.active && this.now() - this.active.touched < STALE_MS) throw fail('import_busy', 'Já há uma importação em curso.');
    if (this.active) this._drop(this.active);
    if (!this.engine.canTranscribeFile()) throw fail('engine_missing', 'A transcrição não está disponível.');
    if (rights !== 'confirmed') throw fail('consent_required', 'Confirma que tens autorização para transcrever esta gravação.');
    const name = String(fileName || '').slice(0, 200);
    const clean = String(title || '').trim().slice(0, 200) || name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Gravação importada';
    const startedAt = new Date(this.now()).toISOString();
    const m = this.repo.createMeeting({ title: clean, status: 'processing', startedAt, ...(language === undefined ? {} : { language }) });
    this.repo.updateMeeting(m.id, { notesState: 'writing' });
    this.repo.addConsent(m.id, 'imported', `Importado do ficheiro “${name || 'áudio'}”. Confirmou ter autorização para transcrever esta gravação.`);
    const canSeparate = !!(this.voices && this.voices.available());
    this.active = {
      id: m.id, chain: Promise.resolve(), n: 0, lastEnd: 0, totalMs: Math.max(0, Number(durationMs) || 0), cancelled: false, touched: this.now(),
      segs: [], separate: !!separateVoices && canSeparate, voiceCount: Math.max(0, Math.min(12, Number(voiceCount) || 0)), pcmPath: path.join(this.tmpDir, `ivuenu-import-${m.id}.pcm`), pcmBytes: 0,
    };
    if (separateVoices && !canSeparate) console.error('[import] the voice model is not installed: one speaker for everything');
    return { id: m.id, voices: !separateVoices ? 'off' : canSeparate ? 'on' : 'model_missing' };
  }

  /** Names and terms the speakers are likely to use, so the speech service spells them right. */
  _prompt(id) { return vocabularyPrompt(this.repo.getMeeting(id)); }

  /** Transcribe one piece. Resolves when its lines are stored; rejects with the service's code (offline, plan_required, ...) so the caller can stop and cancel. */
  piece(id, { startMs = 0, durationMs = 0, mime = 'audio/wav', data }) {
    const a = this._get(id);
    const index = a.n++;
    const run = async () => {
      if (a.cancelled) return;
      const m = this.repo.getMeeting(id);
      const res = await this.engine.transcribeAudio({ data, mime, seconds: Math.max(0.3, durationMs / 1000), language: m && m.language ? m.language : undefined, prompt: this._prompt(id) });
      if (a.cancelled) return;
      (res.segments || []).forEach((line, i) => {
        const at = startMs + (line.start_ms || 0);
        const { stored } = this.repo.addSegments(id, [{ clientId: `imp_${id}_${index}_${i}`, speakerKey: 'spk_1', source: 'system', text: line.text, startMs: at }]);
        if (stored[0]) a.segs.push({ rowId: stored[0].id, startMs: at, endMs: startMs + Math.max(line.end_ms || 0, (line.start_ms || 0) + 500) });
      });
      a.lastEnd = Math.max(a.lastEnd, startMs + durationMs);
      this.emit('progress', { id, stage: 'transcribing', doneMs: a.lastEnd, totalMs: Math.max(a.totalMs, a.lastEnd) });
    };
    const result = a.chain.then(run);
    a.chain = result.catch(() => {});                           // one failed piece does not wedge the chain; the caller sees the rejection
    return result;
  }

  /** The 16 kHz mono PCM16 samples, in order, for telling the voices apart. Kept in a temporary file, never sent anywhere. */
  pcm(id, { data }) {
    const a = this._get(id);
    if (!a.separate) return;
    const buf = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
    fs.appendFileSync(a.pcmPath, buf);
    a.pcmBytes += buf.length;
  }

  async finish(id) {
    const a = this._get(id);
    await a.chain;
    let voices = 0; let voicesError = '';
    if (a.separate && a.pcmBytes > 0 && a.segs.length >= 2) {
      try {
        this.emit('progress', { id, stage: 'voices', value: 0 });
        const res = await this.voices.identify({
          pcmPath: a.pcmPath, modelPath: this.voices.modelPath(), segments: a.segs.map(({ startMs, endMs }) => ({ startMs, endMs })), totalSec: a.pcmBytes / 32000, voices: a.voiceCount,
        }, (value) => this.emit('progress', { id, stage: 'voices', value }));
        this.repo.assignSpeakers(id, a.segs.map((s, i) => [s.rowId, `spk_${res.assignments[i] + 1}`]));
        voices = res.voices;
      } catch (e) { voicesError = e.code || 'voices_failed'; console.error('[import] telling the voices apart failed:', e && e.message); }
    }
    this._removeAudio(a);
    const seconds = Math.round(Math.max(a.totalMs, a.lastEnd) / 1000);
    const m = this.repo.getMeeting(id);
    this.repo.updateMeeting(id, { endedAt: new Date(Date.parse(m.startedAt) + seconds * 1000).toISOString(), durationSeconds: seconds, notesState: 'writing' });
    this.repo.addConsent(id, 'recording_stopped', 'Importação concluída');
    this.active = null;
    this.emit('progress', { id, stage: 'notes' });
    await this.notes(id);
    this.emit('progress', { id, stage: 'notes', doneMs: seconds * 1000, totalMs: seconds * 1000, done: true });
    return { meeting: this.repo.getMeeting(id), voices, voicesError };
  }

  async cancel(id) {
    const a = this._get(id);
    await this._drop(a);
  }

  _removeAudio(a) { try { fs.rmSync(a.pcmPath, { force: true }); } catch { /* it is only a temporary file */ } }

  async _drop(a) {
    a.cancelled = true;
    await a.chain;
    this._removeAudio(a);
    try { this.repo.deleteMeeting(a.id); } catch { /* already gone */ }
    if (this.active === a) this.active = null;
  }
}

module.exports = { AudioImporter };
