// Company sign-in from the app's side, and the narrow door the organisation screens use.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createHandlers } = require('../src/main/handlers');
const { Session } = require('../src/main/session');
const { DemoEngine } = require('../src/main/engine/demo');
const { SecureStore } = require('../src/main/secure');
const { newRepo, tmpDir } = require('./helpers');

function setup(apiOver = {}) {
  const { repo } = newRepo();
  const engine = new DemoEngine({ stepMs: 10 });
  const session = new Session({ repo, engine, doneLingerMs: 10 });
  const secure = new SecureStore(path.join(tmpDir(), 's.bin'), null, { requireEncryption: false });
  const calls = { opened: [], saved: [], requests: [], licenceRefreshed: 0 };
  const licence = { status: () => ({ state: 'ok', plan: 'free', features: [], meetingsPerMonth: 10, canRecord: true }), clear() {}, refresh: async () => { calls.licenceRefreshed += 1; } };
  const api = {
    signedIn: () => true, me: async () => ({ id: 'u1', email: 'rui@empresa.example', name: 'Rui' }),
    request: async (method, p, opts) => { calls.requests.push([method, p, opts]); return opts && opts.binary ? { data: Buffer.from('a,b\r\n') } : { ok: true }; },
    ssoDiscover: async (email) => (email.endsWith('@empresa.example') ? { sso: true, org_id: 'org1', org_name: 'Banco Exemplo' } : { sso: false }),
    ssoStart: async () => ({ url: 'https://login.empresa.example/authorize?x=1', poll_token: 'poll-secret', expires_in: 600 }),
    ssoPoll: async () => ({ status: 'pending' }),
    ...apiOver,
  };
  const services = { openExternal: async (u) => calls.opened.push(u), saveFile: async (n, b) => { calls.saved.push([n, b.toString()]); return { saved: true, name: n }; },
    gpuInfo: async () => ({}), freeDiskBytes: async () => 1e9, writeClipboard: async () => {}, printPdf: async () => Buffer.from('%PDF'), fetchText: async () => '',
    wipeLocal: async () => {}, setTheme() {}, setIsland() {}, applyHotkeys() {}, hotkeyStatus: () => ({}) };
  const h = createHandlers({ repo, session, engine, api, licence, secure, services, version: '0.1.0' });
  return { h, calls, secure };
}

test('company sign-in: the email says which company, the browser opens, and the app keeps only the poll secret', async () => {
  const { h, calls } = setup();
  assert.deepEqual(await h['sso:discover']({ email: 'rui@empresa.example' }), { sso: true, org_id: 'org1', org_name: 'Banco Exemplo' });
  assert.deepEqual(await h['sso:discover']({ email: 'rui@gmail.com' }), { sso: false });
  const started = await h['sso:start']({ orgId: 'org1' });
  assert.deepEqual(calls.opened, ['https://login.empresa.example/authorize?x=1']);
  assert.equal(started.pollToken, 'poll-secret');
});

test('a login address that is not http(s) is never opened', async () => {
  const { h, calls } = setup({ ssoStart: async () => ({ url: 'file:///C:/Windows/System32/calc.exe', poll_token: 'x', expires_in: 600 }) });
  await assert.rejects(() => h['sso:start']({ orgId: 'org1' }), (e) => e.code === 'blocked');
  assert.deepEqual(calls.opened, []);
});

test('polling: pending, done (signed in, licence fetched), failed and expired', async () => {
  const seq = [{ status: 'pending' }];
  const { h, calls, secure } = setup({ ssoPoll: async () => seq[0] });
  assert.deepEqual(await h['sso:poll']({ pollToken: 'p' }), { status: 'pending' });
  seq[0] = { status: 'done', tokens: { access_token: 'a', refresh_token: 'r', expires_in: 900 } };
  const done = await h['sso:poll']({ pollToken: 'p' });
  assert.equal(done.status, 'done'); assert.equal(done.user.email, 'rui@empresa.example');
  assert.deepEqual(secure.get('tokens'), { access_token: 'a', refresh_token: 'r', expires_in: 900 });
  assert.equal(secure.get('user').name, 'Rui'); assert.equal(calls.licenceRefreshed, 1);
});

test('a failed or expired company sign-in is reported with its reason, not thrown', async () => {
  const fail = setup({ ssoPoll: async () => { throw Object.assign(new Error('x'), { code: 'sso_failed', status: 403, details: { reason: 'seats_full' } }); } });
  assert.deepEqual(await fail.h['sso:poll']({ pollToken: 'p' }), { status: 'failed', reason: 'seats_full' });
  const gone = setup({ ssoPoll: async () => { throw Object.assign(new Error('x'), { code: 'sso_expired', status: 410 }); } });
  assert.deepEqual(await gone.h['sso:poll']({ pollToken: 'p' }), { status: 'expired' });
  const down = setup({ ssoPoll: async () => { throw Object.assign(new Error('x'), { code: 'offline', status: 0 }); } });
  await assert.rejects(() => down.h['sso:poll']({ pollToken: 'p' }), (e) => e.code === 'offline');          // the screen keeps polling
});

test('the organisation screens can reach organisation routes and nothing else', async () => {
  const { h, calls } = setup();
  const ok = ['/v1/orgs', '/v1/orgs/abc123', '/v1/orgs/abc123/members', '/v1/orgs/abc123/members/u9', '/v1/orgs/abc123/invites', '/v1/orgs/abc123/invites/i1',
    '/v1/orgs/abc123/policy', '/v1/orgs/abc123/audit', '/v1/orgs/abc123/sso', '/v1/orgs/abc123/sso/test', '/v1/orgs/abc123/scim-token', '/v1/orgs/invites/accept'];
  for (const p of ok) await h['org:call']({ method: p.endsWith('policy') ? 'PUT' : 'GET', path: p, body: {} });
  assert.equal(calls.requests.length, ok.length);
  const bad = ['/v1/me', '/v1/auth/logout-all', '/v1/orgs/../me', '/v1/orgs/abc/../../me', '/v1/orgs/abc123/members/u9/secrets/x', '/v1/orgs/abc123/audit/export', 'https://evil.example/v1/orgs',
    '/v1/orgs?x=1', '/scim/v2/Users', '/v1/admin/overview', '/v1/orgsx'];
  for (const p of bad) await assert.rejects(() => h['org:call']({ path: p }), (e) => e.code === 'blocked', p);
  await assert.rejects(() => h['org:call']({ method: 'TRACE', path: '/v1/orgs' }), (e) => e.code === 'blocked');
  assert.equal(calls.requests.length, ok.length);
});

test('the audit export is saved through the normal save dialog', async () => {
  const { h, calls } = setup();
  const r = await h['org:auditExport']({ orgId: 'org1', format: 'csv' });
  assert.equal(r.saved, true);
  assert.deepEqual(calls.saved, [['ivuenu-auditoria.csv', 'a,b\r\n']]);
  assert.deepEqual(calls.requests[0][2].query, { format: 'csv' });
  await h['org:auditExport']({ orgId: 'org1', format: 'whatever' });
  assert.equal(calls.requests[1][2].query.format, 'csv');                       // only csv or json
});
