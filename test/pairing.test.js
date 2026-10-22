const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Pairing, wrapKey, sealKey, openKey } = require('../src/main/pairing');

// Made with Python's `cryptography` (backend/.venv): fixed keys, secret, nonce and id. If Node and Python ever disagree, a phone app would not open the key.
const V = {
  desktopPrivate: '001111111111111111111111111111111111111111111111111111111111414a',
  phonePrivate: '0022222222222222222222222222222222222222222222222222222222232b54',
  desktopPub: 'BO-oKH-5Y8xJaXmRu-zcQIAQ86-05i28nn9X7u1qeW0QrHxkVx0spzJUmirDEJUHLtm_-cMC04cfLIv5gsjEeQk',
  phonePub: 'BOvNB2jByd2dbAlJi9zPIWLVRtpCl8zycr3-WV8FYIRL4M6pFRkExwmWzw2RrFOJW-I_peByGw62XgZjvePMHLY',
  secret: '000102030405060708090a0b0c0d0e0f', dataKey: '6465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80818283',
  nonce: 'c8c9cacbcccdcecfd0d1d2d3', id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  wrap: 'c89360bb2b2446232bed6f773e82b5432129b0aaf0a0e63b06e5f06e0a71276a',
  sealed: 'yMnKy8zNzs_Q0dLTrY1ig32Wi8LxlvUz4o3RBB7jG0pxF6giilkWYIcsX0Ksg7ezitYV4VLL7jJAVZMN',
};
const keyPair = (hex) => { const e = crypto.createECDH('prime256v1'); e.setPrivateKey(Buffer.from(hex, 'hex')); return e; };

test('Node and Python agree on every step: the public keys, the wrapping key and the sealed key', () => {
  const desktop = keyPair(V.desktopPrivate); const phone = keyPair(V.phonePrivate);
  assert.equal(desktop.getPublicKey().toString('base64url'), V.desktopPub);
  assert.equal(phone.getPublicKey().toString('base64url'), V.phonePub);
  const wrap = wrapKey(desktop, V.phonePub, Buffer.from(V.secret, 'hex'));
  assert.equal(wrap.toString('hex'), V.wrap);
  assert.equal(wrapKey(phone, V.desktopPub, Buffer.from(V.secret, 'hex')).toString('hex'), V.wrap);        // both sides reach the same key
  assert.equal(sealKey(wrap, Buffer.from(V.dataKey, 'hex'), V.id, Buffer.from(V.nonce, 'hex')), V.sealed);
  assert.equal(openKey(wrap, V.sealed, V.id).toString('hex'), V.dataKey);
});

test('a sealed key does not open with another secret, another pairing id or a flipped bit', () => {
  const desktop = keyPair(V.desktopPrivate);
  const right = wrapKey(desktop, V.phonePub, Buffer.from(V.secret, 'hex'));
  assert.throws(() => openKey(wrapKey(desktop, V.phonePub, crypto.randomBytes(16)), V.sealed, V.id));
  assert.throws(() => openKey(right, V.sealed, 'another-pairing-id'));
  const raw = Buffer.from(V.sealed, 'base64url'); raw[20] ^= 1;
  assert.throws(() => openKey(right, raw.toString('base64url'), V.id));
});

// ---------------------------------------------------------------------------------------------- the computer's side, against a fake server
function fakeServer() {
  const s = { row: null, deleted: [], now: 1000 };
  s.api = {
    syncPairCreate: async (pub) => { s.row = { id: 'p'.repeat(32), desktop_pub: pub, phone_pub: null, device_name: '', sealed: null }; return { id: s.row.id, expires_at: new Date(s.now + 300000).toISOString() }; },
    syncPairGet: async () => { if (!s.row) { const e = new Error('gone'); e.status = 404; throw e; } return { ...s.row, state: s.row.sealed ? 'sealed' : s.row.phone_pub ? 'joined' : 'waiting' }; },
    syncPairSeal: async (id, sealed) => { s.row.sealed = sealed; },
    syncPairDelete: async (id) => { s.deleted.push(id); s.row = null; },
  };
  return s;
}
const setup = (hasKey = true) => {
  const dataKey = crypto.randomBytes(32);
  const server = fakeServer();
  const secure = { get: (k) => (k === 'syncKey' && hasKey ? dataKey.toString('base64') : null) };
  const pairing = new Pairing({ api: server.api, secure, getBase: () => 'https://api.ivuenu.example', now: () => server.now });
  return { dataKey, server, pairing };
};

test('the link carries what the phone needs, and the secret never goes to the server', async () => {
  const { server, pairing } = setup();
  const r = await pairing.start();
  const u = new URL(r.link);
  assert.equal(u.protocol, 'ivuenu:'); assert.equal(u.searchParams.get('v'), '1');
  assert.equal(u.searchParams.get('s'), 'https://api.ivuenu.example'); assert.equal(u.searchParams.get('id'), server.row.id);
  assert.equal(u.searchParams.get('k'), server.row.desktop_pub);
  const secret = u.searchParams.get('x');
  assert.equal(Buffer.from(secret, 'base64url').length, 16);
  assert.ok(!JSON.stringify(server.row).includes(secret), 'the server only ever holds the public key');
});

test('a phone that scans the code gets the data key, after the person approves it', async () => {
  const { dataKey, server, pairing } = setup();
  const u = new URL((await pairing.start()).link);
  assert.deepEqual(await pairing.status(), { state: 'waiting', device: '', expiresAt: server.now + 300000 });
  // the phone
  const phone = crypto.createECDH('prime256v1'); phone.generateKeys();
  server.row.phone_pub = phone.getPublicKey().toString('base64url'); server.row.device_name = 'Telemóvel da Ana';
  const seen = await pairing.status();
  assert.equal(seen.state, 'joined'); assert.equal(seen.device, 'Telemóvel da Ana');
  assert.equal(server.row.sealed, null, 'nothing is sent until the person approves');
  assert.deepEqual(await pairing.accept(), { state: 'done' });
  const opened = openKey(wrapKey(phone, u.searchParams.get('k'), Buffer.from(u.searchParams.get('x'), 'base64url')), server.row.sealed, u.searchParams.get('id'));
  assert.equal(opened.toString('hex'), dataKey.toString('hex'));
  assert.deepEqual(await pairing.status(), { state: 'none' }, 'the private key and the secret are forgotten after use');
});

test('it needs sync to be on, a phone that asked, and time', async () => {
  await assert.rejects(() => setup(false).pairing.start(), (e) => e.code === 'sync_not_ready');
  const { server, pairing } = setup();
  await assert.rejects(() => pairing.accept(), (e) => e.code === 'pairing_none');
  await pairing.start();
  await assert.rejects(() => pairing.accept(), (e) => e.code === 'pairing_not_joined');
  server.now += 301000;
  assert.deepEqual(await pairing.status(), { state: 'expired' });
  assert.equal(server.deleted.length, 1, 'an expired link is removed from the server too');
});

test('starting again or cancelling removes the old link from the server', async () => {
  const { server, pairing } = setup();
  await pairing.start(); const first = server.row.id;
  await pairing.start();
  assert.deepEqual(server.deleted, [first]);
  await pairing.cancel();
  assert.equal(server.deleted.length, 2); assert.equal((await pairing.status()).state, 'none');
});
