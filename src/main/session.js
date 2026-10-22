const { EventEmitter } = require('events');

/**
 * The one recording that can be running. Owns the clock, talks to the engine, stores transcript lines as they arrive
 * (so a crash loses at most a few seconds), and writes the notes when it stops.
 *
 * Events: 'state' (snapshot for every window), 'partial' (the line being spoken), 'segment' (a stored line).
 * Island states shown by the UI: recording | paused | writing | done(6 s) | idle.
 */
class Session extends EventEmitter {
  constructor({ repo, engine, now = () => Date.now(), tickMs = 1000, doneLingerMs = 6000 }) {
    super();
    this.repo = repo;
    this.engine = engine;
    this.now = now;
    this.tickMs = tickMs;
    this.doneLingerMs = doneLingerMs;
    this.meetingId = null;
    this.phase = 'idle';              // idle | recording | paused | writing | done
    this.elapsedBeforeMs = 0;
    this.runningSince = null;
    this.levels = { mic: 0, sys: 0 };
    this.lastSound = null;
    this.partial = null;
    this.timer = null;
    this.lingerTimer = null;
    this.error = '';
  }

  elapsedMs() {
    return this.elapsedBeforeMs + (this.runningSince ? this.now() - this.runningSince : 0);
  }

  snapshot() {
    const m = this.meetingId ? this.repo.getMeeting(this.meetingId) : null;
    const quiet = this.phase === 'recording' && this.lastSound !== null && this.now() - this.lastSound > 30_000;
    return {
      phase: this.phase,
      meetingId: this.meetingId,
      title: m ? m.title : '',
      elapsedMs: this.elapsedMs(),
      levels: this.levels,
      source: this._source(),
      quiet: !!quiet,
      partial: this.partial,
      error: this.error,
      engine: { id: this.engine.id, label: this.engine.label, realTranscription: this.engine.realTranscription, needsAudio: !!this.engine.needsAudio, audioFormat: this.engine.audioFormat || 'webm' },
      consent: m ? m.consent.status : 'pending',
      place: m ? m.place || 'both' : 'both',                  // room | online | both: where the people are (decides what is captured)
      audioKept: !!(m && m.audio && m.audio.keep),          // the audio is being kept on this computer for the accurate pass
    };
  }

  _source() {
    if (this.phase !== 'recording') return 'quiet';
    const { mic, sys } = this.levels;
    if (mic < 0.06 && sys < 0.06) return 'quiet';
    return mic >= sys ? 'me' : 'them';
  }

  _emit() { this.emit('state', this.snapshot()); }

  /** Begin a meeting. `consent` is the answer to the reminder: 'confirmed' ("Já avisei") or 'solo' ("Só eu"). */
  start(input, consent) {
    if (this.phase !== 'idle' && this.phase !== 'done') {
      const e = new Error('Já existe uma gravação em curso.'); e.code = 'already_recording'; throw e;
    }
    clearTimeout(this.lingerTimer);
    const startedAt = new Date(this.now()).toISOString();
    const meeting = this.repo.createMeeting({ ...input, status: 'recording', startedAt });
    this.meetingId = meeting.id;
    this.repo.addConsent(meeting.id, 'recording_started', 'Gravação iniciada');
    this.repo.addConsent(meeting.id, 'reminder_shown', 'Lembrete mostrado: “Avisa os participantes que estão a ser gravados.”');
    this.repo.addConsent(meeting.id, consent === 'solo' ? 'solo' : 'confirmed', consent === 'solo' ? 'Escolheu: Só eu' : 'Escolheu: Já avisei');
    this._begin(meeting, 0);
    return meeting;
  }

  /** Take over a meeting that was interrupted (crash, power cut): keep what exists and continue from there. */
  resumeInterrupted(id) {
    const m = this.repo.getMeeting(id);
    if (!m) { const e = new Error('Reunião não encontrada.'); e.code = 'not_found'; throw e; }
    this.meetingId = id;
    const last = m.segments.length ? m.segments[m.segments.length - 1].startMs : 0;
    this.repo.addConsent(id, 'recovered', 'Reunião recuperada depois de uma interrupção');
    this._begin(m, last);
    return m;
  }

  _begin(meeting, elapsedMs) {
    this.error = '';
    this.phase = 'recording';
    this.elapsedBeforeMs = elapsedMs;
    this.runningSince = this.now();
    this.lastSound = this.now();
    this.levels = { mic: 0, sys: 0 };
    this.repo.updateMeeting(meeting.id, { status: 'recording' });
    this.engine.start(meeting, {
      partial: (p) => { this.partial = p ? { ...p, who: this._name(p.speakerKey) } : null; this._emit(); },
      problem: (p) => { this.error = p.message; this._emit(); },
      final: (seg) => {
        this.partial = null;
        const { stored } = this.repo.addSegments(meeting.id, [seg]);
        for (const row of stored) this.emit('segment', { meetingId: meeting.id, segment: { ...row, who: this._name(row.speakerKey) } });
        this._emit();
      },
    }, () => this.elapsedMs());
    clearInterval(this.timer);
    this.timer = setInterval(() => this._emit(), this.tickMs);
    if (this.timer.unref) this.timer.unref();
    this._emit();
  }

  _name(key) {
    const m = this.repo.getMeeting(this.meetingId);
    return m ? this.repo.speakerName(m, key) : key;
  }

  pause() {
    if (this.phase !== 'recording') return;
    this.elapsedBeforeMs = this.elapsedMs(); this.runningSince = null;
    this.phase = 'paused';
    this.engine.pause();
    this.repo.updateMeeting(this.meetingId, { status: 'paused' });
    this._emit();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.runningSince = this.now(); this.lastSound = this.now();
    this.phase = 'recording';
    this.engine.resume();
    this.repo.updateMeeting(this.meetingId, { status: 'recording' });
    this._emit();
  }

  /** Levels (0..1) measured from the real microphone and computer sound by the window that owns the audio. */
  pushLevels(levels) {
    this.levels = { mic: clamp(levels.mic), sys: clamp(levels.sys) };
    if (this.levels.mic > 0.06 || this.levels.sys > 0.06) this.lastSound = this.now();
    this.emit('levels', this.levels);
  }

  quickNote(text) {
    if (!this.meetingId || !String(text || '').trim()) return;
    this.repo.appendMyNote(this.meetingId, `• ${String(text).trim()}`);
    this.emit('notes', this.meetingId);
  }

  /** A piece of audio from the window that owns the microphone. Only engines that need audio take it. */
  feedAudio(chunk) {
    if (this.phase === 'recording' && this.engine.feed) return this.engine.feed(chunk);
    return undefined;
  }

  /** Stop recording and write the notes. Resolves when the notes are stored (or recorded as failed). */
  async stop() {
    if (this.phase !== 'recording' && this.phase !== 'paused') return null;
    if (this.stopping) return null;
    this.stopping = true;
    // the last seconds of sound are still in the audio window: ask it to hand them over, then let the engine finish what it has
    if (this.engine.needsAudio) {
      if (this.beforeStop) { try { await this.beforeStop(); } catch { /* stop anyway */ } }
      if (this.engine.drain) { try { await this.engine.drain(); } catch { /* stop anyway */ } }
    }
    const id = this.meetingId;
    const durationSeconds = Math.round(this.elapsedMs() / 1000);
    clearInterval(this.timer);
    this.engine.stop();
    this.partial = null;
    this.elapsedBeforeMs = this.elapsedMs(); this.runningSince = null;
    const m0 = this.repo.getMeeting(id);
    const hidden = m0._hidden || 0;
    this.repo.updateMeeting(id, { status: 'processing', endedAt: new Date(this.now()).toISOString(), durationSeconds, notesState: 'writing' });
    this.repo.addConsent(id, 'recording_stopped', `Gravação parada${hidden ? ` · ${hidden} detalhes sensíveis ocultados` : ''}`);
    this.phase = 'writing';
    this._emit();
    await this.generateNotes(id);
    this.phase = 'done';
    this._emit();
    this.stopping = false;
    this.emit('finished', id);                                    // the app may now improve the transcript from the kept audio
    if (this.engine.release) this.engine.release();
    this.lingerTimer = setTimeout(() => { this.phase = 'idle'; this.meetingId = null; this._emit(); }, this.doneLingerMs);
    if (this.lingerTimer.unref) this.lingerTimer.unref();
    return this.repo.getMeeting(id);
  }

  /** (Re)write the notes for a finished meeting. Never throws: a failure is stored on the meeting. */
  async generateNotes(id) {
    const m = this.repo.getMeeting(id);
    if (!m) return;
    this.repo.updateMeeting(id, { notesState: 'writing', notesError: '' });
    this.emit('notes-state', { id, state: 'writing' });
    try {
      // What kind of meeting it was: a hint shown next to the person's own choice, and the one "Escolhe por mim" uses. It never holds up the notes.
      if (!m.templateDetected && typeof this.engine.detectType === 'function' && (m.segments.length || m.myNotes.trim())) {
        try {
          const found = await this.engine.detectType(m, (key) => this.repo.speakerName(m, key));
          if (found && found.key) this.repo.updateMeeting(id, { templateDetected: { key: found.key, confidence: found.confidence ?? 0, by: found.by || 'rules' } });
        } catch { /* a hint only */ }
      }
      const fresh = this.repo.getMeeting(id);
      const result = await this.engine.writeNotes(fresh, (key) => this.repo.speakerName(fresh, key));
      this.repo.setGenerated(id, result);
      if (!m.keepTranscript && m.segments.length) this.repo.deleteTranscript(id);
      this.emit('notes-state', { id, state: 'ready' });
    } catch (err) {
      const message = /memory|memória/i.test(err.message)
        ? 'O computador ficou sem memória livre. Fecha outras aplicações e tenta outra vez.'
        : 'Não foi possível escrever as notas. Tenta outra vez.';
      this.repo.updateMeeting(id, { notesState: 'failed', notesError: message, status: 'done' });
      this.emit('notes-state', { id, state: 'failed' });
    }
  }
}

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

module.exports = { Session };
