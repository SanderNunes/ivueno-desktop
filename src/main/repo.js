const { uid, nowIso, fold } = require('./util');
const { redact } = require('./redact');

const TEMPLATES = ['auto', 'general', 'one_to_one', 'standup', 'interview', 'sales', 'brainstorm', 'minutes'];

/** Everything the app does to meetings, folders, tasks and settings. No Electron in here, so it is easy to test. */
class Repo {
  constructor(store, emit = () => {}) {
    this.store = store;
    this.emit = emit;
  }

  get d() { return this.store.data; }

  // --- settings ------------------------------------------------------------------------------

  settings() { return { ...this.d.settings }; }

  patchSettings(patch) {
    this.store.mutate((d) => { Object.assign(d.settings, patch); });
    this.emit('settings');
    return this.settings();
  }

  onboarded() { return !!this.d.onboarded; }

  setOnboarded(value = true) {
    this.store.mutate((d) => { d.onboarded = value; });
  }

  // --- meetings ------------------------------------------------------------------------------

  createMeeting(input = {}) {
    const s = this.d.settings;
    const now = nowIso();
    const meeting = {
      id: uid('mtg'),
      title: String(input.title || '').slice(0, 200),
      status: input.status || 'idle',
      source: 'local',
      folderId: input.folderId || null,
      template: TEMPLATES.includes(input.template) ? input.template : s.template,
      language: input.language === undefined ? (s.language === 'auto' ? null : s.language) : input.language,
      translateTo: input.translateTo || null,
      templateDetected: null,    // {key, confidence, by}: what kind of meeting it looks like (the person's own choice stays in `template`)
      keepTranscript: input.keepTranscript ?? s.keepTranscript,
      redact: input.redact ?? s.redact,
      attendees: (input.attendees || []).slice(0, 100).map((a) => ({ name: a.name || '', email: a.email || '' })),
      calendarEventId: input.calendarEventId || null,
      place: ['room', 'online', 'both'].includes(input.place) ? input.place : (s.meetingPlace || 'both'),   // everybody in the room | a call | both
      audio: input.audio || null,          // {keep, keepUntil, blocks, bytes}: the audio kept on this computer for the accurate pass (null = none)
      refine: null,                        // {state: running | done | failed, at, voices, voiceState, error}: the accurate pass over the kept audio
      liveSegments: null,                  // the live transcript, set aside when the accurate one replaced it (only while the audio is kept)
      consent: { status: 'pending', events: [] },
      startedAt: input.startedAt || null,
      endedAt: null,
      durationSeconds: null,
      createdAt: now,
      updatedAt: now,
      myNotes: '',
      notesState: 'none',        // none | writing | ready | failed
      notesError: '',
      notesEngine: '',
      summary: '',
      aiBlocks: [],              // [{mine, add, t}] what the engine added next to each of the person's own lines
      aiExtra: [],               // [{text, t}] "also said"
      segments: [],
      speakers: { spk_me: { name: '', color: 0, isMe: true } },
      tasks: [],
      chat: [],
      feedback: { summary: 0 },
      transcriptDeletedAt: null,
      version: 1,
    };
    this.store.mutate((d) => { d.meetings.push(meeting); });
    this.emit('meetings');
    return meeting;
  }

  getMeeting(id) { return this.d.meetings.find((m) => m.id === id) || null; }

  _require(id) {
    const m = this.getMeeting(id);
    if (!m) { const e = new Error('meeting_not_found'); e.code = 'not_found'; throw e; }
    return m;
  }

  updateMeeting(id, patch) {
    const m = this._require(id);
    const allowed = ['title', 'folderId', 'template', 'language', 'translateTo', 'summary', 'status', 'endedAt',
      'startedAt', 'durationSeconds', 'notesState', 'notesError', 'notesEngine', 'keepTranscript', 'redact', 'attendees', 'syncOff', 'templateDetected', 'place', 'audio', 'refine', 'liveSegments', 'voiceCount'];
    this.store.mutate(() => {
      for (const k of allowed) if (k in patch) m[k] = patch[k];
      m.updatedAt = nowIso();
      m.version += 1;
    });
    this.emit('meetings', id);
    return m;
  }

  deleteMeeting(id) {
    this._require(id);
    this.store.mutate((d) => { d.meetings = d.meetings.filter((m) => m.id !== id); });
    this.emit('meetings', id);
  }

  addConsent(id, kind, note = '') {
    const m = this._require(id);
    this.store.mutate(() => {
      m.consent.events.push({ t: nowIso(), kind, note });
      if (kind === 'confirmed') m.consent.status = 'confirmed';
      if (kind === 'solo') m.consent.status = 'solo';
    });
    this.emit('meetings', id);
  }

  /** Add transcript lines. Idempotent per clientId. Redacts first when the meeting asks for it. Returns what was stored. */
  addSegments(id, segments) {
    const m = this._require(id);
    const stored = [];
    let hidden = 0;
    this.store.mutate(() => {
      for (const seg of segments) {
        if (seg.clientId && m.segments.some((x) => x.clientId === seg.clientId)) continue;
        let text = String(seg.text || '').trim();
        let translation = seg.translation || null;
        if (!text) continue;
        if (m.redact) {
          const r = redact(text); text = r.text; hidden += r.count;
          if (translation) { const t = redact(translation); translation = t.text; hidden += t.count; }
        }
        const row = {
          id: m.segments.length + 1,
          clientId: seg.clientId || null,
          speakerKey: seg.speakerKey || 'spk_2',
          source: seg.source === 'mic' ? 'mic' : 'system',
          text,
          language: seg.language || null,
          translation,
          startMs: seg.startMs || 0,
        };
        m.segments.push(row);
        stored.push(row);
        if (!m.speakers[row.speakerKey]) {
          const n = Object.keys(m.speakers).length;
          m.speakers[row.speakerKey] = { name: '', color: n % 8, isMe: false };
        }
      }
      if (hidden) m._hidden = (m._hidden || 0) + hidden;
    });
    if (stored.length) this.emit('segments', id);
    return { stored, hidden };
  }

  /** Put a new transcript in place of the current one (the accurate pass). The old lines are set aside in `liveSegments`; speakers the person named keep their names. */
  replaceSegments(id, lines) {
    const m = this._require(id);
    let hidden = 0;
    this.store.mutate(() => {
      if (!m.liveSegments) m.liveSegments = m.segments;
      m.segments = [];
      lines.forEach((seg, i) => {
        let text = String(seg.text || '').trim();
        if (!text) return;
        if (m.redact) { const r = redact(text); text = r.text; hidden += r.count; }
        m.segments.push({ id: m.segments.length + 1, clientId: seg.clientId || `rep_${i}`, speakerKey: seg.speakerKey || 'spk_2', source: seg.source === 'mic' ? 'mic' : 'system', text, language: seg.language || null, translation: null, startMs: seg.startMs || 0 });
        if (!m.speakers[seg.speakerKey]) m.speakers[seg.speakerKey] = { name: '', color: Object.keys(m.speakers).length % 8, isMe: false };
      });
      const used = new Set(m.segments.map((s) => s.speakerKey));
      for (const key of Object.keys(m.speakers)) if (!used.has(key) && !m.speakers[key].name && !m.speakers[key].isMe) delete m.speakers[key];
      if (hidden) m._hidden = (m._hidden || 0) + hidden;
      m.updatedAt = nowIso(); m.version += 1;
    });
    this.emit('segments', id);
    this.emit('meetings', id);
  }

  renameSpeaker(id, key, name) {
    const m = this._require(id);
    if (!m.speakers[key]) { const e = new Error('speaker_not_found'); e.code = 'not_found'; throw e; }
    this.store.mutate(() => { m.speakers[key].name = String(name || '').slice(0, 80); m.updatedAt = nowIso(); });
    this.emit('meetings', id);
  }

  speakerName(m, key) {
    const s = m.speakers[key];
    if (s && s.name) return s.name;
    if (s && s.isMe) return 'Tu';
    return `Orador ${String(key).replace('spk_', '')}`;
  }

  setMyNotes(id, text) {
    const m = this._require(id);
    this.store.mutate(() => { m.myNotes = String(text || '').slice(0, 50000); m.updatedAt = nowIso(); });
    this.emit('notes', id);
    return m.updatedAt;
  }

  appendMyNote(id, line) {
    const m = this._require(id);
    const base = m.myNotes && !m.myNotes.endsWith('\n') ? `${m.myNotes}\n` : (m.myNotes || '');
    return this.setMyNotes(id, `${base}${line}\n`);
  }

  /** Store the result of an engine's note writing: summary, blocks, "also said" and tasks. */
  setGenerated(id, result) {
    const m = this._require(id);
    this.store.mutate(() => {
      if (result.title && !m.title) m.title = result.title.slice(0, 200);
      m.summary = (result.summary || '').slice(0, 2000);
      m.aiBlocks = result.blocks || [];
      m.aiExtra = result.extra || [];
      // Tasks the person already ticked or edited stay; generated ones replace the old generated ones.
      const mine = m.tasks.filter((t) => t.origin === 'user');
      const generated = (result.tasks || []).map((t) => ({
        id: uid('tsk'), text: String(t.text).slice(0, 500), owner: t.owner || '', due: t.due || '',
        done: false, hidden: false, origin: 'engine', t: t.t || '',
      }));
      m.tasks = [...mine, ...generated];
      m.notesState = 'ready';
      m.notesError = '';
      m.notesEngine = result.engine || '';
      m.notesFallback = result.fallbackReason || '';       // why the plain writer was used instead of the server's model (empty when it was not)
      m.status = 'done';
      m.version += 1;
    });
    this.emit('meetings', id);
  }

  deleteTranscript(id, reason = 'notes-only meeting') {
    const m = this._require(id);
    this.store.mutate(() => {
      m.segments = [];
      m.transcriptDeletedAt = nowIso();
      m.consent.events.push({ t: nowIso(), kind: 'transcript_deleted', note: reason });
    });
    this.emit('meetings', id);
  }

  setFeedback(id, summary) {
    const m = this._require(id);
    this.store.mutate(() => { m.feedback.summary = summary; });
  }

  pushChat(id, entry) {
    const m = this._require(id);
    this.store.mutate(() => { m.chat.push({ ...entry, at: nowIso() }); });
    this.emit('chat', id);
  }

  // --- tasks ---------------------------------------------------------------------------------

  addTask(id, text, extra = {}) {
    const m = this._require(id);
    const task = { id: uid('tsk'), text: String(text).slice(0, 500), owner: extra.owner || '', due: extra.due || '',
      done: false, hidden: false, origin: 'user', t: '' };
    this.store.mutate(() => { m.tasks.push(task); });
    this.emit('tasks', id);
    return task;
  }

  patchTask(id, taskId, patch) {
    const m = this._require(id);
    const task = m.tasks.find((t) => t.id === taskId);
    if (!task) { const e = new Error('task_not_found'); e.code = 'not_found'; throw e; }
    this.store.mutate(() => {
      for (const k of ['text', 'owner', 'due', 'done', 'hidden']) if (k in patch) task[k] = patch[k];
      if ('text' in patch || 'owner' in patch || 'due' in patch) task.origin = 'user';
    });
    this.emit('tasks', id);
    return task;
  }

  /** Open tasks across all meetings, newest meeting first, grouped by meeting. */
  tasksOverview({ includeDone = true } = {}) {
    const groups = [];
    for (const m of [...this.d.meetings].sort((a, b) => (b.startedAt || b.createdAt).localeCompare(a.startedAt || a.createdAt))) {
      const items = m.tasks.filter((t) => !t.hidden && (includeDone || !t.done));
      if (!items.length) continue;
      groups.push({ meetingId: m.id, title: m.title || 'Reunião sem título', startedAt: m.startedAt || m.createdAt, items });
    }
    const open = groups.reduce((n, g) => n + g.items.filter((t) => !t.done).length, 0);
    return { groups, open };
  }

  // --- listing, folders, search ----------------------------------------------------------------

  listMeetings({ folderId = null, q = '' } = {}) {
    const folders = new Map(this.d.folders.map((f) => [f.id, f.name]));
    const needle = fold(q);
    return this.d.meetings
      .filter((m) => !folderId || m.folderId === folderId)
      .filter((m) => !needle || fold(m.title).includes(needle))
      .sort((a, b) => (b.startedAt || b.createdAt).localeCompare(a.startedAt || a.createdAt))
      .map((m) => ({
        id: m.id, title: m.title, status: m.status, startedAt: m.startedAt, durationSeconds: m.durationSeconds,
        folderId: m.folderId, folderName: folders.get(m.folderId) || '', notesState: m.notesState,
        openTasks: m.tasks.filter((t) => !t.hidden && !t.done).length,
        totalTasks: m.tasks.filter((t) => !t.hidden).length,
        keepTranscript: m.keepTranscript, attendeeCount: m.attendees.length,
        createdAt: m.createdAt,
      }));
  }

  listFolders() {
    return this.d.folders.map((f) => ({ ...f, count: this.d.meetings.filter((m) => m.folderId === f.id).length }));
  }

  createFolder(name) {
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) { const e = new Error('empty_name'); e.code = 'invalid'; throw e; }
    const folder = { id: uid('fld'), name: clean };
    this.store.mutate((d) => { d.folders.push(folder); });
    this.emit('folders');
    return folder;
  }

  renameFolder(id, name) {
    const folder = this.d.folders.find((f) => f.id === id);
    if (!folder) { const e = new Error('folder_not_found'); e.code = 'not_found'; throw e; }
    this.store.mutate(() => { folder.name = String(name).trim().slice(0, 80) || folder.name; });
    this.emit('folders');
  }

  deleteFolder(id) {
    this.store.mutate((d) => {
      d.folders = d.folders.filter((f) => f.id !== id);
      for (const m of d.meetings) if (m.folderId === id) m.folderId = null;
    });
    this.emit('folders');
    this.emit('meetings');
  }

  search(q) {
    const needle = fold(q).trim();
    if (!needle) return { total: 0, results: [] };
    const folders = new Map(this.d.folders.map((f) => [f.id, f.name]));
    const clock = (ms) => {
      const s = Math.floor(ms / 1000);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
    };
    const results = [];
    let total = 0;
    for (const m of this.d.meetings) {
      const hits = [];
      if (fold(m.title).includes(needle)) hits.push({ kind: 'Título', text: m.title });
      if (m.summary && fold(m.summary).includes(needle)) hits.push({ kind: 'Resumo', text: m.summary });
      for (const line of m.myNotes.split('\n')) if (line.trim() && fold(line).includes(needle)) hits.push({ kind: 'Notas', text: line.trim() });
      for (const s of m.segments) {
        if (fold(s.text).includes(needle) || (s.translation && fold(s.translation).includes(needle))) {
          hits.push({ kind: 'Transcrição', text: s.text, t: clock(s.startMs), speaker: this.speakerName(m, s.speakerKey) });
        }
      }
      if (hits.length) {
        total += hits.length;
        results.push({
          meetingId: m.id, title: m.title || 'Reunião sem título', startedAt: m.startedAt || m.createdAt,
          durationSeconds: m.durationSeconds, folderName: folders.get(m.folderId) || '',
          transcriptDeleted: !!m.transcriptDeletedAt, hits: hits.slice(0, 5), more: Math.max(0, hits.length - 5),
        });
      }
    }
    results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { total, results };
  }

  rememberSearch(q) {
    const clean = String(q || '').trim();
    if (!clean) return;
    this.store.mutate((d) => {
      const list = [clean, ...d.settings.recentSearches.filter((x) => x !== clean)].slice(0, 6);
      d.settings.recentSearches = list;
    });
  }

  // --- usage and recovery ------------------------------------------------------------------

  /** Meetings started this calendar month, counted on this computer. */
  meetingsThisMonth(now = new Date()) {
    return this.d.meetings.filter((m) => {
      if (!m.startedAt) return false;
      const t = new Date(m.startedAt);
      return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth();
    }).length;
  }

  /**
   * Give transcript lines to speakers: `mapping` is [[segmentId, speakerKey], ...]. New speakers get a colour; a speaker left with no lines and no name is removed.
   */
  assignSpeakers(id, mapping) {
    const m = this._require(id);
    const byId = new Map(m.segments.map((s) => [s.id, s]));
    this.store.mutate(() => {
      for (const [segId, key] of mapping) {
        const seg = byId.get(segId);
        if (!seg) continue;
        seg.speakerKey = key;
        if (!m.speakers[key]) m.speakers[key] = { name: '', color: Object.keys(m.speakers).length % 8, isMe: false };
      }
      const used = new Set(m.segments.map((s) => s.speakerKey));
      for (const key of Object.keys(m.speakers)) if (!used.has(key) && !m.speakers[key].name && !m.speakers[key].isMe) delete m.speakers[key];
      m.updatedAt = nowIso();
    });
    this.emit('segments', id);
    this.emit('meetings', id);
  }

  /** Imports (audio files) that were still being transcribed when the app closed cannot be resumed: mark them failed so they are not offered as recordings. */
  recoverImports() {
    let n = 0;
    for (const m of this.d.meetings) {
      if ((m.status === 'processing' || (m.status === 'done' && m.notesState === 'writing')) && m.consent.events.some((e) => e.kind === 'imported')) {
        this.updateMeeting(m.id, { status: 'done', notesState: 'failed', notesError: 'A importação foi interrompida. Importa o ficheiro outra vez.' }); n++;
      }
    }
    return n;
  }

  /** Meetings that were recording when the app stopped (crash, power cut). */
  interrupted() {
    return this.d.meetings
      .filter((m) => m.status === 'recording' || m.status === 'paused' || m.status === 'processing' || (m.status === 'done' && m.notesState === 'writing'))
      .map((m) => ({ id: m.id, title: m.title, startedAt: m.startedAt, segmentCount: m.segments.length,
        hasNotes: !!m.myNotes.trim(), status: m.status }));
  }

  // --- recipes (the person's own one-click helps) ----------------------------------------------

  listRecipes() { return this.d.recipes.slice(); }

  saveRecipe(input) {
    const name = String(input.name || '').trim().slice(0, 80);
    const prompt = String(input.prompt || '').trim().slice(0, 2000);
    if (!name || !prompt) { const e = new Error('empty_recipe'); e.code = 'invalid'; throw e; }
    this.store.mutate((d) => {
      const existing = input.id && d.recipes.find((r) => r.id === input.id);
      if (existing) { existing.name = name; existing.prompt = prompt; existing.view = input.view || existing.view; }
      else d.recipes.push({ id: uid('rcp'), name, prompt, view: input.view || 'done' });
    });
    return this.listRecipes();
  }

  deleteRecipe(id) {
    this.store.mutate((d) => { d.recipes = d.recipes.filter((r) => r.id !== id); });
    return this.listRecipes();
  }
}

module.exports = { Repo, TEMPLATES };
