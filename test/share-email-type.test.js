// Follow-up email, sharing as a file + email, export options, and the detected kind of meeting: handlers, engines, router and session.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createHandlers } = require('../src/main/handlers');
const { Session } = require('../src/main/session');
const { DemoEngine } = require('../src/main/engine/demo');
const { CloudEngine } = require('../src/main/engine/cloud');
const { EngineRouter } = require('../src/main/engine/router');
const exporter = require('../src/main/export');
const { SecureStore } = require('../src/main/secure');
const { newRepo, tmpDir } = require('./helpers');

function setup({ engine, api, user = { name: 'Ana Silva', email: 'ana@exemplo.ao' }, saveResult } = {}) {
  const { repo } = newRepo();
  const demo = new DemoEngine({ stepMs: 10 });
  const session = new Session({ repo, engine: demo, doneLingerMs: 10 });
  const secure = new SecureStore(path.join(tmpDir(), 's.bin'), null, { requireEncryption: false });
  secure.set('user', user);
  const calls = { opened: [], clip: [], saved: [], revealed: [], pdf: [] };
  const licence = { status: () => ({ state: 'ok', plan: 'pro', features: [], meetingsPerMonth: null, canRecord: true }), clear() {}, refresh: async () => {} };
  const services = {
    openExternal: async (u) => calls.opened.push(u), writeClipboard: async (t) => calls.clip.push(t),
    saveFile: async (name, data, filters) => { calls.saved.push({ name, data, filters }); return saveResult || { saved: true, name, path: `C:\\Docs\\${name}` }; },
    revealFile: (p) => calls.revealed.push(p), printPdf: async (html, opts) => { calls.pdf.push({ html, opts }); return Buffer.from('%PDF-fake'); },
    gpuInfo: async () => ({}), freeDiskBytes: async () => 1e9, fetchText: async () => '', wipeLocal: async () => {}, setTheme() {}, setIsland() {}, applyHotkeys() {}, hotkeyStatus: () => ({}),
  };
  const eng = engine || { draftEmail: async (req) => ({ subject: 'Assunto', body: 'Corpo', engine: 'template', _req: req }), detectType: async () => ({ key: 'sales', confidence: 0.8, by: 'rules' }) };
  const h = createHandlers({ repo, session, engine: eng, api: api || { signedIn: () => false }, licence, secure, services, version: '0.1.0' });
  return { h, repo, session, calls };
}

function meetingWithNotes(repo, over = {}) {
  const m = repo.createMeeting({ title: 'Preços', status: 'done', attendees: [{ name: 'Rui Costa', email: 'rui@x.pt' }, { name: 'Maria', email: 'maria@y.ao' }, { name: 'Sem email', email: '' }] });
  repo.setMyNotes(m.id, 'subir os preços\nfalar com o suporte');
  repo.addSegments(m.id, [{ clientId: 'a', speakerKey: 'spk_2', text: 'Vamos subir os preços 5% em janeiro.', startMs: 0 }]);
  repo.setGenerated(m.id, { summary: 'Vão subir os preços 5%.', blocks: [{ mine: 'subir os preços', add: 'cinco por cento' }], extra: [], tasks: [{ text: 'Enviar a lista', owner: 'Ana', due: 'sexta-feira' }], engine: 'demo' });
  if (Object.keys(over).length) repo.updateMeeting(m.id, over);
  return m.id;
}

// ------------------------------------------------------------------------------------------------ export options
test('what goes into the file is the person\'s choice; by default everything except the transcript', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo);
  await s.h['export:run']({ id, format: 'copy' });
  assert.match(s.calls.clip[0], /Resumo/); assert.match(s.calls.clip[0], /As tuas notas/); assert.match(s.calls.clip[0], /Tarefas/); assert.doesNotMatch(s.calls.clip[0], /Transcrição/);
  await s.h['export:run']({ id, format: 'copy', include: { summary: false, mine: false, ai: false, transcript: true } });
  const only = s.calls.clip[1];
  assert.doesNotMatch(only, /Resumo|As tuas notas|Notas da Ivuenu/); assert.match(only, /Tarefas/); assert.match(only, /Transcrição/);
  await s.h['export:run']({ id, format: 'copy', includeTranscript: true });                  // the old flag still works
  assert.match(s.calls.clip[2], /Transcrição/);
  await s.h['export:run']({ id, format: 'copy', include: { summary: 'yes', tasks: 0 } });    // only real booleans count
  assert.match(s.calls.clip[3], /Resumo/); assert.match(s.calls.clip[3], /Tarefas/);
});

test('PDF: paper size and the brand line; Word and Markdown are saved through the save dialog', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo);
  await s.h['export:run']({ id, format: 'pdf', paper: 'Letter', brand: true });
  assert.equal(s.calls.pdf[0].opts.paper, 'Letter'); assert.match(s.calls.pdf[0].html, /Notas criadas com a Ivuenu/);
  await s.h['export:run']({ id, format: 'pdf', paper: 'whatever' });
  assert.equal(s.calls.pdf[1].opts.paper, 'A4'); assert.doesNotMatch(s.calls.pdf[1].html, /Notas criadas com a Ivuenu/);
  await s.h['export:run']({ id, format: 'md' });
  assert.equal(s.calls.saved.at(-1).name, 'Preços.md'); assert.match(s.calls.saved.at(-1).data.toString(), /# Preços/);
  await s.h['export:run']({ id, format: 'docx' });
  assert.equal(s.calls.saved.at(-1).name, 'Preços.docx');
  await assert.rejects(() => s.h['export:run']({ id, format: 'exe' }), (e) => e.code === 'invalid');
});

test('the email text is short: title, summary and open tasks, never the notes or transcript', () => {
  const { repo } = newRepo(); const m = repo.getMeeting(meetingWithNotes(repo));
  const text = exporter.toEmailText(m, { nameOf: (k) => k, include: {} });
  assert.match(text, /Preços/); assert.match(text, /Vão subir os preços 5%/); assert.match(text, /Enviar a lista/);
  assert.doesNotMatch(text, /As tuas notas|Notas da Ivuenu|Transcrição/);
  assert.doesNotMatch(exporter.toEmailText(m, { nameOf: (k) => k, include: { tasks: false } }), /Enviar a lista/);
});

// ------------------------------------------------------------------------------------------------ the email draft
test('the draft is asked for with the sender, the people, the tone, and comes back with the recipients\' addresses', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo);
  const out = await s.h['meetings:draftEmail']({ id, tone: 'formal', language: 'en', includeTasks: false });
  assert.deepEqual([out.subject, out.body], ['Assunto', 'Corpo']);
  assert.deepEqual(out.to, ['rui@x.pt', 'maria@y.ao']);                                    // only attendees that have an address
  const req = out._req;
  assert.deepEqual([req.tone, req.language, req.includeTasks, req.senderName], ['formal', 'en', false, 'Ana Silva']);
  assert.deepEqual(req.attendeeNames, ['Rui Costa', 'Maria', 'Sem email']);
  const odd = await s.h['meetings:draftEmail']({ id, tone: 'rude', language: 'klingon' });
  assert.deepEqual([odd._req.tone, odd._req.language, odd._req.includeTasks], ['friendly', 'auto', true]);
});

test('no notes and no transcript: nothing to write an email from; a transcript alone is enough', async () => {
  const s = setup();
  const empty = s.repo.createMeeting({ title: 'Vazia', status: 'done' });
  await assert.rejects(() => s.h['meetings:draftEmail']({ id: empty.id }), (e) => e.code === 'nothing_to_write');
  await assert.rejects(() => s.h['meetings:draftEmail']({ id: 'nope' }), (e) => e.code === 'not_found');
  const t = s.repo.createMeeting({ title: 'Só áudio', status: 'done' });
  s.repo.addSegments(t.id, [{ clientId: 'a', speakerKey: 'spk_2', text: 'Olá a todos.', startMs: 0 }]);
  assert.equal((await s.h['meetings:draftEmail']({ id: t.id })).subject, 'Assunto');
});

test('open in email: the mailto carries the text; a long text is cut and the whole of it goes to the clipboard', async () => {
  const s = setup();
  const short = await s.h['mail:open']({ to: ['rui@x.pt'], subject: 'Olá', body: 'Corpo curto' });
  assert.deepEqual([short.opened, short.truncated], [true, false]); assert.ok(s.calls.opened[0].startsWith('mailto:rui@x.pt?subject=Ol'));
  assert.deepEqual(s.calls.clip, []);
  const long = Array.from({ length: 500 }, (_, i) => `palavra${i}`).join(' ');
  const cut = await s.h['mail:open']({ to: 'rui@x.pt', subject: 'x', body: long });
  assert.equal(cut.truncated, true); assert.equal(s.calls.clip[0], long); assert.ok(s.calls.opened[1].length <= 1800);
});

// ------------------------------------------------------------------------------------------------ sharing
test('who to share with: the meeting\'s people first, then the team, without the person themselves or duplicates', async () => {
  const api = {
    signedIn: () => true,
    request: async (m, p) => (p === '/v1/orgs' ? [{ id: 'o1', name: 'Banco' }] : [{ name: 'Ana Silva', email: 'ANA@exemplo.ao' }, { name: 'Rui C.', email: 'rui@x.pt' }, { name: 'Carla', email: 'carla@banco.ao' }]),
  };
  const s = setup({ api }); const id = meetingWithNotes(s.repo);
  const people = await s.h['share:suggest']({ id });
  assert.deepEqual(people.map((p) => [p.email, p.source]), [['rui@x.pt', 'meeting'], ['maria@y.ao', 'meeting'], ['carla@banco.ao', 'team']]);
  assert.equal(people[2].org, 'Banco');
});

test('offline or signed out: the meeting\'s people are still suggested', async () => {
  const offline = setup({ api: { signedIn: () => true, request: async () => { throw Object.assign(new Error('x'), { code: 'offline' }); } } });
  assert.equal((await offline.h['share:suggest']({ id: meetingWithNotes(offline.repo) })).length, 2);
  const out = setup(); assert.equal((await out.h['share:suggest']({ id: meetingWithNotes(out.repo) })).length, 2);
});

test('share: the file is saved, the email opens for the valid recipients with the text and the file name, and the file is shown', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo);
  const r = await s.h['share:send']({ id, format: 'pdf', paper: 'Letter', to: ['rui@x.pt', 'not-valid', 'maria@y.ao'], subject: 'Notas de hoje', message: 'Olá,\nSegue o resumo.' });
  assert.deepEqual([r.saved, r.name, r.mailOpened, r.truncated], [true, 'Preços.pdf', true, false]);
  assert.deepEqual(r.invalid, ['not-valid']);
  assert.equal(s.calls.saved[0].name, 'Preços.pdf'); assert.equal(s.calls.pdf[0].opts.paper, 'Letter');
  const url = s.calls.opened[0]; const body = decodeURIComponent(url.split('body=')[1]);
  assert.ok(url.startsWith('mailto:rui@x.pt,maria@y.ao?subject=Notas%20de%20hoje'));
  assert.match(body, /Segue o resumo\./); assert.match(body, /Em anexo: Preços\.pdf/); assert.match(body, /Vão subir os preços 5%/);
  assert.deepEqual(s.calls.revealed, ['C:\\Docs\\Preços.pdf']);
});

test('share: Word and Markdown work too, the choice of content is respected, and the subject defaults to the title', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo);
  await s.h['share:send']({ id, format: 'md', include: { mine: false, ai: false, tasks: false, transcript: false }, to: 'rui@x.pt' });
  const md = s.calls.saved[0].data.toString();
  assert.match(md, /## Resumo/); assert.doesNotMatch(md, /As tuas notas|Tarefas/);
  assert.match(s.calls.opened[0], /subject=Pre%C3%A7os/);
  await s.h['share:send']({ id, format: 'docx', openMail: false });
  assert.equal(s.calls.saved[1].name, 'Preços.docx'); assert.equal(s.calls.opened.length, 1);                  // openMail:false -> no email
});

test('share: cancelling the save dialog stops everything; nothing selected or an unknown format is refused', async () => {
  const s = setup({ saveResult: { saved: false } }); const id = meetingWithNotes(s.repo);
  assert.deepEqual(await s.h['share:send']({ id, to: 'rui@x.pt' }), { saved: false });
  assert.deepEqual([s.calls.opened.length, s.calls.revealed.length], [0, 0]);
  const t = setup(); const id2 = meetingWithNotes(t.repo);
  await assert.rejects(() => t.h['share:send']({ id: id2, include: { summary: false, mine: false, ai: false, tasks: false, transcript: false } }), (e) => e.code === 'invalid' && /pelo menos/.test(e.message));
  await assert.rejects(() => t.h['share:send']({ id: id2, format: 'exe' }), (e) => e.code === 'invalid');
  await assert.rejects(() => t.h['share:send']({ id: 'nope' }), (e) => e.code === 'not_found');
  assert.equal(t.calls.saved.length, 0);
});

test('share: a very long message is cut for the email but the file is complete', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo);
  const r = await s.h['share:send']({ id, to: 'rui@x.pt', message: Array.from({ length: 600 }, (_, i) => `palavra${i}`).join(' ') });
  assert.equal(r.truncated, true); assert.ok(s.calls.opened[0].length <= 1800); assert.equal(r.saved, true);
});

// ------------------------------------------------------------------------------------------------ the detected kind of meeting
test('the detection can be run again by hand and is stored beside the person\'s choice', async () => {
  const s = setup(); const id = meetingWithNotes(s.repo, { template: 'standup' });
  const v = await s.h['meetings:detectType']({ id });
  assert.deepEqual(v.templateDetected, { key: 'sales', confidence: 0.8, by: 'rules' }); assert.equal(v.template, 'standup');       // the choice is untouched
  await assert.rejects(() => s.h['meetings:detectType']({ id: 'nope' }), (e) => e.code === 'not_found');
});

test('after a meeting the kind is detected once, before the notes; a rewrite does not detect again', async () => {
  const { repo } = newRepo();
  let detections = 0; const seenTemplates = [];
  const engine = new DemoEngine({ stepMs: 10 });
  engine.detectType = async () => { detections += 1; return { key: 'interview', confidence: 0.9, by: 'rules' }; };
  const realWrite = engine.writeNotes.bind(engine);
  engine.writeNotes = async (m, nameOf) => { seenTemplates.push(m.templateDetected && m.templateDetected.key); return realWrite(m, nameOf); };
  const session = new Session({ repo, engine, doneLingerMs: 10 });
  const m = repo.createMeeting({ title: 'Entrevista', status: 'processing' });
  repo.addSegments(m.id, [{ clientId: 'a', speakerKey: 'spk_2', text: 'Fala-me da tua experiência.', startMs: 0 }]);
  await session.generateNotes(m.id);
  assert.deepEqual(repo.getMeeting(m.id).templateDetected, { key: 'interview', confidence: 0.9, by: 'rules' });
  assert.deepEqual(seenTemplates, ['interview']);                                           // known by the time the notes are written
  await session.generateNotes(m.id);
  assert.equal(detections, 1);
});

test('a detector that fails, or a meeting with nothing to read, never holds up the notes', async () => {
  const { repo } = newRepo();
  const engine = new DemoEngine({ stepMs: 10 });
  engine.detectType = async () => { throw new Error('boom'); };
  const session = new Session({ repo, engine, doneLingerMs: 10 });
  const m = repo.createMeeting({ title: 'x', status: 'processing' });
  repo.addSegments(m.id, [{ clientId: 'a', speakerKey: 'spk_2', text: 'Bom dia a todos.', startMs: 0 }]);
  await session.generateNotes(m.id);
  const done = repo.getMeeting(m.id);
  assert.equal(done.notesState, 'ready'); assert.equal(done.templateDetected, null);
  const empty = repo.createMeeting({ title: 'vazia', status: 'processing' });
  let asked = false; engine.detectType = async () => { asked = true; return { key: 'general' }; };
  await session.generateNotes(empty.id);
  assert.equal(asked, false);
});

// ------------------------------------------------------------------------------------------------ the plain engine (the fallback)
const demo = new DemoEngine({ stepMs: 10 });
const mat = () => { const { repo } = newRepo(); return repo.getMeeting(meetingWithNotes(repo)); };

// ------------------------------------------------------------------------------------------------ the cloud engine
function cloud(api) { return new CloudEngine({ api, getSettings: () => ({ language: 'auto' }), fallback: demo, retryMs: [1, 1] }); }

test('cloud: summaries, email and kind of meeting go to the server\'s endpoints in their own format', async () => {
  const sent = {};
  const e = cloud({
    cloudSummarize: async (b) => { sent.sum = b; return { text: 'Resumo da nuvem' }; },
    cloudEmail: async (b) => { sent.mail = b; return { subject: 'S', body: 'B' }; },
    cloudClassify: async (b) => { sent.cls = b; return { type: 'sales_call', confidence: 0.9 }; },
  });
  const m = { ...mat(), redact: false };
  assert.deepEqual(await e.summarize({ scope: 'notes', title: 'T', text: 'x', style: 'short', language: 'en', meeting: m }), { text: 'Resumo da nuvem', engine: 'cloud' });
  assert.deepEqual(sent.sum, { scope: 'notes', title: 'T', text: 'x', style: 'short', language: 'en', redact: false });
  const mail = await e.draftEmail({ meeting: m, tone: 'direct', language: 'pt', includeTasks: true, senderName: 'Ana', attendeeNames: ['Rui'] });
  assert.deepEqual([mail.subject, mail.body, mail.engine], ['S', 'B', 'cloud']);
  assert.deepEqual([sent.mail.tone, sent.mail.sender_name, sent.mail.include_tasks, sent.mail.redact, sent.mail.attendees], ['direct', 'Ana', true, false, ['Rui']]);
  assert.deepEqual(sent.mail.tasks, [{ text: 'Enviar a lista', owner: 'Ana', due: 'sexta-feira' }]);
  assert.match(sent.mail.notes, /subir os preços/); assert.equal(sent.mail.summary, 'Vão subir os preços 5%.');
  const kind = await e.detectType(m, (k) => k);
  assert.deepEqual(kind, { key: 'sales', confidence: 0.9, by: 'cloud' });                    // the server's name is turned into the app's
  assert.equal(sent.cls.redact, false); assert.match(sent.cls.text, /Vamos subir os preços/);
});

test('cloud: an email from nothing is refused locally, without a request', async () => {
  let asked = false;
  const e = cloud({ cloudEmail: async () => { asked = true; return {}; } });
  await assert.rejects(() => e.draftEmail({ meeting: { title: 'x', summary: '', myNotes: '', aiBlocks: [], tasks: [] }, tone: 'friendly', language: 'auto', includeTasks: true, senderName: '', attendeeNames: [] }), (err) => err.code === 'nothing_to_write');
  assert.equal(asked, false);
});

test('cloud notes are written for the meeting\'s effective kind, under the server\'s names', async () => {
  const seen = [];
  const e = cloud({ cloudNotes: async (b) => { seen.push(b.template); return { title: '', summary: '', notes_markdown: '', action_items: [] }; } });
  const base = { ...mat(), template: 'auto' };
  await e.writeNotes({ ...base, templateDetected: { key: 'sales' } }, (k) => k);
  await e.writeNotes({ ...base, template: 'one_to_one', templateDetected: { key: 'sales' } }, (k) => k);        // the person's choice wins
  await e.writeNotes({ ...base, templateDetected: null }, (k) => k);
  await e.writeNotes({ ...base, template: 'standup' }, (k) => k);
  assert.deepEqual(seen, ['sales_call', 'one_on_one', 'auto', 'standup']);
});

// ------------------------------------------------------------------------------------------------ the router
test('the router: the server first when the plan has it, the plain engine when the server fails or the plan lacks it', async () => {
  const good = { draftEmail: async () => ({ subject: 'nuvem', body: 'b', engine: 'cloud' }), detectType: async () => ({ key: 'sales', confidence: 1, by: 'cloud' }) };
  const bad = { draftEmail: async () => { throw new Error('offline'); }, detectType: async () => { throw new Error('offline'); } };
  const mk = (cl, feature = true) => new EngineRouter({ cloud: cl, demo, hasFeature: () => feature });
  const req = { meeting: mat(), tone: 'friendly', language: 'pt', includeTasks: true, senderName: 'Ana', attendeeNames: [] };
  assert.equal((await mk(good).draftEmail(req, (k) => k)).subject, 'nuvem');
  assert.equal((await mk(good).detectType(mat(), (k) => k)).by, 'cloud');
  assert.equal((await mk(bad).draftEmail(req, (k) => k)).engine, 'template');
  assert.equal((await mk(bad).detectType(mat(), (k) => k)).by, 'rules');
  assert.equal((await mk(good, false).draftEmail(req, (k) => k)).engine, 'template');             // the plan has no cloud notes
});
