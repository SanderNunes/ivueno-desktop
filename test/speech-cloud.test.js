// Speech in the cloud: WAV wrapping, transcribing a whole recording or a piece, dictation, and what the person is told when it fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pcm16ToWav } = require('../src/main/wav');
const { CloudEngine } = require('../src/main/engine/cloud');
const { Dictation } = require('../src/main/dictation');

const err = (code, status = 400) => Object.assign(new Error(code), { code, status });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('PCM becomes a proper WAV: header fields, sizes and the samples untouched', () => {
  const pcm = Buffer.alloc(8); pcm.writeInt16LE(1000, 0); pcm.writeInt16LE(-2000, 2); pcm.writeInt16LE(32767, 4); pcm.writeInt16LE(-32768, 6);
  const wav = pcm16ToWav(pcm);
  assert.equal(wav.length, 52);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(4), 44); assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.deepEqual([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt32LE(28), wav.readUInt16LE(32), wav.readUInt16LE(34)], [1, 1, 16000, 32000, 2, 16]);
  assert.equal(wav.toString('ascii', 36, 40), 'data'); assert.equal(wav.readUInt32LE(40), 8);
  assert.deepEqual([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48), wav.readInt16LE(50)], [1000, -2000, 32767, -32768]);
  assert.equal(pcm16ToWav(new Int16Array([5, 6])).readInt16LE(46), 6);                                  // typed arrays too
  assert.equal(pcm16ToWav(new Uint8Array([1, 0, 2, 0]).buffer).readInt16LE(46), 2);                      // and a bare ArrayBuffer
  assert.equal(pcm16ToWav(pcm, 8000).readUInt32LE(24), 8000);
});

function engine(api, settings = { language: 'auto' }) {
  return new CloudEngine({ api, getSettings: () => settings, fallback: null, retryMs: [1, 1] });
}

test('a recording is sent as it is, with its length, the language (auto means: let the server detect) and the vocabulary', async () => {
  const sent = [];
  const e = engine({ cloudTranscribe: async (...a) => { sent.push(a); return { segments: [{ start_ms: 0, end_ms: 1000, text: 'olá' }] }; } }, { language: 'pt' });
  const out = await e.transcribeAudio({ data: new Uint8Array([1, 2, 3]).buffer, mime: 'video/mp4', seconds: 2694.4, prompt: 'kwanzas' });
  assert.equal(out.segments[0].text, 'olá');
  assert.equal(Buffer.isBuffer(sent[0][0]), true); assert.deepEqual([...sent[0][0]], [1, 2, 3]);
  assert.deepEqual(sent[0].slice(1), ['video/mp4', 2694.4, 'pt', 'kwanzas']);
  await e.transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 3, language: 'en' });
  assert.equal(sent[1][3], 'en');                                                                         // the caller's language wins over the setting
  await engine({ cloudTranscribe: async (...a) => { sent.push(a); return { segments: [] }; } }, { language: 'auto' }).transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 3 });
  assert.equal(sent[2][3], undefined);
});

test('a bad moment on the network is retried; refusals that retrying cannot fix are thrown at once', async () => {
  let calls = 0;
  const flaky = engine({ cloudTranscribe: async () => { calls += 1; if (calls < 3) throw err('offline', 0); return { segments: [{ text: 'ok' }] }; } });
  assert.equal((await flaky.transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 1 })).segments[0].text, 'ok'); assert.equal(calls, 3);
  for (const code of ['plan_required', 'cloud_minutes_exhausted', 'cloud_disabled_by_policy']) {
    let n = 0;
    await assert.rejects(() => engine({ cloudTranscribe: async () => { n += 1; throw err(code, 402); } }).transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 1 }), (e) => e.code === code);
    assert.equal(n, 1, code);
  }
  for (const status of [401, 413, 422]) {
    let n = 0;
    await assert.rejects(() => engine({ cloudTranscribe: async () => { n += 1; throw err('x', status); } }).transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 1 }));
    assert.equal(n, 1, String(status));
  }
  let tries = 0;
  await assert.rejects(() => engine({ cloudTranscribe: async () => { tries += 1; throw err('offline', 0); } }).transcribeAudio({ data: Buffer.from('x'), mime: 'audio/wav', seconds: 1 }), (e) => e.code === 'offline');
  assert.equal(tries, 3);                                                                                 // gives up after three tries
});

test('dictation: each piece goes up as a WAV, empty answers are skipped and the texts are joined', async () => {
  const sent = [];
  const answers = [[{ text: 'Bom dia' }, { text: 'a todos.' }], [], [{ text: 'Vamos começar.' }]];
  const e = engine({ cloudTranscribe: async (buf, mime, seconds) => { sent.push({ buf, mime, seconds }); return { segments: answers.shift() }; } });
  const piece = (n) => ({ data: Buffer.alloc(n * 2) });
  const text = await e.dictate([piece(16000), { data: new Int16Array(1000) }, { data: new Uint8Array(32000).buffer }]);
  assert.equal(text, 'Bom dia a todos. Vamos começar.');
  assert.deepEqual(sent.map((s) => [s.mime, s.seconds, s.buf.toString('ascii', 0, 4), s.buf.length]), [['audio/wav', 1, 'RIFF', 32044], ['audio/wav', 0.3, 'RIFF', 2044], ['audio/wav', 1, 'RIFF', 32044]]);
  assert.equal(await engine({ cloudTranscribe: async () => ({ segments: [] }) }).dictate([piece(100)]), '');
});

function dictation(engine) {
  return new Dictation({ engine, getSettings: () => ({ dictation: true, hotkeyDictation: 'Control+Space' }), noticeMs: 300, audioWaitMs: 100, settleMs: 10, insertText: async () => {} });
}

test('dictation tells the person why the speech service failed, in words they can act on', async () => {
  const cases = {
    offline: /ligação à internet/, plan_required: /plano com transcrição/, cloud_minutes_exhausted: /minutos de transcrição/, cloud_disabled_by_policy: /empresa/, weird_code: /ditado falhou/,
  };
  for (const [code, pattern] of Object.entries(cases)) {
    const d = dictation({ realTranscription: true, canDictate: () => true, dictate: async () => { throw err(code); } });
    d.toggle(); d.receiveAudio({ data: Buffer.alloc(100) }); d.toggle(); await wait(150);
    assert.equal(d.phase, 'unavailable', code); assert.match(d.message, pattern, code);
  }
});

test('the speech service is given the people of the meeting and the local terms, for imports and for live pieces alike', async () => {
  const { vocabularyPrompt } = require('../src/main/engine/vocab');
  assert.equal(vocabularyPrompt({ attendees: [{ name: 'Rui Costa' }, { name: ' ' }, { name: 'Maria Lopes' }] }), 'Rui Costa, Maria Lopes, kwanzas, Multicaixa Express, Unitel, Africell, Luanda');
  assert.equal(vocabularyPrompt({}), 'kwanzas, Multicaixa Express, Unitel, Africell, Luanda');
  assert.equal(vocabularyPrompt(null), 'kwanzas, Multicaixa Express, Unitel, Africell, Luanda');
  assert.ok(vocabularyPrompt({ attendees: Array.from({ length: 80 }, (_, i) => ({ name: `Pessoa Número ${i}` })) }).length <= 380);
  const sent = [];
  const e = engine({ cloudTranscribe: async (...a) => { sent.push(a); return { segments: [{ start_ms: 0, end_ms: 1000, text: 'olá' }] }; } }, { language: 'pt' });
  e.start({ id: 'm1', attendees: [{ name: 'Rui Costa' }] }, { final() {}, problem() {} }, () => 30000);
  await e.feed({ source: 'mic', mime: 'audio/webm', seconds: 8, data: new Uint8Array([1, 2]).buffer });
  assert.equal(sent[0][4], 'Rui Costa, kwanzas, Multicaixa Express, Unitel, Africell, Luanda');
});
