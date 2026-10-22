const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store } = require('../src/main/store');
const { Repo } = require('../src/main/repo');
const { newRepo } = require('./helpers');

test('a store survives a restart and writes atomically', () => {
  const { dir, store, repo } = newRepo();
  const m = repo.createMeeting({ title: 'Revisão' });
  repo.setMyNotes(m.id, 'olá');
  store.flush();
  const again = new Repo(new Store(path.join(dir, 'data.json')));
  assert.equal(again.getMeeting(m.id).myNotes, 'olá');
  assert.ok(!fs.existsSync(path.join(dir, 'data.json.tmp')));
});

test('a corrupt data file is kept aside and the app starts empty', () => {
  const { dir } = newRepo();
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{not json');
  const s = new Store(file);
  assert.equal(s.data.meetings.length, 0);
  assert.ok(fs.existsSync(`${file}.corrupt`));
});

test('segments are idempotent per clientId and redacted when the meeting asks', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({ redact: true });
  repo.addSegments(m.id, [{ clientId: 'a', text: 'o pin é 4821', speakerKey: 'spk_2' }]);
  const second = repo.addSegments(m.id, [{ clientId: 'a', text: 'o pin é 4821', speakerKey: 'spk_2' }]);
  assert.equal(second.stored.length, 0);
  assert.equal(repo.getMeeting(m.id).segments.length, 1);
  assert.match(repo.getMeeting(m.id).segments[0].text, /••••/);
});

test('redaction can be switched off per meeting', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({ redact: false });
  repo.addSegments(m.id, [{ text: 'o pin é 4821', speakerKey: 'spk_2' }]);
  assert.equal(repo.getMeeting(m.id).segments[0].text, 'o pin é 4821');
});

test('new speakers get a colour in order of first speech and can be renamed', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({});
  repo.addSegments(m.id, [{ text: 'um', speakerKey: 'spk_2' }, { text: 'dois', speakerKey: 'spk_3' }]);
  const got = repo.getMeeting(m.id);
  assert.deepEqual([got.speakers.spk_me.color, got.speakers.spk_2.color, got.speakers.spk_3.color], [0, 1, 2]);
  repo.renameSpeaker(m.id, 'spk_2', 'Bruno');
  assert.equal(repo.speakerName(repo.getMeeting(m.id), 'spk_2'), 'Bruno');
  assert.equal(repo.speakerName(repo.getMeeting(m.id), 'spk_3'), 'Orador 3');
  assert.equal(repo.speakerName(repo.getMeeting(m.id), 'spk_me'), 'Tu');
});

test('search folds accents and finds title, notes and transcript', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({ title: 'Orçamento Kilamba' });
  repo.setMyNotes(m.id, 'rever o orçamento');
  repo.addSegments(m.id, [{ text: 'o orçamento sobe', speakerKey: 'spk_2', startMs: 61000 }]);
  const r = repo.search('orcamento');
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.results[0].hits.map((h) => h.kind), ['Título', 'Notas', 'Transcrição']);
  assert.equal(r.results[0].hits[2].t, '00:01:01');
  assert.equal(repo.search('inexistente').total, 0);
});

test('deleting a folder un-files its meetings instead of deleting them', () => {
  const { repo } = newRepo();
  const f = repo.createFolder('Clientes');
  const m = repo.createMeeting({ folderId: f.id });
  repo.deleteFolder(f.id);
  assert.equal(repo.getMeeting(m.id).folderId, null);
});

test('tasks: generated ones are replaced on rewrite, the person\'s own stay', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({});
  repo.addTask(m.id, 'minha tarefa');
  repo.setGenerated(m.id, { summary: 's', tasks: [{ text: 'gerada 1' }], blocks: [], extra: [] });
  repo.setGenerated(m.id, { summary: 's', tasks: [{ text: 'gerada 2' }], blocks: [], extra: [] });
  assert.deepEqual(repo.getMeeting(m.id).tasks.map((t) => t.text), ['minha tarefa', 'gerada 2']);
});

test('tasks overview counts open items and skips hidden ones', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({ title: 'A', startedAt: new Date().toISOString() });
  const a = repo.addTask(m.id, 'um'); const b = repo.addTask(m.id, 'dois'); repo.addTask(m.id, 'três');
  repo.patchTask(m.id, a.id, { done: true });
  repo.patchTask(m.id, b.id, { hidden: true });
  const o = repo.tasksOverview();
  assert.equal(o.open, 1);
  assert.equal(o.groups[0].items.length, 2);
});

test('meetings this month and interrupted recordings', () => {
  const { repo } = newRepo();
  const now = new Date('2026-10-20T12:00:00Z');
  repo.createMeeting({ startedAt: '2026-10-02T09:00:00Z', status: 'done' });
  repo.createMeeting({ startedAt: '2026-09-30T09:00:00Z', status: 'done' });
  const live = repo.createMeeting({ startedAt: '2026-10-20T10:00:00Z', status: 'recording' });
  assert.equal(repo.meetingsThisMonth(now), 2);
  assert.deepEqual(repo.interrupted().map((x) => x.id), [live.id]);
});

test('notes-only: the transcript is deleted and the deletion is logged', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({ keepTranscript: false });
  repo.addSegments(m.id, [{ text: 'olá', speakerKey: 'spk_2' }]);
  repo.deleteTranscript(m.id);
  const got = repo.getMeeting(m.id);
  assert.equal(got.segments.length, 0);
  assert.ok(got.transcriptDeletedAt);
  assert.equal(got.consent.events.at(-1).kind, 'transcript_deleted');
});
