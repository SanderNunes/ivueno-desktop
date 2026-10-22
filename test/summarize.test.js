// What a summary is made from, the plain extract used when the server's AI cannot be reached, and how the engines hand summaries out.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/main/engine/summarize');
const { DemoEngine } = require('../src/main/engine/demo');
const { CloudEngine } = require('../src/main/engine/cloud');
const { EngineRouter } = require('../src/main/engine/router');

test('the transcript and the notes become text; notes are the fallback when the transcript was not kept', () => {
  const m = { segments: [{ speakerKey: 'a', text: 'Olá.' }, { speakerKey: 'b', text: 'Bom dia.' }], myNotes: 'minha nota', summary: 'resumo', aiBlocks: [{ mine: 'linha', add: 'extra' }], aiExtra: [{ text: 'mais' }] };
  assert.equal(S.transcriptText(m, (k) => k.toUpperCase()), 'A: Olá.\nB: Bom dia.');
  assert.equal(S.notesText(m), 'minha nota\nresumo\nlinha\nextra\nmais');
  assert.deepEqual(S.STYLES, ['short', 'normal', 'detailed']);
});

test('extractive summaries: notes are trimmed by style, meetings reuse the extractive notes', () => {
  const text = Array.from({ length: 20 }, (_, i) => `- linha ${i}`).join('\n');
  assert.equal(S.extractiveSummary({ scope: 'notes', text, style: 'short' }).split('\n').length, 3);
  assert.equal(S.extractiveSummary({ scope: 'notes', text, style: 'normal' }).split('\n').length, 6);
  assert.equal(S.extractiveSummary({ scope: 'notes', text, style: 'detailed' }).split('\n').length, 12);
  assert.equal(S.extractiveSummary({ scope: 'notes', text: '- um' }), 'um');
  assert.equal(S.extractiveSummary({ scope: 'notes', text: `- ${'x'.repeat(300)}` }).length, 198);                // a long line is cut
  const meeting = { segments: [{ speakerKey: 'a', startMs: 0, text: 'Eu envio a lista de preços até sexta-feira.' }, { speakerKey: 'b', startMs: 5000, text: 'Vamos subir os preços em janeiro.' }], myNotes: '', aiBlocks: [], aiExtra: [], speakers: {}, attendees: [], template: 'auto', title: '' };
  assert.ok(S.extractiveSummary({ scope: 'meeting', text: '', style: 'normal', meeting, nameOf: (k) => k }).length > 10);
});

test('the plain engine answers summaries with an extract, labelled as such', async () => {
  const out = await new DemoEngine({ stepMs: 10 }).summarize({ scope: 'notes', text: '- um\n- dois\n- três', style: 'short' }, (k) => k);
  assert.deepEqual([out.engine, out.text], ['extractive', 'um\ndois\ntrês']);
});

test('the cloud engine asks the server for the summary in its own format', async () => {
  const sent = [];
  const cloud = new CloudEngine({ api: { cloudSummarize: async (b) => { sent.push(b); return { text: 'Resumo da nuvem' }; } }, getSettings: () => ({}), fallback: null });
  const out = await cloud.summarize({ scope: 'notes', title: 'T', text: 'x', style: 'short', language: 'en', meeting: { redact: false } });
  assert.deepEqual(out, { text: 'Resumo da nuvem', engine: 'cloud' });
  assert.deepEqual(sent[0], { scope: 'notes', title: 'T', text: 'x', style: 'short', language: 'en', redact: false });
  await cloud.summarize({ scope: 'meeting', text: 'y', style: 'normal', language: 'xx', meeting: {} });
  assert.deepEqual([sent[1].language, sent[1].redact], ['pt', true]);                                                  // anything but English is Portuguese; masking is on unless switched off
});

test('the router: the server first when the plan has it; if it fails, the person still gets an extract', async () => {
  const demo = new DemoEngine({ stepMs: 10 });
  const mk = (summarize, features = ['cloud_notes']) => new EngineRouter({ cloud: { summarize }, demo, hasFeature: (f) => features.includes(f) });
  const req = { scope: 'notes', text: '- a\n- b', style: 'short' };
  assert.equal((await mk(async () => ({ text: 'da nuvem', engine: 'cloud' })).summarize(req, (k) => k)).text, 'da nuvem');
  assert.equal((await mk(async () => { throw Object.assign(new Error('x'), { code: 'offline' }); }).summarize(req, (k) => k)).engine, 'extractive');
  assert.equal((await mk(async () => ({ text: 'da nuvem' }), []).summarize(req, (k) => k)).engine, 'extractive');       // the plan has no cloud notes
});
