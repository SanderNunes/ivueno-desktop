/**
 * Chooses the engine. Everything that needs AI runs in the cloud (the Ivuenu server, which uses Groq): transcription of recordings,
 * imports and dictation, and notes, summaries, emails and the kind of meeting. The plain rule-based writers of the demonstration engine
 * are only the fallback for TEXT when the server cannot be reached or answers with an error: they never invent a transcript.
 * (`demoSpeech` plays the scripted conversation instead of listening: development only, IVUENU_ENGINE=demo.)
 * Looks like an engine to the rest of the app (same interface). The choice is kept from the start of a recording until it ends.
 */
class EngineRouter {
  constructor({ cloud, demo, getSettings = () => ({}), hasFeature = () => true, demoSpeech = false }) {
    this.cloud = cloud; this.demo = demo; this.getSettings = getSettings; this.hasFeature = hasFeature; this.demoSpeech = demoSpeech;
    this.active = null;
  }

  _speech() { return this.demoSpeech ? this.demo : this.cloud; }
  _current() { return this.active || this._speech(); }
  _wantsCloud(feature) { return this.hasFeature(feature); }

  get id() { return this._current().id; }
  get label() { return this._current().label; }
  get realTranscription() { return this._current().realTranscription; }
  get needsAudio() { return !!this._current().needsAudio; }
  get audioFormat() { return this._current().audioFormat || 'webm'; }

  modelStatus() { return this._current().modelStatus(); }
  start(meeting, sink, elapsedMs) { this.active = this._speech(); return this.active.start(meeting, sink, elapsedMs); }
  pause() { return this._current().pause(); }
  resume() { return this._current().resume(); }
  stop() { return this._current().stop(); }
  feed(chunk) { const e = this._current(); return e.feed ? e.feed(chunk) : undefined; }
  async drain() { const e = this._current(); if (e.drain) await e.drain(); }

  // Notes, questions and recipes: the server's model when the plan has it, else the plain writer.
  _writer() { return this._wantsCloud('cloud_notes') ? this.cloud : this.demo; }
  writeNotes(...a) { return this._writer().writeNotes(...a); }
  runRecipe(...a) { return this._writer().runRecipe(...a); }
  ask(...a) { return this._writer().ask(...a); }

  // Summaries, the follow-up email and the kind of meeting: the server's model; if it fails, an extract from the text itself.
  async _text(method, args) {
    if (this._wantsCloud('cloud_notes') && this.cloud[method]) { try { return await this.cloud[method](...args); } catch { /* the plain writer below */ } }
    return this.demo[method](...args);
  }
  summarize(req, nameOf) { return this._text('summarize', [req, nameOf]); }
  draftEmail(req, nameOf) { return this._text('draftEmail', [req, nameOf]); }
  detectType(meeting, nameOf) { return this._text('detectType', [meeting, nameOf]); }

  // Recordings that already exist (imports) and dictation: always the speech service. Failures reach the caller with a code.
  canTranscribeFile() { return !this.demoSpeech; }
  transcribeAudio(req) { return this.cloud.transcribeAudio(req); }
  canDictate() { return !this.demoSpeech; }
  dictate(chunks) { return this.cloud.dictate(chunks); }
  warm() { /* nothing to load: the model lives on the server */ }

  /** Called when a recording has ended, so the next one chooses again. */
  release() { this.active = null; }
}

module.exports = { EngineRouter };
