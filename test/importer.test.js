// Audio import (importer.js) and the summarize / import handlers, with fake engines: no network, no model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHandlers } = require('../src/main/handlers');
const { AudioImporter } = require('../src/main/importer');
const { Session } = require('../src/main/session');
const { DemoEngine } = require('../src/main/engine/demo');
const { SecureStore } = require('../src/main/secure');
const { newRepo, tmpDir } = require('./helpers');

const pcm = (n) => Buffer.alloc(n * 2);
const people = (repo, id) => Object.keys(repo.getMeeting(id).speakers).filter((k) => k !== 'spk_me').sort();     // the person's own speaker is always there

/**
 * `lines(piece, index)` answers what the speech service would return for a piece: [{start_ms, end_ms, text}] (or throws).
 * `voices` stands in for the voice step: identify(job) -> {voices, assignments}.
 */
function setup({ ready = true, lines, voiceModel = true, identify, summarize } = {}) {
  const { repo } = newRepo();
  const demo = new DemoEngine({ stepMs: 10 });
  const session = new Session({ repo, engine: demo, doneLingerMs: 10 });
  const asked = [];
  const speech = {
    canTranscribeFile: () => ready, canDictate: () => false,
    transcribeAudio: async (req) => {
      const i = asked.length; asked.push(req);
      const out = lines ? lines(req, i) : [{ start_ms: 0, end_ms: 4000, text: `Frase número ${i}.` }, { start_ms: 5000, end_ms: 9000, text: `Segunda frase ${i}.` }];
      if (out instanceof Error) throw out;
      return { segments: out };
    },
    summarize: summarize || (async (req) => ({ text: `resumo(${req.scope},${req.style},${req.language})`, engine: 'llm', model: 'm' })),
  };
  const jobs = [];
  const voices = {
    available: () => voiceModel, modelPath: () => 'C:\\models\\titanet.onnx',
    identify: async (job, onProgress) => { jobs.push({ ...job, bytes: fs.existsSync(job.pcmPath) ? fs.statSync(job.pcmPath).size : -1 }); onProgress(0.5); return identify ? identify(job) : { voices: 2, assignments: job.segments.map((_, i) => i % 2) }; },
  };
  let now = Date.parse('2026-10-21T10:00:00Z');
  const tmp = tmpDir();
  const importer = new AudioImporter({ repo, engine: speech, notes: (id) => session.generateNotes(id), voices, tmpDir: tmp, now: () => now });
  const events = []; importer.on('progress', (p) => events.push(p));
  const secure = new SecureStore(path.join(tmpDir(), 's.bin'), null, { requireEncryption: false });
  secure.set('user', { name: 'Ana Silva', email: 'ana@exemplo.ao' });
  const licence = { status: () => ({ state: 'ok', plan: 'pro', features: [], meetingsPerMonth: null, canRecord: true }), clear() {}, refresh: async () => {} };
  const services = { openExternal: async () => {}, saveFile: async () => ({ saved: true }), writeClipboard: async () => {}, gpuInfo: async () => ({}), freeDiskBytes: async () => 1e9,
    printPdf: async () => Buffer.from('%PDF'), fetchText: async () => '', wipeLocal: async () => {}, setTheme() {}, setIsland() {}, applyHotkeys() {}, hotkeyStatus: () => ({}) };
  const voiceModels = { status: () => ({ state: voiceModel ? 'ready' : 'missing' }) };
  const h = createHandlers({ repo, session, engine: speech, api: { signedIn: () => true }, licence, secure, services, importer, voices, voiceModels, version: '0.1.0' });
  return { h, repo, importer, events, asked, jobs, tmp, tick: (ms) => { now += ms; } };
}
const begin = (h, over = {}) => h['import:begin']({ fileName: 'reuniao_com_banco.mp3', durationMs: 60000, rights: 'confirmed', ...over });
const piece = (h, id, over = {}) => h['import:piece']({ id, startMs: 0, durationMs: 30000, mime: 'audio/mpeg', data: Buffer.from('audio'), ...over });

test('a file becomes a meeting: lines at the right times, voices told apart, notes written, consent recorded', async () => {
  const s = setup();
  const b = await begin(s.h);
  assert.equal(b.voices, 'on');
  let m = s.repo.getMeeting(b.id);
  assert.equal(m.title, 'reuniao com banco'); assert.equal(m.status, 'processing'); assert.equal(m.notesState, 'writing');
  assert.ok(m.consent.events.some((e) => e.kind === 'imported' && /reuniao_com_banco\.mp3/.test(e.note)));
  await piece(s.h, b.id, { startMs: 0, durationMs: 30000 });
  await piece(s.h, b.id, { startMs: 30000, durationMs: 30000 });
  await s.h['import:pcm']({ id: b.id, data: pcm(16000) }); await s.h['import:pcm']({ id: b.id, data: pcm(16000) });
  const r = await s.h['import:finish']({ id: b.id });
  m = s.repo.getMeeting(b.id);
  assert.deepEqual([m.status, m.notesState, r.voices, r.voicesError], ['done', 'ready', 2, '']);
  assert.deepEqual(m.segments.map((x) => [x.text, x.startMs, x.speakerKey]), [['Frase número 0.', 0, 'spk_1'], ['Segunda frase 0.', 5000, 'spk_2'], ['Frase número 1.', 30000, 'spk_1'], ['Segunda frase 1.', 35000, 'spk_2']]);
  assert.deepEqual(people(s.repo, b.id), ['spk_1', 'spk_2']);
  assert.equal(m.durationSeconds, 60);
  assert.equal(r.meeting.id, b.id);
  assert.deepEqual(s.events.filter((e) => e.stage === 'transcribing').map((e) => [e.doneMs, e.totalMs]), [[30000, 60000], [60000, 60000]]);
  assert.deepEqual([...new Set(s.events.map((e) => e.stage))], ['transcribing', 'voices', 'notes']);
  assert.equal(s.events.at(-1).done, true);
});

test('what the speech service is asked: the audio as it is, its length, the language, and the names it should spell right', async () => {
  const s = setup();
  const b = await begin(s.h, { language: 'pt' });
  s.repo.updateMeeting(b.id, { attendees: [{ name: 'Rui Costa', email: '' }, { name: 'Maria Lopes', email: '' }] });
  const data = Buffer.from('mp3 bytes');
  await piece(s.h, b.id, { startMs: 0, durationMs: 45500, mime: 'video/mp4', data });
  const req = s.asked[0];
  assert.equal(req.mime, 'video/mp4'); assert.equal(req.seconds, 45.5); assert.equal(req.language, 'pt'); assert.deepEqual(Buffer.from(req.data), data);
  assert.match(req.prompt, /^Rui Costa, Maria Lopes, kwanzas, Multicaixa Express/);
  assert.ok(req.prompt.length <= 380);
  await s.h['import:cancel']({ id: b.id });
});

test('the audio samples wait in a temporary file for the voice step, which gets the lines and their times, and the file is removed afterwards', async () => {
  const s = setup();
  const b = await begin(s.h, { voiceCount: 3 });
  await piece(s.h, b.id);
  await s.h['import:pcm']({ id: b.id, data: pcm(8000) }); await s.h['import:pcm']({ id: b.id, data: new Uint8Array(pcm(8000)).buffer });
  const file = path.join(s.tmp, `ivuenu-import-${b.id}.pcm`);
  assert.equal(fs.statSync(file).size, 32000);
  await s.h['import:finish']({ id: b.id });
  const job = s.jobs[0];
  assert.equal(job.bytes, 32000); assert.equal(job.totalSec, 1); assert.equal(job.voices, 3); assert.equal(job.modelPath, 'C:\\models\\titanet.onnx');
  assert.deepEqual(job.segments, [{ startMs: 0, endMs: 4000 }, { startMs: 5000, endMs: 9000 }]);
  assert.equal(fs.existsSync(file), false);
});

test('voices can be left out, or the model may be missing, or the step may fail: the import still finishes with one speaker', async () => {
  const off = setup(); const a = await begin(off.h, { separateVoices: false });
  assert.equal(a.voices, 'off'); await piece(off.h, a.id); await off.h['import:pcm']({ id: a.id, data: pcm(100) });
  const r1 = await off.h['import:finish']({ id: a.id });
  assert.deepEqual([off.jobs.length, r1.voices, people(off.repo, a.id)], [0, 0, ['spk_1']]);

  const missing = setup({ voiceModel: false }); const b = await begin(missing.h);
  assert.equal(b.voices, 'model_missing'); await piece(missing.h, b.id);
  assert.equal((await missing.h['import:finish']({ id: b.id })).meeting.id, b.id); assert.equal(missing.jobs.length, 0);

  const broken = setup({ identify: () => { throw Object.assign(new Error('boom'), { code: 'voices_failed' }); } }); const c = await begin(broken.h);
  await piece(broken.h, c.id); await broken.h['import:pcm']({ id: c.id, data: pcm(100) });
  const r3 = await broken.h['import:finish']({ id: c.id });
  assert.deepEqual([r3.voices, r3.voicesError, broken.repo.getMeeting(c.id).notesState, people(broken.repo, c.id)], [0, 'voices_failed', 'ready', ['spk_1']]);
  assert.equal(fs.existsSync(path.join(broken.tmp, `ivuenu-import-${c.id}.pcm`)), false);

  const one = setup({ lines: () => [{ start_ms: 0, end_ms: 3000, text: 'Só uma frase.' }] }); const d = await begin(one.h);       // nothing to tell apart
  await piece(one.h, d.id); await one.h['import:pcm']({ id: d.id, data: pcm(100) }); await one.h['import:finish']({ id: d.id });
  assert.equal(one.jobs.length, 0);
});

test('rights and the speech service are checked before anything is created', async () => {
  const s = setup();
  await assert.rejects(() => s.h['import:begin']({ fileName: 'a.mp3' }), (e) => e.code === 'consent_required');
  await assert.rejects(() => s.h['import:begin']({ fileName: 'a.mp3', rights: 'yes' }), (e) => e.code === 'consent_required');
  assert.equal(s.repo.listMeetings({}).length, 0);
  const none = setup({ ready: false });
  await assert.rejects(() => begin(none.h), (e) => e.code === 'engine_missing');
  assert.equal(none.repo.listMeetings({}).length, 0);
  const avail = await s.h['import:available']();
  assert.deepEqual([avail.ready, avail.voices, avail.voiceModel.state], [true, true, 'ready']);
  assert.equal((await none.h['import:available']()).ready, false);
  const { id } = await begin(s.h, { title: '  Chamada com cliente  ', fileName: '' });
  assert.equal(s.repo.getMeeting(id).title, 'Chamada com cliente');
});

test('only one import at a time, until the first one is finished or abandoned', async () => {
  const s = setup();
  const a = await begin(s.h);
  await assert.rejects(() => begin(s.h), (e) => e.code === 'import_busy');
  s.tick(4 * 60 * 1000);                                              // its window went quiet: abandoned
  const b = await begin(s.h);
  assert.notEqual(a.id, b.id);
  assert.equal(s.repo.getMeeting(a.id), null);                        // the abandoned one is removed
  await s.h['import:finish']({ id: b.id });
  await begin(s.h);                                                   // free again
});

test('silence in a piece stores nothing; a failing piece rejects with the service\'s code and cancel removes everything', async () => {
  let n = 0;
  const s = setup({ lines: () => { n += 1; return n === 1 ? [] : n === 2 ? Object.assign(new Error('Sem ligação'), { code: 'offline' }) : [{ start_ms: 0, end_ms: 2000, text: 'ok' }]; } });
  const { id } = await begin(s.h);
  await piece(s.h, id);
  assert.equal(s.repo.getMeeting(id).segments.length, 0);
  await assert.rejects(() => piece(s.h, id, { startMs: 30000 }), (e) => e.code === 'offline');
  await piece(s.h, id, { startMs: 60000, durationMs: 10000 });                                          // the chain still works
  assert.equal(s.repo.getMeeting(id).segments.length, 1);
  await s.h['import:pcm']({ id, data: pcm(100) });
  const file = path.join(s.tmp, `ivuenu-import-${id}.pcm`); assert.equal(fs.existsSync(file), true);
  await s.h['import:cancel']({ id });
  assert.equal(s.repo.getMeeting(id), null); assert.equal(fs.existsSync(file), false);
  await assert.rejects(() => piece(s.h, id), (e) => e.code === 'not_found');
});

test('an import cut short by the app closing is marked failed, not offered as a recording', async () => {
  const s = setup();
  const { id } = await begin(s.h);
  await piece(s.h, id);
  const other = s.repo.createMeeting({ title: 'gravação normal', status: 'processing' });
  assert.equal(s.repo.recoverImports(), 1);
  const m = s.repo.getMeeting(id);
  assert.equal(m.notesState, 'failed'); assert.equal(m.status, 'done'); assert.match(m.notesError, /interrompida/);
  assert.equal(s.repo.getMeeting(other.id).status, 'processing');      // a real interrupted recording is left for the normal recovery
});

test('voices given to lines: a speaker left with no lines and no name disappears, a named one stays', () => {
  const { repo } = newRepo();
  const m = repo.createMeeting({ title: 'x', status: 'done' });
  repo.addSegments(m.id, [{ clientId: 'a', speakerKey: 'spk_1', text: 'um', startMs: 0 }, { clientId: 'b', speakerKey: 'spk_1', text: 'dois', startMs: 5000 }]);
  repo.renameSpeaker(m.id, 'spk_1', 'Ana');
  repo.assignSpeakers(m.id, [[1, 'spk_2'], [2, 'spk_2']]);
  assert.deepEqual(people(repo, m.id), ['spk_1', 'spk_2']);                                          // spk_1 has no lines but a name
  repo.renameSpeaker(m.id, 'spk_1', '');
  repo.assignSpeakers(m.id, [[1, 'spk_3']]);
  assert.deepEqual(people(repo, m.id), ['spk_2', 'spk_3']);                                           // unnamed and unused: gone
});

function withTranscript(repo, text = 'Eu envio a lista de preços até sexta-feira. Vamos subir os preços em janeiro.') {
  const m = repo.createMeeting({ title: 'Preços', status: 'done' });
  repo.addSegments(m.id, [{ clientId: 'a', speakerKey: 'spk_2', text, startMs: 0 }]);
  return m.id;
}

test('summarize meeting: from the transcript, in the app language, saved only when asked', async () => {
  const s = setup();
  const id = withTranscript(s.repo);
  const out = await s.h['meetings:summarize']({ id, style: 'detailed' });
  assert.deepEqual([out.text, out.engine, out.basis, out.saved], ['resumo(meeting,detailed,pt)', 'llm', 'transcript', false]);
  assert.equal(s.repo.getMeeting(id).summary, '');
  const en = await s.h['meetings:summarize']({ id, style: 'nonsense', save: true, language: 'en' });
  assert.equal(en.text, 'resumo(meeting,normal,en)');                                // unknown style -> normal
  assert.equal(s.repo.getMeeting(id).summary, 'resumo(meeting,normal,en)');
});

test('summarize meeting without a transcript uses the notes; with nothing at all it says so', async () => {
  const s = setup(); let seen;
  const t = setup({ summarize: async (req) => { seen = req; return { text: 'x', engine: 'llm' }; } });
  const m = t.repo.createMeeting({ title: 'Só notas', status: 'done' });
  t.repo.setMyNotes(m.id, 'Decidimos adiar o lançamento para março.');
  const out = await t.h['meetings:summarize']({ id: m.id });
  assert.equal(out.basis, 'notes'); assert.match(seen.text, /adiar o lançamento/);
  const empty = s.repo.createMeeting({ title: 'Vazia', status: 'done' });
  await assert.rejects(() => s.h['meetings:summarize']({ id: empty.id }), (e) => e.code === 'nothing_to_summarize');
  await assert.rejects(() => s.h['meetings:summarize']({ id: 'nope' }), (e) => e.code === 'not_found');
});

test('summarize notes: the text in the box wins over what was saved, and too little text is refused', async () => {
  let seen;
  const s = setup({ summarize: async (req) => { seen = req; return { text: 'curto', engine: 'extractive' }; } });
  const m = s.repo.createMeeting({ title: 'N', status: 'done' });
  s.repo.setMyNotes(m.id, 'versão guardada das notas que é comprida o bastante');
  await s.h['notes:summarize']({ id: m.id, text: 'versão ainda não guardada, também comprida o bastante' });
  assert.equal(seen.scope, 'notes'); assert.match(seen.text, /ainda não guardada/); assert.equal(seen.style, 'short');
  await s.h['notes:summarize']({ id: m.id });
  assert.match(seen.text, /versão guardada/);
  await assert.rejects(() => s.h['notes:summarize']({ id: m.id, text: 'curta' }), (e) => e.code === 'nothing_to_summarize');
  assert.equal((await s.h['notes:summarize']({ id: m.id, text: 'x'.repeat(100), style: 'detailed' })) && seen.style, 'detailed');
});
