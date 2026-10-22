const test = require('node:test');
const assert = require('node:assert/strict');
const { Dictation } = require('../src/main/dictation');

const mk = (over = {}, engine = { realTranscription: false }) =>
  new Dictation({ engine, getSettings: () => ({ dictation: true, hotkeyDictation: 'Control+Space', ...over }), noticeMs: 10 });

test('the hotkey starts and then stops listening', () => {
  const d = mk();
  assert.equal(d.toggle().phase, 'listening');
  assert.equal(d.toggle().phase, 'unavailable');
});

test('without a real engine it says so, then goes back to idle', async () => {
  const d = mk();
  d.toggle(); d.toggle();
  assert.match(d.snapshot().message, /não está disponível/);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(d.phase, 'idle');
});

test('when dictation is switched off the hotkey does nothing', () => {
  const d = mk({ dictation: false });
  assert.equal(d.toggle().phase, 'idle');
});

test('cancel returns to idle at once and every change is announced', () => {
  const d = mk(); const seen = [];
  d.on('state', (s) => seen.push(s.phase));
  d.toggle(); d.cancel();
  assert.deepEqual(seen, ['listening', 'idle']);
});
