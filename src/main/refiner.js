const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vocabularyPrompt } = require('./engine/vocab');

const fail = (code, message) => Object.assign(new Error(message), { code });
const CONTEXT_CHARS = 300;               // the end of the previous block, given to the next one so a sentence that crosses the cut is not misheard
const SHORT_TEXT = 0.2;                  // an accurate pass that finds less than this share of the live text is distrusted and not used

const words = (t) => String(t || '').toLowerCase().match(/[a-zà-ú0-9]+/g) || [];
const jaccard = (a, b) => { const A = new Set(words(a)); const B = new Set(words(b)); let n = 0; for (const w of A) if (B.has(w)) n += 1; return n / Math.max(1, A.size + B.size - n); };

/**
 * A second, more accurate pass over a meeting whose audio was kept on this computer. The live transcript (short pieces, fast model) is a preview;
 * this sends the audio in blocks of about 10 minutes to the speech service's accurate model, each block given the end of the previous one as context,
 * tells the voices apart (this is what separates the people when everybody is in the same room and only one microphone heard them), replaces the transcript
 * and writes the notes again. The live transcript is set aside (meeting.liveSegments) until the audio is deleted, to compare.
 *
 * It never makes things worse: if the pass fails, finds almost no text, or the person is offline, the live transcript stays and `meeting.refine` says why.
 * A failure to tell the voices apart does not fail the pass.
 *
 * engine: { canTranscribeFile(), transcribeAudio({data, mime, seconds, language, prompt, quality}) }   archive: AudioArchive
 * decode(bytes) -> 16 kHz mono PCM16 (the window decodes: Chromium has the audio decoders)   voices: { available(), modelPath(), identify(job, onProgress) } | null
 * notes(id) writes the notes   policy() -> 'off' | 'final' | '7d' | '30d'
 * Emits 'progress' { id, stage: 'transcribing'|'voices'|'notes', doneMs, totalMs, value?, done?, error? }.
 */
class Refiner extends EventEmitter {
  constructor({ repo, engine, archive, notes, voices = null, decode = null, policy = () => '7d', tmpDir = os.tmpdir(), now = () => Date.now() }) {
    super();
    Object.assign(this, { repo, engine, archive, notes, voices, decode, policy, tmpDir, now });
    this.active = null;
  }

  state() { return this.active ? { running: true, id: this.active.id, stage: this.active.stage, doneMs: this.active.doneMs, totalMs: this.active.totalMs } : { running: false }; }

  _progress(a, extra = {}) { this.emit('progress', { id: a.id, stage: a.stage, doneMs: a.doneMs, totalMs: a.totalMs, ...extra }); }

  async run(id) {
    if (this.active) throw fail('refine_busy', 'Já há uma transcrição a ser melhorada.');
    const m = this.repo.getMeeting(id);
    if (!m) throw fail('not_found', 'Reunião não encontrada.');
    const blocks = this.archive.blocks(id);
    if (!blocks.length) throw fail('no_audio', 'O áudio desta reunião já não está guardado.');
    if (!this.engine.canTranscribeFile()) throw fail('engine_missing', 'A transcrição não está disponível.');
    const a = this.active = { id, stage: 'transcribing', doneMs: 0, totalMs: Math.round(blocks.reduce((n, b) => n + b.seconds * 1000, 0)) };
    this.repo.updateMeeting(id, { refine: { state: 'running', at: new Date(this.now()).toISOString(), error: '' } });
    this._progress(a);
    try {
      const lines = dedupeEcho(await this._transcribe(m, blocks, a));
      if (!lines.length) throw fail('no_text', 'Não foi percebida fala no áudio guardado.');
      const before = m.segments.reduce((n, s) => n + words(s.text).length, 0);
      if (before > 50 && lines.reduce((n, l) => n + words(l.text).length, 0) < SHORT_TEXT * before) throw fail('too_little_text', 'A segunda transcrição encontrou muito menos texto do que a primeira: ficou a primeira.');
      const voiceInfo = await this._voices(m, blocks, lines, a);
      this._store(id, m, lines, voiceInfo);
      a.stage = 'notes'; this._progress(a);
      await this.notes(id);
      this.repo.addConsent(id, 'refined', 'Transcrição melhorada a partir do áudio guardado neste computador.');
      this.repo.updateMeeting(id, { refine: { state: 'done', at: new Date(this.now()).toISOString(), voices: voiceInfo.voices, voiceState: voiceInfo.state, error: '' } });
      if (this.policy() === 'final') { this.archive.remove(id); this.repo.updateMeeting(id, { audio: null, liveSegments: null }); }
      this._progress(a, { done: true });
      return { meeting: this.repo.getMeeting(id), voices: voiceInfo.voices, voiceState: voiceInfo.state };
    } catch (e) {
      this.repo.updateMeeting(id, { refine: { state: 'failed', at: new Date(this.now()).toISOString(), error: e.code || 'failed' } });
      this._progress(a, { done: true, error: e.code || 'failed' });
      throw e;
    } finally {
      this.active = null;
    }
  }

  _prompt(meeting, context) { return [vocabularyPrompt(meeting), context].filter(Boolean).join(' ').slice(0, 800); }

  async _transcribe(m, blocks, a) {
    const lines = [];
    for (const source of [...new Set(blocks.map((b) => b.source))]) {
      let context = '';
      for (const block of blocks.filter((b) => b.source === source)) {
        const res = await this.engine.transcribeAudio({
          data: this.archive.read(a.id, block.file), mime: 'audio/webm', seconds: Math.max(0.3, block.seconds), language: m.language || undefined,
          prompt: this._prompt(m, context), quality: 'best',
        });
        const here = [];
        for (const s of res.segments || []) {
          const text = String(s.text || '').trim();
          if (!text) continue;
          const startMs = block.startMs + (s.start_ms || 0);
          here.push({ source, startMs, endMs: block.startMs + Math.max(s.end_ms || 0, (s.start_ms || 0) + 500), text, language: res.language || null });
        }
        lines.push(...here);
        context = here.map((l) => l.text).join(' ').slice(-CONTEXT_CHARS);
        a.doneMs += Math.round(block.seconds * 1000); this._progress(a);
      }
    }
    return lines.sort((x, y) => x.startMs - y.startMs);
  }

  /** Who spoke each line, per recorded source. Never throws: { state: 'on' | 'off' | 'model_missing' | 'failed', voices, perSource: {source: {voices, assignments}} } */
  async _voices(m, blocks, lines, a) {
    const out = { state: 'on', voices: 0, perSource: {} };
    if (!this.voices || !this.decode) return { ...out, state: 'off' };
    if (!this.voices.available()) return { ...out, state: 'model_missing' };
    a.stage = 'voices'; this._progress(a, { value: 0 });
    for (const source of [...new Set(blocks.map((b) => b.source))]) {
      const mine = lines.map((l, index) => ({ l, index })).filter((x) => x.l.source === source);
      if (mine.length < 2) continue;
      const pcmPath = path.join(this.tmpDir, `ivuenu-refine-${a.id}-${source}.pcm`);
      try {
        fs.rmSync(pcmPath, { force: true });
        for (const block of blocks.filter((b) => b.source === source)) {
          const pcm = Buffer.from(await this.decode(this.archive.read(a.id, block.file)));
          const at = Math.round(block.startMs * 32);                                       // 16 kHz x 2 bytes = 32 bytes per millisecond
          const have = fs.existsSync(pcmPath) ? fs.statSync(pcmPath).size : 0;
          if (have < at) fs.appendFileSync(pcmPath, Buffer.alloc(at - have));               // a gap between blocks stays silent, so the times still line up
          fs.appendFileSync(pcmPath, pcm);
        }
        const res = await this.voices.identify({
          pcmPath, modelPath: this.voices.modelPath(), segments: mine.map(({ l }) => ({ startMs: l.startMs, endMs: l.endMs })),
          totalSec: fs.statSync(pcmPath).size / 32000, voices: Math.max(0, Math.min(12, Number(m.voiceCount) || 0)),
        }, (value) => this._progress(a, { value }));
        out.perSource[source] = { voices: res.voices, assignments: new Map(mine.map((x, i) => [x.index, res.assignments[i]])) };
      } catch (e) {
        out.state = 'failed';
        console.error('[refine] telling the voices apart failed:', e && e.message);
      } finally { try { fs.rmSync(pcmPath, { force: true }); } catch { /* temporary */ } }
    }
    out.voices = Object.values(out.perSource).reduce((n, s) => Math.max(n, s.voices), 0);
    return out;
  }

  /**
   * Speaker keys. Without voices it is what the live recording used: the microphone is the person ("spk_me"), the computer's sound is "spk_2".
   * With several voices on the microphone (everybody in the same room) they become Orador 1, 2…, and the computer's sound continues the numbering.
   */
  _store(id, m, lines, voiceInfo) {
    const mic = voiceInfo.perSource.mic; const sys = voiceInfo.perSource.system;
    const room = !!mic && mic.voices >= 2;
    const sysBase = room ? mic.voices : 1;
    const rows = lines.map((l, index) => {
      let speakerKey;
      if (l.source === 'mic') speakerKey = room ? `spk_${mic.assignments.get(index) + 1}` : 'spk_me';
      else speakerKey = sys && sys.voices >= 2 ? `spk_${sysBase + sys.assignments.get(index) + 1}` : `spk_${sysBase + 1}`;
      return { clientId: `ref_${id}_${index}`, speakerKey, source: l.source, text: l.text, language: l.language, startMs: l.startMs };
    });
    this.repo.replaceSegments(id, rows);
  }
}

/** The same words heard by the microphone and by the computer's sound (the other people, through the speakers): keep the cleaner computer-sound line. */
function dedupeEcho(lines) {
  const system = lines.filter((l) => l.source === 'system');
  if (!system.length) return lines;
  return lines.filter((l) => l.source !== 'mic' || !system.some((s) => Math.abs(s.startMs - l.startMs) <= 4000 && words(l.text).length >= 3 && jaccard(s.text, l.text) >= 0.5));
}

module.exports = { Refiner, dedupeEcho };
