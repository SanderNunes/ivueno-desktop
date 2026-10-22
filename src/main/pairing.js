/**
 * Linking a phone to the sync: this computer already has the data key; the phone has to get it without the passphrase, and without the server
 * ever being able to read it. Protocol (also in docs/PHONE_PAIRING.md; backend/tests/test_sync_pairing.py plays both sides):
 *
 *   computer: makes an ephemeral P-256 key pair and a random 16-byte secret, asks the server for a pairing (sends only the PUBLIC key),
 *             and shows a QR code with { server, pairing id, its public key, the secret }. The secret never goes to the server.
 *   phone:    scans the code, signs in to the same account, makes its own key pair and sends its PUBLIC key (and a device name) to the pairing.
 *   computer: sees the request, shows the device name, and only when the person approves it:
 *               wrapKey = HKDF-SHA256( ECDH(own private, phone public), salt = secret, info = "ivuenu-pair-v1" )
 *               sealed  = nonce(12) | AES-256-GCM(wrapKey, data key, aad = pairing id) | tag(16)      (base64url) -> uploaded
 *   phone:    downloads `sealed`, derives the same wrapKey (its private key, the computer's public key and the secret from the QR) and opens it.
 *
 * A server that swaps the phone's public key for its own still cannot derive wrapKey: it never had the secret.
 */
const crypto = require('crypto');

const INFO = Buffer.from('ivuenu-pair-v1');
const coded = (code, message) => { const e = new Error(message); e.code = code; return e; };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (text) => Buffer.from(String(text), 'base64url');

function wrapKey(ecdh, otherPub, secret) {
  const shared = ecdh.computeSecret(unb64u(otherPub));
  return Buffer.from(crypto.hkdfSync('sha256', shared, secret, INFO, 32));
}

function sealKey(wrap, dataKey, pairingId, nonce = crypto.randomBytes(12)) {
  const cipher = crypto.createCipheriv('aes-256-gcm', wrap, nonce);
  cipher.setAAD(Buffer.from(pairingId));
  const ct = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return b64u(Buffer.concat([nonce, ct, cipher.getAuthTag()]));
}

/** The phone's side, here so the two sides can be tested against each other (and against a Python reference). */
function openKey(wrap, sealed, pairingId) {
  const raw = unb64u(sealed);
  const decipher = crypto.createDecipheriv('aes-256-gcm', wrap, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(pairingId));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}

class Pairing {
  /** api: syncPairCreate/Get/Seal/Delete. secure: holds the data key ('syncKey', base64). getBase(): the server address the phone should use. */
  constructor({ api, secure, getBase, now = Date.now }) {
    this.api = api; this.secure = secure; this.getBase = getBase; this.now = now;
    this.cur = null;
  }

  _dataKey() { const k = this.secure.get('syncKey'); return k ? Buffer.from(k, 'base64') : null; }

  async start() {
    if (!this._dataKey()) throw coded('sync_not_ready', 'Liga a sincronização neste computador primeiro.');
    await this.cancel();
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const pub = b64u(ecdh.getPublicKey());
    const secret = crypto.randomBytes(16);
    const made = await this.api.syncPairCreate(pub);
    this.cur = { id: made.id, ecdh, secret, expiresAt: Date.parse(made.expires_at) || this.now() + 5 * 60 * 1000 };
    const link = `ivuenu://pair?v=1&s=${encodeURIComponent(this.getBase())}&id=${made.id}&k=${pub}&x=${b64u(secret)}`;
    return { link, expiresAt: this.cur.expiresAt };
  }

  /** waiting (nobody scanned yet) | joined (a phone asks; `device` is its name) | expired | none */
  async status() {
    if (!this.cur) return { state: 'none' };
    if (this.now() >= this.cur.expiresAt) { await this.cancel(); return { state: 'expired' }; }
    let r;
    try { r = await this.api.syncPairGet(this.cur.id); } catch (e) {
      if (e.status === 410 || e.status === 404) { this.cur = null; return { state: 'expired' }; }
      throw e;
    }
    return { state: r.state === 'sealed' ? 'done' : r.state, device: r.device_name || '', expiresAt: this.cur.expiresAt };
  }

  /** The person approved the phone that is asking: seal the key for it. */
  async accept() {
    if (!this.cur) throw coded('pairing_none', 'Não há nenhum telemóvel à espera.');
    const key = this._dataKey();
    if (!key) throw coded('sync_not_ready', 'Liga a sincronização neste computador primeiro.');
    const r = await this.api.syncPairGet(this.cur.id);
    if (r.state !== 'joined' || !r.phone_pub) throw coded('pairing_not_joined', 'Ainda nenhum telemóvel leu o código.');
    const sealed = sealKey(wrapKey(this.cur.ecdh, r.phone_pub, this.cur.secret), key, this.cur.id);
    await this.api.syncPairSeal(this.cur.id, sealed);
    this.cur = null;                                                  // the private key and the secret are forgotten at once
    return { state: 'done' };
  }

  async cancel() {
    if (!this.cur) return;
    const { id } = this.cur;
    this.cur = null;
    try { await this.api.syncPairDelete(id); } catch { /* it expires by itself */ }
  }
}

module.exports = { Pairing, wrapKey, sealKey, openKey, INFO };
