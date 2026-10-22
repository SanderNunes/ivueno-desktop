// Encrypted sync, against a fake server that behaves like the real one (versions, tombstones, a locked key).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SyncManager, encryptItem, decryptItem } = require('../src/main/sync');
const { SecureStore } = require('../src/main/secure');
const { newRepo, tmpDir } = require('./helpers');

const err = (status, code, details) => Object.assign(new Error(code), { status, code, details });

/** What the real backend does for /v1/sync, in memory. It only ever holds bytes. */
class FakeServer {
  constructor() { this.keys = {}; this.items = {}; this.seq = {}; this.offline = false; }
  api(userId) {
    const s = this;
    const guard = () => { if (s.offline) throw Object.assign(new Error('offline'), { code: 'offline', status: 0 }); };
    const mine = () => (s.items[userId] ||= {});
    return {
      userId,
      signedIn: () => true,
      me: async () => { guard(); return { id: s.currentUser || userId }; },
      syncKey: async () => { guard(); if (!s.keys[userId]) throw err(404, 'not_found'); return s.keys[userId]; },
      putSyncKey: async (body) => { guard(); if (s.keys[userId]) throw err(409, 'key_exists'); s.keys[userId] = body; return body; },
      syncList: async (after) => {
        guard();
        const rows = Object.entries(mine()).map(([id, i]) => ({ id, ...i })).filter((i) => i.seq > after).sort((a, b) => a.seq - b.seq);
        return { items: rows.map((i) => ({ id: i.id, seq: i.seq, version: i.version, deleted: !!i.deleted, size: i.blob ? i.blob.length : 0 })), next_after: rows.length ? rows[rows.length - 1].seq : after, has_more: false };
      },
      syncGet: async (id) => { guard(); const i = mine()[id]; if (!i) throw err(404, 'not_found'); if (i.deleted) throw err(410, 'deleted'); return { data: Buffer.from(i.blob), version: i.version }; },
      syncPut: async (id, buf, basedOn) => {
        guard();
        const cur = mine()[id]; const version = cur ? cur.version : 0;
        if (basedOn !== version) throw err(409, 'version_conflict', { current_version: version });
        s.seq[userId] = (s.seq[userId] || 0) + 1;
        mine()[id] = { version: version + 1, seq: s.seq[userId], blob: Buffer.from(buf), deleted: false };
        return { id, version: version + 1, seq: s.seq[userId] };
      },
      syncDelete: async (id) => {
        guard();
        const i = mine()[id]; if (!i) throw err(404, 'not_found');
        if (!i.deleted) { s.seq[userId] = (s.seq[userId] || 0) + 1; Object.assign(i, { deleted: true, blob: null, version: i.version + 1, seq: s.seq[userId] }); }
      },
      syncWipe: async () => { guard(); delete s.items[userId]; delete s.keys[userId]; },
      syncUsage: async () => ({ items: Object.values(mine()).filter((i) => !i.deleted).length, bytes: 0, quota_bytes: 1 }),
    };
  }
}

/** One computer: its own data file, its own secure store. */
function computer(server, userId = 'user1') {
  const { store, repo } = newRepo();
  const secure = new SecureStore(path.join(tmpDir(), 'secure.bin'), null, { requireEncryption: false });
  const api = server.api(userId);
  const sync = new SyncManager({ repo, store, api, secure });
  return { store, repo, secure, api, sync };
}

function finished(repo, title, extra = {}) {
  const m = repo.createMeeting({ title, status: 'done', startedAt: '2026-10-20T10:00:00.000Z' });
  repo.setMyNotes(m.id, extra.notes || `notas de ${title}`);
  repo.updateMeeting(m.id, { status: 'done' });
  return m;
}

const PASS = 'a minha frase-passe';

test('the data key is locked with the passphrase, and the cloud only holds ciphertext', async () => {
  const server = new FakeServer();
  const a = computer(server);
  const m = finished(a.repo, 'Reunião secreta do banco', { notes: 'o código do cofre é 4821' });
  const status = await a.sync.enable(PASS);
  assert.equal(status.enabled, true);
  assert.equal(status.lastError, '');
  const stored = server.items.user1[m.id];
  assert.ok(stored.blob.length > 0);
  assert.equal(stored.blob.includes('secreta'), false);
  assert.equal(stored.blob.includes('4821'), false);
  assert.equal(JSON.stringify(server.keys.user1).includes(PASS), false);
});

test('a new passphrase must be long enough, and nothing is switched on if it is not', async () => {
  const a = computer(new FakeServer());
  await assert.rejects(() => a.sync.enable('curta'), (e) => e.code === 'weak_passphrase');
  assert.equal(a.store.data.sync.enabled, false);
});

test('a second computer opens the key with the same passphrase and receives the meetings', async () => {
  const server = new FakeServer();
  const a = computer(server); const m = finished(a.repo, 'Planeamento');
  await a.sync.enable(PASS);
  const b = computer(server);
  await b.sync.enable(PASS);
  const copy = b.repo.getMeeting(m.id);
  assert.ok(copy);
  assert.equal(copy.title, 'Planeamento');
  assert.equal(copy.myNotes, 'notas de Planeamento');
});

test('a wrong passphrase opens nothing and changes nothing', async () => {
  const server = new FakeServer();
  const a = computer(server); finished(a.repo, 'Planeamento');
  await a.sync.enable(PASS);
  const b = computer(server);
  await assert.rejects(() => b.sync.enable('outra frase qualquer'), (e) => e.code === 'wrong_passphrase');
  assert.equal(b.store.data.sync.enabled, false);
  assert.equal(b.repo.d.meetings.length, 0);
  assert.equal(b.secure.get('syncKey') || null, null);
});

test('only finished meetings are uploaded, and a meeting marked "não sincronizar" never is', async () => {
  const server = new FakeServer();
  const a = computer(server);
  const done = finished(a.repo, 'Pronta');
  const live = a.repo.createMeeting({ title: 'A gravar', status: 'recording' });
  const priv = finished(a.repo, 'Privada'); a.repo.updateMeeting(priv.id, { syncOff: true });
  await a.sync.enable(PASS);
  assert.deepEqual(Object.keys(server.items.user1), [done.id]);
  assert.ok(live && priv);
});

test('edits, deletions and "não sincronizar" travel to the other computer', async () => {
  const server = new FakeServer();
  const a = computer(server); const b = computer(server);
  const m = finished(a.repo, 'Original');
  await a.sync.enable(PASS); await b.sync.enable(PASS);
  a.repo.setMyNotes(m.id, 'notas editadas'); a.repo.updateMeeting(m.id, { title: 'Editada' });
  await a.sync.syncNow(); await b.sync.syncNow();
  assert.equal(b.repo.getMeeting(m.id).title, 'Editada');
  assert.equal(b.repo.getMeeting(m.id).myNotes, 'notas editadas');
  b.repo.deleteMeeting(m.id);                                                  // deleting on B ...
  await b.sync.syncNow(); await a.sync.syncNow();
  assert.equal(a.repo.getMeeting(m.id), null);                                 // ... deletes on A
  assert.equal(server.items.user1[m.id].deleted, true);
  assert.equal(server.items.user1[m.id].blob, null);
});

test('marking a synced meeting "não sincronizar" removes its cloud copy but keeps it on this computer', async () => {
  const server = new FakeServer();
  const a = computer(server); const m = finished(a.repo, 'Sensível');
  await a.sync.enable(PASS);
  a.repo.updateMeeting(m.id, { syncOff: true });
  await a.sync.syncNow();
  assert.equal(server.items.user1[m.id].deleted, true);
  assert.ok(a.repo.getMeeting(m.id));
  assert.equal(a.store.data.sync.items[m.id], undefined);
});

test('when both computers changed the same meeting nothing is lost: one becomes the meeting, the other a copy', async () => {
  const server = new FakeServer();
  const a = computer(server); const b = computer(server);
  const m = finished(a.repo, 'Reunião');
  await a.sync.enable(PASS); await b.sync.enable(PASS);
  a.repo.setMyNotes(m.id, 'versão do A'); b.repo.setMyNotes(m.id, 'versão do B');
  await a.sync.syncNow();                                                      // A gets there first
  await b.sync.syncNow();                                                      // B finds A's version
  const titles = b.repo.d.meetings.map((x) => `${x.title}|${x.myNotes}`).sort();
  assert.deepEqual(titles, ['Reunião (cópia em conflito)|versão do B', 'Reunião|versão do A']);
  await a.sync.syncNow();                                                      // and A receives B's copy
  assert.equal(a.repo.d.meetings.length, 2);
  assert.ok(a.repo.d.meetings.some((x) => x.myNotes === 'versão do B'));
});

test('a meeting being recorded is never overwritten by the cloud', async () => {
  const server = new FakeServer();
  const a = computer(server); const b = computer(server);
  const m = finished(a.repo, 'Reunião');
  await a.sync.enable(PASS); await b.sync.enable(PASS);
  b.repo.updateMeeting(m.id, { status: 'recording' });
  a.repo.setMyNotes(m.id, 'mudança noutro lado');
  await a.sync.syncNow(); await b.sync.syncNow();
  assert.equal(b.repo.getMeeting(m.id).myNotes, 'notas de Reunião');
  assert.equal(b.repo.getMeeting(m.id).status, 'recording');
});

test('a blob moved to another meeting cannot be opened, and the rest still syncs', async () => {
  const server = new FakeServer();
  const a = computer(server); const b = computer(server);
  const one = finished(a.repo, 'Um'); const two = finished(a.repo, 'Dois');
  await a.sync.enable(PASS);
  server.items.user1[two.id].blob = server.items.user1[one.id].blob;             // someone with server access swaps them
  server.items.user1[two.id].version += 1; server.items.user1[two.id].seq = 99;
  await b.sync.enable(PASS);
  assert.ok(b.repo.getMeeting(one.id));
  assert.equal(b.repo.getMeeting(two.id), null);
  assert.match(b.store.data.sync.lastError, /não pôde ser aberta|aberta/);
});

test('encryption binds the meeting id and detects tampering', () => {
  const key = Buffer.alloc(32, 7);
  const blob = encryptItem(key, 'mtg_aaaaaaaa', { title: 'x' });
  assert.deepEqual(decryptItem(key, 'mtg_aaaaaaaa', blob), { title: 'x' });
  assert.throws(() => decryptItem(key, 'mtg_bbbbbbbb', blob));
  const bent = Buffer.from(blob); bent[bent.length - 1] ^= 1;
  assert.throws(() => decryptItem(key, 'mtg_aaaaaaaa', bent));
  assert.throws(() => decryptItem(Buffer.alloc(32, 8), 'mtg_aaaaaaaa', blob));
  assert.notDeepEqual(encryptItem(key, 'mtg_aaaaaaaa', { title: 'x' }), blob);       // a new random IV every time
});

test('syncing is switched off when a different account signs in on this computer', async () => {
  const server = new FakeServer();
  const a = computer(server); finished(a.repo, 'Da Ana');
  await a.sync.enable(PASS);
  server.currentUser = 'someone-else';
  const status = await a.sync.syncNow();
  assert.equal(status.enabled, false);
  assert.match(status.lastError, /outra conta/);
  assert.equal(a.secure.get('syncKey') || null, null);
});

test('no network is not an error screen: the problem is noted and the next round tries again', async () => {
  const server = new FakeServer();
  const a = computer(server); const m = finished(a.repo, 'Offline');
  await a.sync.enable(PASS);
  a.repo.setMyNotes(m.id, 'escrito sem rede');
  server.offline = true;
  const down = await a.sync.syncNow();
  assert.match(down.lastError, /Sem ligação/);
  assert.equal(down.pending, 1);
  server.offline = false;
  const up = await a.sync.syncNow();
  assert.equal(up.lastError, '');
  assert.equal(up.pending, 0);
});

test('deleting the cloud copy removes everything there and stops syncing, keeping the meetings here', async () => {
  const server = new FakeServer();
  const a = computer(server); const m = finished(a.repo, 'Fica aqui');
  await a.sync.enable(PASS);
  const status = await a.sync.wipeCloud();
  assert.equal(status.enabled, false);
  assert.equal(server.items.user1, undefined);
  assert.equal(server.keys.user1, undefined);
  assert.ok(a.repo.getMeeting(m.id));
});

test('turning sync off on this computer keeps the cloud copies and forgets the key', async () => {
  const server = new FakeServer();
  const a = computer(server); const m = finished(a.repo, 'Mantém');
  await a.sync.enable(PASS);
  await a.sync.disable();
  assert.equal(a.secure.get('syncKey') || null, null);
  assert.ok(server.items.user1[m.id] && !server.items.user1[m.id].deleted);
});

test('a status shows what is waiting to be uploaded', async () => {
  const server = new FakeServer();
  const a = computer(server); finished(a.repo, 'Um');
  assert.equal((await a.sync.status()).pending, 0);                              // sync is off: nothing is "pending"
  await a.sync.enable(PASS);
  finished(a.repo, 'Dois');
  assert.equal((await a.sync.status()).pending, 1);
  await a.sync.syncNow();
  assert.equal((await a.sync.status({ withUsage: true })).usage.items, 2);
});
