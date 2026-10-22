const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudEngine } = require('../src/main/engine/cloud');
const { EngineRouter } = require('../src/main/engine/router');
const { DemoEngine } = require('../src/main/engine/demo');
const { Session } = require('../src/main/session');
const { newRepo } = require('./helpers');

const err = (code, status = 400) => Object.assign(new Error(code), { code, status });

function fakeApi(over = {}) {
  const calls = { transcribe: [], notes: [], ask: [], recipe: [] };
  const api = {
    calls,
    cloudTranscribe: async (buf, mime, seconds, language) => { calls.transcribe.push({ bytes: buf.length, mime, seconds, language }); return { segments: [{ start_ms: 500, end_ms: 2500, text: `linha ${calls.transcribe.length}` }], language: 'pt' }; },
    cloudNotes: async (body) => { calls.notes.push(body); return { title: 'Título da nuvem', summary: 'Resumo da nuvem.', notes_markdown: '## Decisões\n- Subir preços 5%\n- Avisar clientes', action_items: [{ text: 'Enviar a lista', owner: 'Rui', due: 'sexta' }] }; },
    cloudAsk: async (body) => { calls.ask.push(body); return { text: 'resposta da nuvem' }; },
    cloudRecipe: async (body) => { calls.recipe.push(body); return { name: 'x', text: 'receita da nuvem' }; },
    ...over,
  };
  return api;
}

function engine(api, settings = { language: 'auto' }) {
  const demo = new DemoEngine({ stepMs: 10 });
  const cloud = new CloudEngine({ api, getSettings: () => settings, fallback: demo, retryMs: [1, 1] });
  return { demo, cloud };
}

function started(cloud, elapsed = () => 30_000) {
  const finals = []; const problems = [];
  cloud.start({ id: 'mtg_1' }, { partial: () => {}, final: (s) => finals.push(s), problem: (p) => problems.push(p) }, elapsed);
  return { finals, problems };
}
const chunk = (source = 'mic', seconds = 12) => ({ source, mime: 'audio/webm', seconds, data: new Uint8Array([1, 2, 3, 4]).buffer });

test('a piece of audio becomes transcript lines with the right speaker and time', async () => {
  const api = fakeApi(); const { cloud } = engine(api);
  const { finals } = started(cloud, () => 30_000);
  await cloud.feed(chunk('mic', 12));
  await cloud.feed(chunk('system', 10));
  assert.equal(finals.length, 2);
  assert.equal(finals[0].speakerKey, 'spk_me'); assert.equal(finals[0].source, 'mic');
  assert.equal(finals[1].speakerKey, 'spk_2'); assert.equal(finals[1].source, 'system');
  assert.equal(finals[0].startMs, 18_000 + 500);               // the piece ended "now" (30 s) and lasted 12 s, plus the line's own offset
  assert.equal(finals[0].language, 'pt');
  assert.notEqual(finals[0].clientId, finals[1].clientId);
  assert.deepEqual(api.calls.transcribe[0], { bytes: 4, mime: 'audio/webm', seconds: 12, language: undefined });
});

test('the spoken language setting is passed on (auto lets the server detect)', async () => {
  const api = fakeApi(); const { cloud } = engine(api, { language: 'pt' });
  started(cloud);
  await cloud.feed(chunk());
  assert.equal(api.calls.transcribe[0].language, 'pt');
});

test('pieces are sent one at a time, in order', async () => {
  const order = [];
  let release;
  const api = fakeApi({ cloudTranscribe: async (buf, mime, seconds) => { order.push(`start ${seconds}`); if (seconds === 1) await new Promise((r) => { release = r; }); order.push(`end ${seconds}`); return { segments: [{ start_ms: 0, end_ms: 1, text: 'x' }], language: 'pt' }; } });
  const { cloud } = engine(api);
  started(cloud);
  const first = cloud.feed(chunk('mic', 1)); const second = cloud.feed(chunk('mic', 2));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ['start 1']);                       // the second waits for the first
  release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2']);
});

test('a bad moment on the network is retried and the line still arrives', async () => {
  let n = 0;
  const api = fakeApi({ cloudTranscribe: async () => { n += 1; if (n < 3) throw err('offline', 0); return { segments: [{ start_ms: 0, end_ms: 1, text: 'chegou' }], language: 'pt' }; } });
  const { cloud } = engine(api);
  const { finals, problems } = started(cloud);
  await cloud.feed(chunk());
  assert.equal(n, 3);
  assert.deepEqual(finals.map((f) => f.text), ['chegou']);
  assert.equal(problems.length, 0);
});

test('when the network stays down the person is told and the engine keeps trying later pieces', async () => {
  const api = fakeApi({ cloudTranscribe: async () => { throw err('offline', 0); } });
  const { cloud } = engine(api);
  const { problems } = started(cloud);
  await cloud.feed(chunk());
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /Sem ligação/);
  assert.equal(problems[0].permanent, false);
});

test('when the monthly minutes run out sending stops for good and the person is told why', async () => {
  const api = fakeApi({ cloudTranscribe: async () => { throw err('cloud_minutes_exhausted', 402); } });
  const { cloud } = engine(api);
  const { problems } = started(cloud);
  await cloud.feed(chunk()); await cloud.feed(chunk());
  assert.equal(problems.length, 1);                            // once, not for every piece
  assert.match(problems[0].message, /minutos/);
  assert.equal(problems[0].permanent, true);
});

test('a policy or plan refusal is reported once and nothing more is sent', async () => {
  for (const code of ['cloud_disabled_by_policy', 'plan_required']) {
    let calls = 0;
    const api = fakeApi({ cloudTranscribe: async () => { calls += 1; throw err(code, 403); } });
    const { cloud } = engine(api);
    const { problems } = started(cloud);
    await cloud.feed(chunk()); await cloud.feed(chunk());
    assert.equal(calls, 1, code);
    assert.equal(problems[0].code, code);
  }
});

test('paused and stopped engines send nothing', async () => {
  const api = fakeApi(); const { cloud } = engine(api);
  started(cloud);
  cloud.pause(); await cloud.feed(chunk());
  cloud.resume(); await cloud.feed(chunk());
  cloud.stop(); await cloud.feed(chunk());
  assert.equal(api.calls.transcribe.length, 1);
});

test('drain waits for what is already in flight', async () => {
  let done = false;
  const api = fakeApi({ cloudTranscribe: async () => { await new Promise((r) => setTimeout(r, 30)); done = true; return { segments: [], language: 'pt' }; } });
  const { cloud } = engine(api);
  started(cloud);
  cloud.feed(chunk());
  await cloud.drain();
  assert.equal(done, true);
});

const meeting = () => ({ id: 'mtg_1', title: 'Preços', template: 'general', redact: true, myNotes: '☐ Rui → enviar a lista', summary: '', attendees: [{ name: 'Ana', email: '' }],
  segments: [{ id: 1, speakerKey: 'spk_2', text: 'Vamos subir os preços 5% em Janeiro.', startMs: 1000 }] });

test('notes come from the server model, and the person\'s own lines stay matched to what was said', async () => {
  const api = fakeApi(); const { cloud } = engine(api);
  const out = await cloud.writeNotes(meeting(), (k) => (k === 'spk_2' ? 'Rui' : 'Eu'));
  assert.equal(out.engine, 'cloud');
  assert.equal(out.title, 'Título da nuvem'); assert.equal(out.summary, 'Resumo da nuvem.');
  assert.deepEqual(out.tasks, [{ text: 'Enviar a lista', owner: 'Rui', due: 'sexta', t: '' }]);
  assert.deepEqual(out.extra.map((e) => e.text), ['Decisões', 'Subir preços 5%', 'Avisar clientes']);
  assert.ok(out.blocks.length >= 1 && out.blocks[0].mine.includes('enviar a lista'));
  assert.deepEqual(api.calls.notes[0].transcript, [{ speaker: 'Rui', text: 'Vamos subir os preços 5% em Janeiro.' }]);
  assert.equal(api.calls.notes[0].redact, true);
});

test('if the cloud cannot write the notes, the local method does, so a meeting always has notes', async () => {
  const api = fakeApi({ cloudNotes: async () => { throw err('offline', 0); } });
  const { cloud } = engine(api);
  const out = await cloud.writeNotes(meeting(), () => 'Rui');
  assert.equal(out.engine, 'demo-fallback');
  assert.ok(out.blocks.length >= 1);
});

test('recipes and questions use the server, and fall back to the local ones when it fails or the recipe is custom', async () => {
  const api = fakeApi(); const { cloud, demo } = engine(api);
  assert.equal((await cloud.runRecipe(meeting(), 'decisions', { live: false }, () => 'Rui')).text, 'receita da nuvem');
  assert.equal(api.calls.recipe[0].recipe_id, 'decisions');
  assert.equal((await cloud.ask(meeting(), 'preços?', () => 'Rui')).text, 'resposta da nuvem');
  const custom = await cloud.runRecipe(meeting(), 'rcp_custom', {}, () => 'Rui');            // not a built-in: handled locally
  assert.equal(api.calls.recipe.length, 1);
  assert.deepEqual(custom, await demo.runRecipe(meeting(), 'rcp_custom', {}, () => 'Rui'));
  const broken = fakeApi({ cloudAsk: async () => { throw err('offline', 0); }, cloudRecipe: async () => { throw err('llm_failed', 502); } });
  const b = engine(broken);
  assert.match((await b.cloud.ask(meeting(), 'preços?', () => 'Rui')).text, /disse|encontrei/);
  assert.ok((await b.cloud.runRecipe(meeting(), 'decisions', {}, () => 'Rui')).text.length > 0);
});

// ------------------------------------------------------------------------------------------------ the router
function router(features = ['cloud_transcription', 'cloud_notes'], over = {}) {
  const { demo, cloud } = engine(fakeApi(), { language: 'auto' });
  return { demo, cloud, router: new EngineRouter({ cloud, demo, getSettings: () => ({}), hasFeature: (f) => features.includes(f), ...over }) };
}

test('speech always goes to the cloud engine, with whatever the plan; the server decides if the plan allows it', () => {
  for (const features of [[], ['cloud_transcription']]) {
    const r = router(features).router;
    assert.equal(r.id, 'cloud'); assert.equal(r.needsAudio, true); assert.equal(r.realTranscription, true); assert.equal(r.audioFormat, 'webm');
  }
  assert.equal(router([], { demoSpeech: true }).router.id, 'demo');                // development only: the scripted conversation
});

test('the choice is made when a recording starts and kept until it ends', () => {
  const { router: r } = router();
  r.start({ id: 'm' }, { partial() {}, final() {} }, () => 0);
  assert.equal(r.id, 'cloud');
  r.stop(); r.release();
  assert.equal(r.id, 'cloud');
});

test('notes use the server\'s model when the plan has it, otherwise the plain writer', async () => {
  const withPlan = router(['cloud_notes']).router;
  assert.equal((await withPlan.writeNotes(meeting(), () => 'Rui')).engine, 'cloud');
  const without = router([]).router;
  assert.notEqual((await without.writeNotes(meeting(), () => 'Rui')).engine, 'cloud');
});

test('recordings that already exist and dictation use the speech service', async () => {
  const seen = [];
  const { cloud, router: r } = router();
  cloud.transcribeAudio = async (req) => { seen.push(req); return { segments: [{ start_ms: 0, end_ms: 1000, text: 'olá' }] }; };
  cloud.dictate = async (chunks) => `ditado de ${chunks.length}`;
  assert.equal(r.canTranscribeFile(), true); assert.equal(r.canDictate(), true);
  assert.equal((await r.transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 1 })).segments[0].text, 'olá');
  assert.equal(await r.dictate([1, 2]), 'ditado de 2');
  assert.equal(seen.length, 1);
  assert.equal(router([], { demoSpeech: true }).router.canTranscribeFile(), false);
});

// ------------------------------------------------------------------------------------------------ the session
test('the session passes audio to the engine only while recording, and waits for the last seconds when stopping', async () => {
  const { repo } = newRepo();
  const fed = []; const order = [];
  const fake = {
    id: 'fake', label: 'Falso', realTranscription: true, needsAudio: true,
    start() {}, pause() {}, resume() {}, stop() { order.push('engine.stop'); },
    feed(c) { fed.push(c); }, drain: async () => { order.push('drain'); },
    writeNotes: async () => ({ title: '', summary: '', blocks: [], extra: [], tasks: [], engine: 'fake' }),
  };
  const session = new Session({ repo, engine: fake, doneLingerMs: 1 });
  session.beforeStop = async () => { order.push('flush'); };
  session.feedAudio({ source: 'mic' });                         // not recording yet
  session.start({ title: 'x' }, 'solo');
  session.feedAudio({ source: 'mic' });
  await session.stop();
  session.feedAudio({ source: 'mic' });                         // already stopped
  assert.equal(fed.length, 1);
  assert.deepEqual(order, ['flush', 'drain', 'engine.stop']);
});

test('a problem reported by the engine shows on the live screen state', () => {
  const { repo } = newRepo();
  let sink;
  const fake = { id: 'f', label: 'F', realTranscription: true, needsAudio: true, start(m, s) { sink = s; }, pause() {}, resume() {}, stop() {} };
  const session = new Session({ repo, engine: fake });
  session.start({ title: 'x' }, 'solo');
  sink.problem({ message: 'Os minutos acabaram.' });
  assert.equal(session.snapshot().error, 'Os minutos acabaram.');
  assert.equal(session.snapshot().engine.needsAudio, true);
});
