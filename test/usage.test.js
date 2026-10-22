const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { UsageReporter } = require('../src/main/usage');
const { SecureStore } = require('../src/main/secure');
const { tmpDir } = require('./helpers');

function setup(api) {
  const secure = new SecureStore(path.join(tmpDir(), 's.bin'), null, { requireEncryption: false });
  const now = () => new Date('2026-10-20T10:00:00Z');
  return { secure, usage: new UsageReporter({ api, secure, now }) };
}

const offline = () => Object.assign(new Error('offline'), { code: 'offline', status: 0 });

test('a reported meeting is sent once and the server count is remembered', async () => {
  const sent = [];
  const { usage, secure } = setup({ reportMeeting: async (i) => { sent.push(i.client_id); return { used: 4 }; } });
  await usage.report({ id: 'mtg_1', startedAt: '2026-10-20T09:00:00Z' });
  assert.deepEqual(sent, ['mtg_1']);
  assert.deepEqual(usage.pending(), []);
  assert.equal(usage.serverUsed(), 4);
  assert.ok(secure.get('serverUsage'));
});

test('offline: the report waits in the queue and is replayed later, once', async () => {
  let up = false; const sent = [];
  const { usage } = setup({ reportMeeting: async (i) => { if (!up) throw offline(); sent.push(i.client_id); return { used: sent.length }; } });
  await usage.report({ id: 'mtg_1', startedAt: '2026-10-20T09:00:00Z' });
  await usage.report({ id: 'mtg_2', startedAt: '2026-10-20T09:30:00Z' });
  assert.deepEqual(usage.pending().map((q) => q.client_id), ['mtg_1', 'mtg_2']);
  assert.equal(usage.serverUsed(), 0);
  up = true;
  await usage.flush();
  assert.deepEqual(sent, ['mtg_1', 'mtg_2']);
  assert.deepEqual(usage.pending(), []);
  await usage.flush();
  assert.equal(sent.length, 2, 'nothing is sent twice');
});

test('a refusal for good drops the item; a server error keeps it', async () => {
  let mode = 'bad';
  const { usage } = setup({ reportMeeting: async () => { throw Object.assign(new Error('x'), { status: mode === 'bad' ? 422 : 503, code: 'e' }); } });
  await usage.report({ id: 'mtg_1', startedAt: '2026-10-20T09:00:00Z' });
  assert.deepEqual(usage.pending(), []);
  mode = 'down';
  await usage.report({ id: 'mtg_2', startedAt: '2026-10-20T09:00:00Z' });
  assert.equal(usage.pending().length, 1);
});

test('the server count from an earlier month is ignored', () => {
  const { usage, secure } = setup({});
  secure.set('serverUsage', { month: '2026-09', used: 10 });
  assert.equal(usage.serverUsed(), 0);
});
