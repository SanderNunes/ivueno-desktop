const { EventEmitter } = require('events');

/**
 * Dictation: press the hotkey, speak, press it again; the text is typed into the app that has the focus.
 * States shown on the island:
 *   idle | listening | inserting | unavailable (3.5 s message) | idle
 * Pressing and HOLDING needs a low-level keyboard hook that this version does not have, so it works as a toggle.
 * The window that owns the microphone records while "listening" and hands the audio over when it stops (handlers: dictation:audio).
 * Turning speech into text is done by the speech service (the server); with the demonstration engine (development only) the island says so.
 */
class Dictation extends EventEmitter {
  /** insertText(text) puts the text into the focused app; it may throw, in which case the text stays on the clipboard. */
  constructor({ engine, getSettings, noticeMs = 3500, insertText = null, audioWaitMs = 2500, settleMs = 250 }) {
    super();
    this.engine = engine;
    this.getSettings = getSettings;
    this.noticeMs = noticeMs;
    this.insertText = insertText;
    this.audioWaitMs = audioWaitMs; this.settleMs = settleMs;
    this.phase = 'idle';
    this.message = '';
    this.timer = null;
    this._audio = []; this._lastAudio = 0;
  }

  snapshot() { return { phase: this.phase, message: this.message, shortcut: this.getSettings().hotkeyDictation }; }

  _set(phase, message = '') { this.phase = phase; this.message = message; this.emit('state', this.snapshot()); }

  _notice(message) {
    this._set('unavailable', message);
    this.timer = setTimeout(() => this._set('idle'), this.noticeMs);
    if (this.timer.unref) this.timer.unref();
  }

  toggle() {
    if (!this.getSettings().dictation) return this.snapshot();
    if (this.phase === 'listening') { this.stop(); return this.snapshot(); }
    if (this.phase === 'idle') this.start();
    return this.snapshot();
  }

  start() {
    clearTimeout(this.timer);
    this._audio = []; this._lastAudio = 0;
    if (this.engine.warm) this.engine.warm();                // load the speech model while the person starts speaking
    this._set('listening');
  }

  cancel() { clearTimeout(this.timer); this._audio = []; this._set('idle'); }

  /** A piece of the dictated audio, from the window that owns the microphone. */
  receiveAudio(chunk) {
    if (this.phase !== 'listening' && this.phase !== 'inserting') return;
    this._audio.push(chunk); this._lastAudio = Date.now();
  }

  _canDictate() {
    const e = this.engine;
    if (!e.realTranscription || typeof e.dictate !== 'function') return false;
    return typeof e.canDictate === 'function' ? !!e.canDictate() : true;
  }

  /** Wait for the audio the window sends when the microphone stops (it may send nothing when nothing loud was heard). */
  _collect() {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const settled = this._audio.length && Date.now() - this._lastAudio >= this.settleMs;
        if (settled || Date.now() - t0 >= this.audioWaitMs) { const got = this._audio; this._audio = []; resolve(got); return; }
        setTimeout(tick, 40);
      };
      tick();
    });
  }

  async stop() {
    if (this.phase !== 'listening') return;
    this._set('inserting');
    if (!this._canDictate()) { this._notice('O ditado não está disponível agora.'); return; }
    try {
      const chunks = await this._collect();
      if (!chunks.length) { this._notice('Não ouvi nada.'); return; }
      const text = String(await this.engine.dictate(chunks) || '').trim();
      if (!text) { this._notice('Não percebi o que disseste.'); return; }
      if (this.insertText) {
        try { await this.insertText(text); } catch { this._notice('Não consegui escrever no outro programa: o texto ficou copiado, cola com Ctrl+V.'); return; }
      }
      this._set('idle');
    } catch (e) {
      const why = {
        offline: 'Sem ligação à internet: o ditado precisa dela.', plan_required: 'O ditado precisa de um plano com transcrição.',
        cloud_minutes_exhausted: 'Os minutos de transcrição deste mês acabaram.', cloud_disabled_by_policy: 'A tua empresa não permite a transcrição na nuvem.',
      };
      this._notice(why[e && e.code] || 'O ditado falhou.');
    }
  }
}

module.exports = { Dictation };
