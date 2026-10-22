const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { verifyLicence, LicenceManager } = require('../src/main/licence');
const { SecureStore } = require('../src/main/secure');
const { tmpDir } = require('./helpers');

const b64u = (b) => Buffer.from(b).toString('base64url');

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

function sign(privateKey, claims) {
  const h = b64u(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${b64u(crypto.sign(null, Buffer.from(`${h}.${p}`), privateKey))}`;
}

const claims = (over = {}) => ({ sub: 'u1', typ: 'licence', plan: 'pro', features: ['local_engine'], meetings_per_month: null, seats: 1,
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7, ...over });

test('a licence signed by the server key verifies offline', () => {
  const { privateKey, publicPem } = keypair();
  assert.equal(verifyLicence(sign(privateKey, claims()), publicPem).plan, 'pro');
});

test('a licence signed by another key is rejected', () => {
  const a = keypair(); const b = keypair();
  assert.throws(() => verifyLicence(sign(a.privateKey, claims()), b.publicPem), (e) => e.code === 'licence_invalid');
});

test('an edited licence is rejected (cannot upgrade yourself)', () => {
  const { privateKey, publicPem } = keypair();
  const [h, , s] = sign(privateKey, claims({ plan: 'free' })).split('.');
  const forged = `${h}.${b64u(JSON.stringify(claims({ plan: 'enterprise' })))}.${s}`;
  assert.throws(() => verifyLicence(forged, publicPem), (e) => e.code === 'licence_invalid');
});

test('an expired licence says so', () => {
  const { privateKey, publicPem } = keypair();
  const old = sign(privateKey, claims({ exp: Math.floor(Date.now() / 1000) - 10 }));
  assert.throws(() => verifyLicence(old, publicPem), (e) => e.code === 'licence_expired');
});

test('a token that is not an EdDSA licence is rejected', () => {
  const { publicPem } = keypair();
  assert.throws(() => verifyLicence('abc.def.ghi', publicPem), (e) => e.code === 'licence_invalid');
  assert.throws(() => verifyLicence('nope', publicPem), (e) => e.code === 'licence_invalid');
});

function manager(now) {
  const secure = new SecureStore(path.join(tmpDir(), 'secure.bin'), null, { requireEncryption: false });
  const { privateKey, publicPem } = keypair();
  const exp = Math.floor(now() / 1000) + 86400 * 7;
  const lic = {
    plan: 'pro', status: 'active', features: ['local_engine'], meetings_per_month: null, meetings_this_month: 2, seats: 1,
    token: sign(privateKey, claims({ exp, iat: Math.floor(now() / 1000) })),
    expires_at: new Date(exp * 1000).toISOString(), renew_after: new Date(now() + 86400000 * 2).toISOString(),
  };
  const api = { licence: async () => lic, licencePublicKey: async () => publicPem };
  return { mgr: new LicenceManager({ secure, api, now }), lic };
}

test('the manager keeps the licence and answers offline; renewal becomes due, then it expires', async () => {
  let now = Date.now();
  const { mgr } = manager(() => now);
  assert.equal(mgr.status().state, 'none');
  assert.equal(mgr.status().canRecord, false);
  await mgr.refresh();
  const ok = mgr.status();
  assert.equal(ok.state, 'ok'); assert.equal(ok.plan, 'pro'); assert.equal(ok.canRecord, true);
  now += 3 * 86400000;
  assert.equal(mgr.status().state, 'renew');
  assert.ok(mgr.status().daysLeft <= 4);
  now += 5 * 86400000;
  const gone = mgr.status();
  assert.equal(gone.state, 'expired'); assert.equal(gone.canRecord, false);
});

test('a refreshed licence that does not match the pinned key is refused', async () => {
  const now = Date.now();
  const { mgr } = manager(() => now);
  await mgr.refresh();
  const other = keypair();
  mgr.api.licence = async () => ({ ...(mgr.cached()), token: sign(other.privateKey, claims()) });
  await assert.rejects(() => mgr.refresh(), (e) => e.code === 'licence_invalid');
  assert.equal(mgr.status().state, 'ok', 'the old good licence is still there');
});


test('embedded keys: only they are trusted, the server is never asked for a key, and a rotation (two keys) works', async () => {
  const oldKey = keypair(); const newKey = keypair(); const stranger = keypair();
  const secure = new SecureStore(path.join(tmpDir(), 'secure.bin'), null, { requireEncryption: false });
  let keyAsked = false;
  const lic = (priv) => ({ plan: 'pro', status: 'active', features: [], meetings_per_month: null, seats: 1, token: sign(priv, claims()),
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), renew_after: new Date(Date.now() + 86400000).toISOString() });
  const api = { licence: async () => lic(api.signer), licencePublicKey: async () => { keyAsked = true; return stranger.publicPem; } };
  const mgr = new LicenceManager({ secure, api, embeddedKeys: [oldKey.publicPem, newKey.publicPem] });

  api.signer = oldKey.privateKey;
  assert.equal((await mgr.refresh()).plan, 'pro');                       // signed with the old key: still fine
  api.signer = newKey.privateKey;
  assert.equal((await mgr.refresh()).plan, 'pro');                       // signed with the new key: fine too (rotation)
  api.signer = stranger.privateKey;
  await assert.rejects(() => mgr.refresh(), (e) => e.code === 'licence_invalid');   // a server-side swap is refused
  assert.equal(keyAsked, false, 'with embedded keys nothing is learned from the server');
  assert.equal(mgr.status().plan, 'pro', 'the last good licence is kept');
});
