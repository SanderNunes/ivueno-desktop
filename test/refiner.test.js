// The kept audio, how long it stays, and the accurate second pass over it. Fake speech service, fake voices, fake decoder: no network, no model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { AudioArchive, retentionUntil, purgeExpired, DAY } = require('../src/main/audio-archive');
const { Refiner, dedupeEcho } = require('../src/main/refiner');
const { newRepo, tmpDir } = require('./helpers');

const webm = (n = 100) => Buffer.alloc(n, 7);
const T0 = Date.parse('2026-10-22T10:00:00Z');

function setup({ policy = '7d', lines, voiceModel = true, identify, decode, withVoices = true } = {}) {
  const { repo } = newRepo();
  const archive = new AudioArchive({ dir: tmpDir(), now: () => T0 });
  const m = repo.createMeeting({ title: 'HR', status: 'done', startedAt: new Date(T0).toISOString(), audio: { keep: true, keepUntil: null, blocks: 0, bytes: 0 } });
  repo.addSegments(m.id, [{ clientId: 'live1', speakerKey: 'spk_me', source: 'mic', text: 'Só temos a ver uma como candidata.', startMs: 4000 },
    { clientId: 'live2', speakerKey: 'spk_me', source: 'mic', text: 'Então logo faço uma pergunta.', startMs: 18000 }]);
  const asked = [];
  const engine = {
    canTranscribeFile: () => true,
    transcribeAudio: async (req) => {
      const i = asked.length; asked.push(req);
      const out = lines ? await lines(req, i) : [{ start_ms: 1000, end_ms: 5000, text: `Primeira frase do bloco ${i}.` }, { start_ms: 6000, end_ms: 9000, text: `Segunda frase do bloco ${i}.` }];
      if (out instanceof Error) throw out;
      return { segments: out, language: 'Portuguese' };
    },
  };
  const jobs = [];
  const voices = withVoices ? {
    available: () => voiceModel, modelPath: () => 'C:\\models\\titanet.onnx',
    identify: async (job, onProgress) => {
      jobs.push({ ...job, bytes: fs.existsSync(job.pcmPath) ? fs.statSync(job.pcmPath).size : -1 }); onProgress(0.5);
      return identify ? identify(job) : { voices: 2, assignments: job.segments.map((_, i) => i % 2) };
    },
  } : null;
  const notesFor = [];
  const notes = async (id) => { notesFor.push(id); repo.setGenerated(id, { summary: 'Resumo novo', engine: 'cloud', tasks: [], blocks: [], extra: [] }); };
  const decoded = [];
  const refiner = new Refiner({
    repo, engine, archive, notes, voices, tmpDir: tmpDir(), now: () => T0, policy: () => policy,
    decode: withVoices ? (decode || (async (bytes) => { decoded.push(bytes.length); return Buffer.alloc(3200); })) : null,       // 100 ms of silence
  });
  const events = []; refiner.on('progress', (p) => events.push(p));
  return { repo, archive, refiner, m, asked, jobs, notesFor, decoded, events };
}

// ---------------------------------------------------------------------------------------------- the archive
test('the archive keeps blocks of a meeting, in order, and only what it was given', () => {
  const { archive, m } = setup();
  const a = archive;
  assert.deepEqual(a.add(m.id, { source: 'mic', startMs: 0, seconds: 540, data: webm(100) }), { blocks: 1, bytes: 100 });
  assert.deepEqual(a.add(m.id, { source: 'mic', startMs: 540000, seconds: 300, data: new Uint8Array(50).buffer }), { blocks: 2, bytes: 150 });
  a.add(m.id, { source: 'system', startMs: 0, seconds: 540, data: webm(10) });
  assert.deepEqual(a.blocks(m.id).map((b) => [b.source, b.startMs, b.file]), [['mic', 0, 'mic-000.webm'], ['mic', 540000, 'mic-001.webm'], ['system', 0, 'system-000.webm']]);
  assert.equal(a.read(m.id, 'mic-000.webm').length, 100);
  assert.deepEqual(a.usage(), { meetings: 1, bytes: 160 });
  a.remove(m.id);
  assert.equal(a.has(m.id), false); assert.deepEqual(a.usage(), { meetings: 0, bytes: 0 });
});

test('the archive refuses a bad meeting id, source, size, and a file that is not in its list', () => {
  const { archive, m } = setup();
  assert.throws(() => archive.add('../../etc', { source: 'mic', startMs: 0, seconds: 1, data: webm() }), (e) => e.code === 'invalid');
  assert.throws(() => archive.add(m.id, { source: 'speaker', startMs: 0, seconds: 1, data: webm() }), (e) => e.code === 'invalid');
  assert.throws(() => archive.add(m.id, { source: 'mic', startMs: 0, seconds: 1, data: Buffer.alloc(0) }), (e) => e.code === 'invalid');
  archive.add(m.id, { source: 'mic', startMs: 0, seconds: 1, data: webm() });
  assert.throws(() => archive.read(m.id, '../manifest.json'), (e) => e.code === 'not_found');
});

test('how long the audio stays follows the choice, and expired audio (and orphan folders) is deleted', () => {
  assert.equal(retentionUntil('off', T0), null);
  assert.equal(retentionUntil('7d', T0), new Date(T0 + 7 * DAY).toISOString());
  assert.equal(retentionUntil('30d', T0), new Date(T0 + 30 * DAY).toISOString());
  assert.equal(retentionUntil('final', T0), new Date(T0 + 7 * DAY).toISOString(), 'until the accurate pass is done, 7 days at most');
  const { repo, archive, m } = setup();
  archive.add(m.id, { source: 'mic', startMs: 0, seconds: 1, data: webm() });
  repo.updateMeeting(m.id, { audio: { keep: true, keepUntil: new Date(T0 + 7 * DAY).toISOString() }, liveSegments: [{ id: 1 }] });
  const orphan = 'mtg_deadbeef0000'; archive.add(orphan, { source: 'mic', startMs: 0, seconds: 1, data: webm() });
  assert.equal(purgeExpired({ repo, archive, now: () => T0 + DAY }), 1, 'only the orphan: the meeting is still within its days');
  assert.equal(archive.has(m.id), true); assert.equal(archive.has(orphan), false);
  assert.equal(purgeExpired({ repo, archive, now: () => T0 + 8 * DAY }), 1);
  assert.equal(archive.has(m.id), false); assert.equal(repo.getMeeting(m.id).audio, null); assert.equal(repo.getMeeting(m.id).liveSegments, null);
});

// ---------------------------------------------------------------------------------------------- the accurate pass
test('the accurate pass sends the blocks with the best quality and the end of the previous block as context', async () => {
  const t = setup();
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 540, data: webm() });
  t.archive.add(t.m.id, { source: 'mic', startMs: 540000, seconds: 300, data: webm() });
  await t.refiner.run(t.m.id);
  assert.equal(t.asked.length, 2);
  assert.ok(t.asked.every((r) => r.quality === 'best' && r.mime === 'audio/webm'));
  assert.ok(/kwanzas/.test(t.asked[0].prompt) && !/Segunda frase do bloco 0/.test(t.asked[0].prompt), 'the first block has the vocabulary and no context');
  assert.ok(t.asked[1].prompt.includes('Segunda frase do bloco 0.'), 'the second block knows how the first ended');
  assert.deepEqual(t.asked.map((r) => Math.round(r.seconds)), [540, 300]);
});

test('the transcript is replaced with the times of each block, the live one is set aside, the notes are written again and the pass is recorded', async () => {
  const t = setup();
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 540, data: webm() });
  t.archive.add(t.m.id, { source: 'mic', startMs: 540000, seconds: 300, data: webm() });
  const out = await t.refiner.run(t.m.id);
  const m = t.repo.getMeeting(t.m.id);
  assert.deepEqual(m.segments.map((s) => [s.startMs, s.text]), [[1000, 'Primeira frase do bloco 0.'], [6000, 'Segunda frase do bloco 0.'], [541000, 'Primeira frase do bloco 1.'], [546000, 'Segunda frase do bloco 1.']]);
  assert.deepEqual(m.liveSegments.map((s) => s.clientId), ['live1', 'live2']);
  assert.deepEqual(t.notesFor, [t.m.id]); assert.equal(m.summary, 'Resumo novo');
  assert.equal(m.refine.state, 'done'); assert.ok(m.consent.events.some((e) => e.kind === 'refined'));
  assert.equal(out.voices, 2);
  assert.ok(t.events.some((e) => e.stage === 'transcribing') && t.events.some((e) => e.stage === 'voices') && t.events.at(-1).done === true);
});

test('everybody in the same room: several voices on the microphone become Orador 1, 2, 3', async () => {
  const t = setup({ identify: async (job) => ({ voices: 3, assignments: job.segments.map((_, i) => i % 3) }) });
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 540, data: webm() });
  t.archive.add(t.m.id, { source: 'mic', startMs: 540000, seconds: 300, data: webm() });
  await t.refiner.run(t.m.id);
  const m = t.repo.getMeeting(t.m.id);
  assert.deepEqual(m.segments.map((s) => s.speakerKey), ['spk_1', 'spk_2', 'spk_3', 'spk_1']);
  assert.ok(m.segments.every((s) => s.source === 'mic'));
  assert.deepEqual(Object.keys(m.speakers).sort(), ['spk_1', 'spk_2', 'spk_3', 'spk_me'], 'the person themself stays, with no lines until they say which voice they are');
});

test('one voice on the microphone is the person: spk_me, as in a live meeting', async () => {
  const t = setup({ identify: async (job) => ({ voices: 1, assignments: job.segments.map(() => 0) }) });
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 540, data: webm() });
  await t.refiner.run(t.m.id);
  assert.ok(t.repo.getMeeting(t.m.id).segments.every((s) => s.speakerKey === 'spk_me'));
});

test('two recorded sources: the microphone stays the person, the computer sound is the others, and a line heard twice is kept once', async () => {
  const t = setup({
    identify: async (job) => ({ voices: 1, assignments: job.segments.map(() => 0) }),
    lines: (req) => (req.data.length === 11
      ? [{ start_ms: 2000, end_ms: 6000, text: 'A proposta fica para sexta feira de manhã.' }]
      : [{ start_ms: 500, end_ms: 1500, text: 'Bom dia a todos.' }, { start_ms: 2100, end_ms: 6000, text: 'a proposta fica para sexta-feira de manhã' }]),
  });
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm(10) });
  t.archive.add(t.m.id, { source: 'system', startMs: 0, seconds: 60, data: webm(11) });
  await t.refiner.run(t.m.id);
  const m = t.repo.getMeeting(t.m.id);
  assert.deepEqual(m.segments.map((s) => [s.source, s.speakerKey]), [['mic', 'spk_me'], ['system', 'spk_2']]);
  assert.equal(m.segments[1].text, 'A proposta fica para sexta feira de manhã.', 'the cleaner computer-sound line won');
});

test('dedupeEcho keeps different words and short lines', () => {
  const lines = [{ source: 'mic', startMs: 0, text: 'Sim' }, { source: 'system', startMs: 0, text: 'Sim' }, { source: 'mic', startMs: 100, text: 'Eu envio hoje o relatório' }, { source: 'system', startMs: 100, text: 'O orçamento passa de quinhentos mil' }];
  assert.equal(dedupeEcho(lines).length, 4);
});

test('the blocks are laid out on the real timeline, so a gap stays a gap when the voices are compared', async () => {
  const t = setup({ decode: async () => Buffer.alloc(32000) });                 // one second of samples per block
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 1, data: webm() });
  t.archive.add(t.m.id, { source: 'mic', startMs: 600000, seconds: 1, data: webm() });
  await t.refiner.run(t.m.id);
  assert.equal(t.jobs[0].bytes, 600000 * 32 + 32000, 'the second block starts at 10 minutes, the gap was filled with silence');
  assert.ok(!fs.existsSync(t.jobs[0].pcmPath), 'the temporary samples are removed');
});

test('without the voice model the pass still works, and says the model is missing', async () => {
  const t = setup({ voiceModel: false });
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  const out = await t.refiner.run(t.m.id);
  assert.equal(out.voiceState, 'model_missing'); assert.equal(t.jobs.length, 0);
  assert.ok(t.repo.getMeeting(t.m.id).segments.every((s) => s.speakerKey === 'spk_me'));
  assert.equal(t.repo.getMeeting(t.m.id).refine.voiceState, 'model_missing');
});

test('a failure telling the voices apart never fails the pass', async () => {
  const t = setup({ identify: async () => { throw new Error('boom'); } });
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  const out = await t.refiner.run(t.m.id);
  assert.equal(out.voiceState, 'failed');
  assert.equal(t.repo.getMeeting(t.m.id).segments.length, 2); assert.equal(t.repo.getMeeting(t.m.id).refine.state, 'done');
  const t2 = setup({ decode: async () => { throw new Error('no window'); } });
  t2.archive.add(t2.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  assert.equal((await t2.refiner.run(t2.m.id)).voiceState, 'failed');
});

// ---------------------------------------------------------------------------------------------- it never makes things worse
test('offline or refused: the live transcript stays untouched and the reason is recorded', async () => {
  const t = setup({ lines: () => Object.assign(new Error('offline'), { code: 'offline' }) });
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  await assert.rejects(() => t.refiner.run(t.m.id), (e) => e.code === 'offline');
  const m = t.repo.getMeeting(t.m.id);
  assert.deepEqual(m.segments.map((s) => s.clientId), ['live1', 'live2']);
  assert.deepEqual(m.refine.state, 'failed'); assert.equal(m.refine.error, 'offline'); assert.equal(m.liveSegments, null);
  assert.equal(t.archive.has(t.m.id), true, 'the audio stays so it can be tried again');
  assert.equal(t.refiner.state().running, false);
});

test('a pass that finds almost nothing is not used', async () => {
  const t = setup({ lines: () => [{ start_ms: 0, end_ms: 1000, text: 'Ok.' }] });
  const long = Array.from({ length: 40 }, (_, i) => ({ clientId: `x${i}`, speakerKey: 'spk_me', source: 'mic', text: 'uma frase com várias palavras para contar bem', startMs: 30000 + i * 5000 }));
  t.repo.addSegments(t.m.id, long);
  t.archive.add(t.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  await assert.rejects(() => t.refiner.run(t.m.id), (e) => e.code === 'too_little_text');
  assert.equal(t.repo.getMeeting(t.m.id).segments.length, 42);
});

test('no audio, no text, a busy refiner: clear refusals', async () => {
  const t = setup();
  await assert.rejects(() => t.refiner.run(t.m.id), (e) => e.code === 'no_audio');
  await assert.rejects(() => t.refiner.run('mtg_nothere000'), (e) => e.code === 'not_found');
  const empty = setup({ lines: () => [] });
  empty.archive.add(empty.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  await assert.rejects(() => empty.refiner.run(empty.m.id), (e) => e.code === 'no_text');
  let release; const gate = new Promise((r) => { release = r; });
  const slow = setup({ lines: async () => { await gate; return [{ start_ms: 0, end_ms: 1000, text: 'Olá a todos.' }]; } });
  slow.archive.add(slow.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  const first = slow.refiner.run(slow.m.id);
  await assert.rejects(() => slow.refiner.run(slow.m.id), (e) => e.code === 'refine_busy');
  assert.equal(slow.refiner.state().running, true);
  release(); await first;
});

test('"until the accurate pass is done": the audio and the set-aside transcript are deleted when it succeeds, and kept when it fails', async () => {
  const ok = setup({ policy: 'final' });
  ok.archive.add(ok.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  await ok.refiner.run(ok.m.id);
  assert.equal(ok.archive.has(ok.m.id), false); assert.equal(ok.repo.getMeeting(ok.m.id).audio, null); assert.equal(ok.repo.getMeeting(ok.m.id).liveSegments, null);
  const bad = setup({ policy: 'final', lines: () => new Error('x') });
  bad.archive.add(bad.m.id, { source: 'mic', startMs: 0, seconds: 60, data: webm() });
  await assert.rejects(() => bad.refiner.run(bad.m.id));
  assert.equal(bad.archive.has(bad.m.id), true);
});
