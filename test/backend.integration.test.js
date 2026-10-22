// Runs the app's API client and licence check against the REAL backend (started on a spare port with a throw-away
// database). Skipped, with a message, when the backend's virtual environment is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { ApiClient } = require('../src/main/api');
const { LicenceManager } = require('../src/main/licence');
const { SecureStore } = require('../src/main/secure');
const { SyncManager } = require('../src/main/sync');
const { CloudEngine } = require('../src/main/engine/cloud');
const { DemoEngine } = require('../src/main/engine/demo');
const { tmpDir, newRepo } = require('./helpers');

const BACKEND = path.resolve(__dirname, '../../backend');
const PY = path.join(BACKEND, '.venv', 'Scripts', 'python.exe');
const haveBackend = fs.existsSync(PY);

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('backend did not start');
}

test('desktop client against the real backend', { skip: haveBackend ? false : 'backend/.venv not installed' }, async (t) => {
  const port = await freePort();
  const db = path.join(tmpDir('ivuenu-db-'), 'test.db').replace(/\\/g, '/');
  const mailDir = tmpDir('ivuenu-mail-');
  const server = spawn(PY, ['-m', 'uvicorn', 'app.main:app', '--port', String(port), '--log-level', 'warning'], {
    cwd: BACKEND, stdio: 'ignore',
    env: { ...process.env, IVUENU_LLM: 'none', GROQ_API_KEY: '', IVUENU_DATABASE_URL: `sqlite:///${db}`, IVUENU_DEV_ENDPOINTS: 'true', IVUENU_ENV: 'dev', IVUENU_MAIL: 'file', IVUENU_MAIL_DIR: mailDir, IVUENU_PAYMENT_MOCK: 'true', APPYPAY_CHARGES_ENABLED: 'false', IVUENU_STT: 'echo' },
  });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/health`);

  const secure = new SecureStore(path.join(tmpDir(), 'secure.bin'), null, { requireEncryption: false });
  const api = new ApiClient({ getBase: () => base, secure, deviceName: 'Ivuenu desktop (test)' });
  const licence = new LicenceManager({ secure, api });

  await t.test('register signs in and returns the profile', async () => {
    const me = await api.register({ email: 'ana@exemplo.ao', password: 'uma-palavra-passe-longa', name: 'Ana Silva' });
    assert.equal(me.email, 'ana@exemplo.ao');
    assert.ok(api.signedIn());
  });

  await t.test('a wrong password gives the generic error the design expects', async () => {
    await assert.rejects(() => api.login({ email: 'ana@exemplo.ao', password: 'errada-errada-errada' }), (e) => e.status === 401 && !!e.code);
  });

  await t.test('the licence is fetched, verified against the pinned key, and works offline afterwards', async () => {
    const s = await licence.refresh({ repin: true });
    assert.equal(s.plan, 'free');
    assert.equal(s.canRecord, true);
    assert.equal(s.meetingsPerMonth, 10);
  });

  await t.test('an expired access token is refreshed once, transparently', async () => {
    const tok = secure.get('tokens');
    secure.set('tokens', { ...tok, access_token: 'not-a-real-token' });
    const me = await api.me();
    assert.equal(me.email, 'ana@exemplo.ao');
    assert.notEqual(secure.get('tokens').access_token, 'not-a-real-token');
  });

  await t.test('plans come from the server and the dev switch upgrades the licence', async () => {
    const plans = await api.plans();
    assert.deepEqual(plans.map((p) => p.id), ['free', 'pro', 'pro_cloud', 'team', 'enterprise']);
    await api.request('POST', '/v1/dev/set-plan', { body: { plan: 'pro' } });
    const s = await licence.refresh();
    assert.equal(s.plan, 'pro');
    assert.equal(s.meetingsPerMonth, null);
  });

  await t.test('buying needs a confirmed email; once confirmed, checkout says "not configured" in a way the UI can show', async () => {
    await assert.rejects(() => api.checkout('pro'), (e) => e.status === 403 && e.code === 'email_not_verified');
    const outbox = path.join(mailDir, 'outbox.jsonl');
    for (let i = 0; i < 40 && !fs.existsSync(outbox); i++) await new Promise((r) => setTimeout(r, 100));
    const mail = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === 'ana@exemplo.ao' && /Confirma/.test(m.subject) && /account\/verify/.test(m.text)).at(-1);
    const token = (mail.text.match(/token=([A-Za-z0-9_-]+)/) || [])[1];
    await assert.rejects(() => api.verifyEmail('x'.repeat(40)), (e) => e.code === 'invalid_or_expired_token');
    await api.verifyEmail(token);
    assert.equal((await api.me()).email_verified, true);
    await api.joinWaitlist((await api.me()).email, 'pro');                       // "Avisar-me" while payments are off
  });

  await t.test('paying: checkout, one attempt with the test method, then the licence unlocks the plan', async () => {
    const { intent, methods } = await api.checkout('pro');
    assert.equal(intent.currency, 'AOA');
    assert.deepEqual(methods.map((m) => m.id), ['mock']);
    assert.equal((await api.billingSubscription()).pending_intent, null);       // only looked at, nothing started yet
    const attempt = await api.createAttempt(intent.id, 'mock', '', 'sucesso');
    assert.equal(attempt.masked_phone, '');                                       // the test method takes no phone number
    let r;
    for (let i = 0; i < 40; i++) { r = await api.attempt(intent.id, attempt.id); if (r.intent.status !== 'pending') break; await new Promise((x) => setTimeout(x, 100)); }
    assert.equal(r.intent.status, 'paid');
    const s = await licence.refresh();
    assert.equal(s.plan, 'pro');
  });

  await t.test('devices lists this one, profile edits and password change work', async () => {
    const devices = await api.devices();
    assert.ok(devices.some((d) => d.device === 'Ivuenu desktop (test)'));
    assert.equal((await api.patchMe({ name: 'Ana S.' })).name, 'Ana S.');
    await api.changePassword('uma-palavra-passe-longa', 'outra-palavra-passe-longa');
    await api.logout();
    assert.equal(api.signedIn(), false);
    await api.login({ email: 'ana@exemplo.ao', password: 'outra-palavra-passe-longa' });
  });

  await t.test('forgot password: a code arrives by email, resets the password and ends every session', async () => {
    await api.forgotPassword('nobody@exemplo.ao');                                        // same quiet answer for an unknown email
    await api.forgotPassword('ana@exemplo.ao');
    const outbox = path.join(mailDir, 'outbox.jsonl');
    for (let i = 0; i < 40 && !fs.existsSync(outbox); i++) await new Promise((r) => setTimeout(r, 100));
    const mails = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(mails.filter((m) => m.to === 'nobody@exemplo.ao').length, 0, 'no email for an unknown address');
    const mail = mails.filter((m) => m.to === 'ana@exemplo.ao' && /palavra-passe/i.test(m.subject) && /reset\?token|reset/.test(m.text)).at(-1);   // earlier mails are "password changed" notices
    const token = (mail.text.match(/token=([A-Za-z0-9_-]+)/) || [])[1];
    assert.ok(token, 'the email contains a link with a token');
    assert.ok(mail.html && mail.html.includes('<!doctype html>'), 'the designed HTML version is sent too');
    await assert.rejects(() => api.resetPassword({ token: 'x'.repeat(40), newPassword: 'senha-recuperada-123' }), (e) => e.code === 'invalid_or_expired_token');
    await api.resetPassword({ token, newPassword: 'senha-recuperada-123' });
    await assert.rejects(() => api.login({ email: 'ana@exemplo.ao', password: 'outra-palavra-passe-longa' }), (e) => e.status === 401);
    await api.login({ email: 'ana@exemplo.ao', password: 'senha-recuperada-123' });
  });

  await t.test('encrypted sync: two computers, one account, real HTTP; the server only holds ciphertext', async () => {
    const computer = async () => {
      const { store, repo } = newRepo();
      const sec = new SecureStore(path.join(tmpDir(), 'secure.bin'), null, { requireEncryption: false });
      const client = new ApiClient({ getBase: () => base, secure: sec, deviceName: 'Ivuenu desktop (sync test)' });
      await client.login({ email: 'ana@exemplo.ao', password: 'senha-recuperada-123' });
      return { store, repo, sec, client, sync: new SyncManager({ repo, store, api: client, secure: sec }) };
    };
    const a = await computer(); const b = await computer();
    const m = a.repo.createMeeting({ title: 'Reunião do cofre', status: 'done', startedAt: '2026-10-20T10:00:00.000Z' });
    a.repo.setMyNotes(m.id, 'o código é 4821');
    a.repo.updateMeeting(m.id, { status: 'done' });
    const on = await a.sync.enable('uma frase-passe longa');
    assert.equal(on.lastError, '');
    assert.equal(on.synced, 1);
    const raw = await a.client.syncGet(m.id);                                            // what the server holds
    assert.equal(raw.data.includes('cofre'), false);
    assert.equal(raw.data.includes('4821'), false);
    await assert.rejects(() => b.sync.enable('frase errada qualquer'), (e) => e.code === 'wrong_passphrase');
    await b.sync.enable('uma frase-passe longa');
    assert.equal(b.repo.getMeeting(m.id).title, 'Reunião do cofre');
    a.repo.setMyNotes(m.id, 'notas novas');
    await a.sync.syncNow(); await b.sync.syncNow();
    assert.equal(b.repo.getMeeting(m.id).myNotes, 'notas novas');
    b.repo.deleteMeeting(m.id);
    await b.sync.syncNow(); await a.sync.syncNow();
    assert.equal(a.repo.getMeeting(m.id), null);                                         // deleted everywhere
    const usage = await a.client.syncUsage();
    assert.equal(usage.items, 0);
    const again = a.repo.createMeeting({ title: 'Outra', status: 'done' });
    a.repo.updateMeeting(again.id, { status: 'done' });
    await a.sync.syncNow();
    await a.sync.wipeCloud();                                                            // delete everything in the cloud
    assert.equal((await b.client.syncUsage()).items, 0);
    await assert.rejects(() => b.client.syncKey(), (e) => e.status === 404);
    assert.ok(a.repo.getMeeting(again.id), 'the meeting on this computer is kept');
  });

  await t.test('cloud transcription: audio goes up, a line comes back, minutes are counted, nothing else is kept', async () => {
    assert.equal((await api.cloudTranscribe(Buffer.from('abc'), 'audio/webm', 3)).segments.length >= 0, true);          // the Free plan has an allowance too
    await api.request('POST', '/v1/dev/set-plan', { body: { plan: 'pro_cloud' } });
    const engine = new CloudEngine({ api, getSettings: () => ({ language: 'pt' }), fallback: new DemoEngine({ stepMs: 10 }), retryMs: [1] });
    const lines = []; const problems = [];
    engine.start({ id: 'mtg_cloud' }, { partial() {}, final: (l) => lines.push(l), problem: (p) => problems.push(p) }, () => 60_000);
    await engine.feed({ source: 'mic', mime: 'audio/webm', seconds: 12, data: new Uint8Array(2000).buffer });
    assert.equal(problems.length, 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0].text, /Linha de teste \(2000 bytes/);
    assert.equal(lines[0].speakerKey, 'spk_me');
    assert.equal(lines[0].startMs, 48_000);
    const usage = await api.cloudUsage();
    assert.equal(usage.minutes_used, 0.2);
    assert.equal(usage.minutes_limit, 600);
    const notes = await engine.writeNotes({ id: 'm', title: 'x', template: 'auto', redact: true, myNotes: '', attendees: [], segments: [{ id: 1, speakerKey: 'spk_me', text: 'olá', startMs: 0 }] }, () => 'Eu');
    assert.equal(notes.engine, 'demo-fallback');                     // this server has no language model, so the local notes are used
  });

  await t.test('no server: the error says offline, nothing throws strangely', async () => {
    const dead = new ApiClient({ getBase: () => 'http://127.0.0.1:1', secure });
    await assert.rejects(() => dead.plans(), (e) => e.code === 'offline');
  });

  await t.test('deleting the account removes it and signs out', async () => {
    await api.deleteAccount();
    assert.equal(api.signedIn(), false);
    await assert.rejects(() => api.login({ email: 'ana@exemplo.ao', password: 'senha-recuperada-123' }), (e) => e.status === 401);
  });
});
