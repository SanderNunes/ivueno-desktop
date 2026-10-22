const test = require('node:test');
const assert = require('node:assert/strict');
const { Session } = require('../src/main/session');
const { DemoEngine, SCRIPT } = require('../src/main/engine/demo');
const { writeNotes } = require('../src/main/engine/notes');
const { newRepo } = require('./helpers');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(extra = {}) {
  const { repo } = newRepo();
  const engine = new DemoEngine({ stepMs: 10 });
  const session = new Session({ repo, engine, doneLingerMs: 20, ...extra });
  return { repo, engine, session };
}

test('a full meeting: start, lines arrive, stop writes notes, tasks and a summary', async () => {
  const { repo, session } = setup();
  const m = session.start({ title: '' }, 'confirmed');
  repo.setMyNotes(m.id, 'Preços Q4\n• subir 5% em Jan? Bruno a favor\n☐ Carla → nova lista de preços (sexta)\n');
  for (let i = 0; i < 200 && repo.getMeeting(m.id).segments.length < SCRIPT.length; i++) await wait(20);   // timers are coarse on Windows
  const done = await session.stop();
  assert.equal(done.status, 'done');
  assert.equal(done.notesState, 'ready');
  assert.equal(done.segments.length, SCRIPT.length);
  assert.ok(done.summary.length > 0);
  assert.ok(done.tasks.some((t) => /lista de preços/.test(t.text)));
  assert.ok(done.durationSeconds >= 0);
  assert.deepEqual(done.consent.events.map((e) => e.kind).slice(0, 3), ['recording_started', 'reminder_shown', 'confirmed']);
  assert.equal(done.consent.status, 'confirmed');
});

test('"Só eu" is logged as such', () => {
  const { session } = setup();
  const m = session.start({}, 'solo');
  assert.equal(m.consent.status, 'solo');
});

test('a second recording is refused while one is running', () => {
  const { session } = setup();
  session.start({}, 'confirmed');
  assert.throws(() => session.start({}, 'confirmed'), (e) => e.code === 'already_recording');
});

test('pause stops the clock and the engine, resume continues', async () => {
  let t = 1_000_000;
  const { session } = setup({ now: () => t });
  session.start({}, 'confirmed');
  t += 5000; session.pause();
  const atPause = session.elapsedMs();
  t += 60_000;
  assert.equal(session.elapsedMs(), atPause);
  assert.equal(session.snapshot().phase, 'paused');
  session.resume();
  t += 2000;
  assert.equal(session.elapsedMs(), atPause + 2000);
});

test('notes-only meetings lose the transcript once the notes exist', async () => {
  const { repo, session } = setup();
  const m = session.start({ keepTranscript: false }, 'confirmed');
  await wait(60);
  const done = await session.stop();
  assert.equal(done.notesState, 'ready');
  assert.equal(done.segments.length, 0);
  assert.ok(done.transcriptDeletedAt);
  assert.ok(done.summary, 'the notes were written before the transcript was deleted');
  assert.equal(repo.getMeeting(m.id).consent.events.some((e) => e.kind === 'transcript_deleted'), true);
});

test('a failing engine marks the notes as failed and keeps everything else', async () => {
  const { repo, engine, session } = setup();
  engine.writeNotes = async () => { throw new Error('out of memory'); };
  const m = session.start({}, 'confirmed');
  repo.setMyNotes(m.id, 'uma nota');
  const done = await session.stop();
  assert.equal(done.notesState, 'failed');
  assert.match(done.notesError, /memória/);
  assert.equal(done.myNotes, 'uma nota');
  assert.equal(done.status, 'done');
});

test('a quick note from the island is appended to the notes', () => {
  const { repo, session } = setup();
  const m = session.start({}, 'confirmed');
  session.quickNote('ligar ao Domingos');
  assert.match(repo.getMeeting(m.id).myNotes, /• ligar ao Domingos/);
});

test('levels pick who is speaking and 30 s of silence is flagged', () => {
  let t = 0;
  const { session } = setup({ now: () => t });
  session.start({}, 'confirmed');
  session.pushLevels({ mic: 0.8, sys: 0.1 });
  assert.equal(session.snapshot().source, 'me');
  session.pushLevels({ mic: 0.05, sys: 0.7 });
  assert.equal(session.snapshot().source, 'them');
  session.pushLevels({ mic: 0, sys: 0 });
  assert.equal(session.snapshot().quiet, false);
  t += 31_000;
  assert.equal(session.snapshot().quiet, true);
});

test('an interrupted meeting can be recovered and keeps what was saved', async () => {
  const { repo, session } = setup();
  const m = session.start({}, 'confirmed');
  await wait(40);
  session.engine.stop();            // simulate the app dying: nobody calls stop()
  clearInterval(session.timer);
  const { session: fresh } = setup();
  fresh.repo = repo;
  fresh.engine = new DemoEngine({ stepMs: 10 });
  assert.equal(repo.interrupted().length, 1);
  fresh.resumeInterrupted(m.id);
  const done = await fresh.stop();
  assert.equal(done.notesState, 'ready');
  assert.ok(done.consent.events.some((e) => e.kind === 'recovered'));
});

test('extractive notes quote the speaker next to the matching line and flag ownerless tasks', () => {
  const nameOf = (k) => ({ spk_2: 'Bruno', spk_5: 'Carla' }[k] || k);
  const meeting = {
    title: '', myNotes: '• avisar clientes 1 mês antes\n☐ Carla → lista de preços (sexta)\n',
    segments: [
      { id: 1, speakerKey: 'spk_2', text: 'Temos de avisar os clientes com um mês de antecedência.', startMs: 5000 },
      { id: 2, speakerKey: 'spk_5', text: 'Eu envio a nova lista de preços até sexta-feira.', startMs: 9000 },
      { id: 3, speakerKey: 'spk_2', text: 'E alguém tem de avisar o suporte.', startMs: 12000 },
    ],
  };
  const r = writeNotes(meeting, nameOf);
  assert.match(r.blocks[0].add, /Bruno/);
  assert.equal(r.blocks[0].t, '00:00:05');
  assert.ok(r.tasks.some((t) => t.owner === '' && /suporte/.test(t.text)), 'ownerless commitment');
  assert.ok(r.extra.some((e) => /Ficou sem dono/.test(e.text)));
  assert.ok(r.tasks.some((t) => /sexta/.test(t.due)));
});

test('recipes: live catch-up works, unsupported ones say so honestly', async () => {
  const { repo, engine } = setup();
  const m = repo.createMeeting({});
  repo.addSegments(m.id, SCRIPT.slice(0, 4).map((s, i) => ({ text: s.text, speakerKey: s.who, startMs: i * 1000 })));
  const nameOf = (k) => repo.speakerName(repo.getMeeting(m.id), k);
  const a = await engine.runRecipe(repo.getMeeting(m.id), 'catch-up', { live: true }, nameOf);
  assert.match(a.text, /•/);
  const b = await engine.runRecipe(repo.getMeeting(m.id), 'suggest-reply', { live: true }, nameOf);
  assert.equal(b.unavailable, true);
  const c = await engine.ask(repo.getMeeting(m.id), 'quem falou dos cancelamentos?', nameOf);
  assert.match(c.text, /cancelamentos/);
  assert.equal((await engine.ask(repo.getMeeting(m.id), 'zzzz yyyy', nameOf)).text, 'Não encontrei isso nesta reunião.');
});
