const { writeNotes: localNotes } = require('./notes');
const { material, hasMaterial } = require('./email');
const { pcm16ToWav } = require('../wav');
const { vocabularyPrompt } = require('./vocab');
const { effectiveTemplate, toServerKey, fromServerKey, sampleText } = require('./mtype');

/**
 * THE CLOUD ENGINE (plan Pro + Cloud and company plans). It sends short pieces of audio to the Ivuenu server for transcription and
 * asks the server's stronger model for notes. The server keeps nothing: audio and text are processed and forgotten. The meeting
 * itself still lives on this computer. If the network or the server fails, notes fall back to the local method, so a meeting is
 * never left without notes.
 *
 * The window that owns the microphone cuts the sound into ~12 second pieces (renderer/lib/audio.js) and hands each piece to feed().
 */
const BUILTIN_RECIPES = new Set(['suggest-reply', 'catch-up', 'explain', 'good-questions', 'tldr', 'decisions', 'unanswered', 'blind-spots', 'coach', 'shorter']);
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CloudEngine {
  constructor({ api, getSettings, fallback, retryMs = [1500, 4000] }) {
    this.id = 'cloud';
    this.label = 'Transcrição na nuvem';
    this.realTranscription = true;
    this.needsAudio = true;
    this.audioFormat = 'webm';
    this.api = api;
    this.getSettings = getSettings;
    this.fallback = fallback;                 // the local engine, used when the cloud cannot write notes
    this.retryMs = retryMs;
    this._sink = null; this._clock = null; this._paused = false; this._queue = Promise.resolve(); this._pending = 0; this._n = 0;
    this.lastError = null;
  }

  modelStatus() { return { state: 'ready', cloud: true, label: 'Na nuvem: o áudio é enviado e não é guardado' }; }

  /**
   * A recording that already exists, or a piece of one (imports, dictation): { data, mime, seconds, language, prompt } -> the lines { start_ms, end_ms, text } with
   * times from the start of this audio. A bad moment on the network is retried; the other failures throw with the server's code (offline, plan_required, ...).
   */
  async transcribeAudio({ data, mime, seconds, language, prompt, quality }) {
    const wanted = language || this.getSettings().language;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.api.cloudTranscribe(Buffer.from(data), mime, seconds, wanted && wanted !== 'auto' ? wanted : undefined, prompt, ...(quality ? [{ quality }] : []));
      } catch (err) {
        const final = err.code === 'cloud_minutes_exhausted' || err.code === 'plan_required' || err.code === 'cloud_disabled_by_policy' || err.status === 401 || err.status === 413 || err.status === 422;
        if (final || attempt === MAX_ATTEMPTS) throw err;
        await sleep(this.retryMs[attempt - 1] || 4000);
      }
    }
    return null;
  }

  /** Dictation: pieces of 16 kHz mono PCM16 -> the text. */
  async dictate(chunks) {
    let out = '';
    for (const c of chunks) {
      const pcm = Buffer.from(c.data.buffer ? new Uint8Array(c.data.buffer, c.data.byteOffset, c.data.byteLength) : new Uint8Array(c.data));
      const r = await this.transcribeAudio({ data: pcm16ToWav(pcm), mime: 'audio/wav', seconds: Math.max(0.3, pcm.length / 32000) });
      const text = (r.segments || []).map((s) => s.text).join(' ').trim();
      if (text) out += (out ? ' ' : '') + text;
    }
    return out;
  }

  start(meeting, sink, elapsedMs) {
    this._sink = sink; this._clock = elapsedMs; this._paused = false; this._n = 0; this.lastError = null; this._meetingId = meeting.id;
    this._prompt = vocabularyPrompt(meeting);                     // the people of the meeting and local terms, so the speech service spells them right
    this._preview = !!(meeting.audio && meeting.audio.keep);      // the audio is kept: a more accurate pass follows, so these live pieces are only a preview
    this._context = {};                                           // per source, the end of what was just heard: the next piece starts knowing it
  }

  pause() { this._paused = true; }
  resume() { this._paused = false; }
  stop() { this._paused = true; }

  /** Wait until every piece already handed in has been answered (called when the recording stops). */
  async drain(timeoutMs = 20000) {
    await Promise.race([this._queue, sleep(timeoutMs)]);
  }

  /** One piece of audio: { source: 'mic'|'system', mime, seconds, data: ArrayBuffer|Uint8Array }. Pieces are sent one at a time, in order. */
  feed(chunk) {
    if (!this._sink || this._paused || this.lastError) return Promise.resolve();
    const startMs = Math.max(0, this._clock() - Math.round(chunk.seconds * 1000));
    const index = this._n++;
    this._pending += 1;
    this._queue = this._queue.then(() => this._send(chunk, startMs, index)).catch(() => {}).finally(() => { this._pending -= 1; });
    return this._queue;
  }

  async _send(chunk, startMs, index) {
    const sink = this._sink;
    const language = this.getSettings().language;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const prompt = [this._prompt, this._context[chunk.source]].filter(Boolean).join(' ').slice(0, 800);
        const res = await this.api.cloudTranscribe(Buffer.from(chunk.data), chunk.mime, chunk.seconds, language === 'auto' ? undefined : language, prompt, { preview: this._preview });
        this._context[chunk.source] = (res.segments || []).map((s) => s.text).join(' ').slice(-300) || this._context[chunk.source];
        res.segments.forEach((s, i) => {
          if (!sink) return;
          sink.final({
            clientId: `cl_${this._meetingId}_${index}_${chunk.source}_${i}`,
            speakerKey: chunk.source === 'mic' ? 'spk_me' : 'spk_2', source: chunk.source === 'mic' ? 'mic' : 'system',
            text: s.text, language: res.language || null, translation: null, startMs: startMs + s.start_ms,
          });
        });
        this.lastError = null;
        return;
      } catch (err) {
        const final = err.code === 'cloud_minutes_exhausted' || err.code === 'plan_required' || err.code === 'cloud_disabled_by_policy' || err.status === 401 || err.status === 422 || err.status === 413;
        if (final || attempt === MAX_ATTEMPTS) {
          this._problem(err);
          return;
        }
        await sleep(this.retryMs[attempt - 1] || 4000);               // a bad moment on the network: try this piece again
      }
    }
  }

  /** Stop sending after a problem that retrying will not fix, and tell the person why (shown on the live screen). */
  _problem(err) {
    const permanent = ['cloud_minutes_exhausted', 'plan_required', 'cloud_disabled_by_policy'].includes(err.code);
    this.lastError = { code: err.code || 'error', message: MESSAGES[err.code] || (err.code === 'offline' ? MESSAGES.offline : MESSAGES.error), permanent };
    if (this._sink && this._sink.problem) this._sink.problem(this.lastError);
  }

  _transcript(meeting, nameOf) { return meeting.segments.map((s) => ({ speaker: nameOf(s.speakerKey), text: s.text })); }

  /** Notes: the person's own lines are matched to what was said locally; the title, summary and tasks come from the server's model. */
  async writeNotes(meeting, nameOf) {
    const local = localNotes(meeting, nameOf);
    try {
      const out = await this.api.cloudNotes({
        title: meeting.title || '', my_notes: meeting.myNotes || '', attendees: (meeting.attendees || []).map((a) => a.name || a.email).filter(Boolean),
        transcript: this._transcript(meeting, nameOf), template: toServerKey(effectiveTemplate(meeting)), redact: meeting.redact !== false,
      });
      const lines = String(out.notes_markdown || '').split('\n').map((l) => l.replace(/^[\s#>*•-]+/, '').trim()).filter(Boolean).slice(0, 14);
      return {
        title: out.title || local.title, summary: out.summary || local.summary, blocks: local.blocks, engine: 'cloud',
        extra: lines.map((text) => ({ text, t: '' })),
        tasks: out.action_items.length ? out.action_items.map((i) => ({ text: i.text, owner: i.owner || '', due: i.due || '', t: '' })) : local.tasks,
      };
    } catch (err) {
      return { ...local, engine: 'demo-fallback', fallbackReason: (err && (err.code || (err.status && `http_${err.status}`))) || 'error' };      // the cloud could not be reached: local notes beat none, and the reason is kept
    }
  }

  async runRecipe(meeting, recipeId, opts = {}, nameOf) {
    if (!BUILTIN_RECIPES.has(recipeId)) return this.fallback.runRecipe(meeting, recipeId, opts, nameOf);
    try {
      const out = await this.api.cloudRecipe({ recipe_id: recipeId, live: !!opts.live, title: meeting.title || '', notes: meeting.summary || meeting.myNotes || '', transcript: this._transcript(meeting, nameOf), redact: meeting.redact !== false });
      return { text: out.text };
    } catch (err) {
      return this.fallback.runRecipe(meeting, recipeId, opts, nameOf);
    }
  }

  /** Summary by the server's model. Throws when it cannot (the router then summarises locally). */
  async summarize({ scope, title, text, style, language, meeting }) {
    const out = await this.api.cloudSummarize({ scope, title: title || '', text, style, language: language === 'en' ? 'en' : 'pt', redact: meeting.redact !== false });
    return { text: out.text, engine: 'cloud' };
  }

  /** A follow-up email from the notes, written by the server's model. Throws when it cannot (the router then drafts locally). */
  async draftEmail({ meeting, tone, language, includeTasks, senderName, attendeeNames }) {
    const mat = material(meeting);
    if (!hasMaterial(mat)) { const e = new Error('no notes'); e.code = 'nothing_to_write'; throw e; }
    const out = await this.api.cloudEmail({
      title: meeting.title || '', summary: mat.summary.slice(0, 2000), notes: [mat.mine, ...mat.added].filter(Boolean).join('\n').slice(0, 20000),
      tasks: mat.tasks.slice(0, 50).map((t) => ({ text: t.text.slice(0, 500), owner: t.owner.slice(0, 120), due: t.due.slice(0, 40) })),
      attendees: attendeeNames.slice(0, 50), sender_name: senderName || '', tone, language, include_tasks: !!includeTasks, redact: meeting.redact !== false,
    });
    return { subject: out.subject, body: out.body, engine: 'cloud' };
  }

  /** What kind of meeting was it? Throws when the server cannot answer (the router then decides locally). */
  async detectType(meeting, nameOf) {
    const out = await this.api.cloudClassify({
      title: meeting.title || '', attendees: (meeting.attendees || []).map((a) => a.name || a.email).filter(Boolean).slice(0, 50),
      text: sampleText(meeting, nameOf, 6000), notes: (meeting.myNotes || '').slice(0, 4000), redact: meeting.redact !== false,
    });
    return { key: fromServerKey(out.type), confidence: out.confidence, by: 'cloud' };
  }

  async ask(meeting, question, nameOf) {
    try {
      const out = await this.api.cloudAsk({ title: meeting.title || '', summary: meeting.summary || '', notes: meeting.myNotes || '', transcript: this._transcript(meeting, nameOf), question, redact: meeting.redact !== false });
      return { text: out.text };
    } catch (err) {
      return this.fallback.ask(meeting, question, nameOf);
    }
  }
}

const MESSAGES = {
  cloud_minutes_exhausted: 'Os minutos de transcrição na nuvem deste mês acabaram. A gravação continua, mas sem transcrição.',
  plan_required: 'O teu plano já não inclui a transcrição na nuvem.',
  cloud_disabled_by_policy: 'A tua empresa não permite a transcrição na nuvem.',
  offline: 'Sem ligação: algumas partes da conversa não foram transcritas.',
  error: 'Parte da conversa não pôde ser transcrita.',
};

module.exports = { CloudEngine };
