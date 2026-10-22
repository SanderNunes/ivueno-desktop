const crypto = require('crypto');

const DAY = 86_400_000;

function b64u(str) { return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

/**
 * Check a licence the way the backend signs it (a JWT, algorithm EdDSA = Ed25519) without any network.
 * Throws an Error with code 'licence_invalid' (forged / damaged) or 'licence_expired'.
 * Written with Node's own crypto so the app needs no JWT library.
 */
function verifyLicence(token, publicPem, nowMs = Date.now()) {
  const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) fail('licence_invalid', 'licence is not a token');
  const [h, p, s] = parts;
  let header; let claims;
  try {
    header = JSON.parse(b64u(h).toString('utf8'));
    claims = JSON.parse(b64u(p).toString('utf8'));
  } catch { fail('licence_invalid', 'licence is damaged'); }
  if (header.alg !== 'EdDSA') fail('licence_invalid', 'unexpected algorithm');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(`${h}.${p}`), crypto.createPublicKey(publicPem), b64u(s)); } catch { ok = false; }
  if (!ok) fail('licence_invalid', 'signature does not match');
  if (claims.typ !== 'licence') fail('licence_invalid', 'not a licence');
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= nowMs) fail('licence_expired', 'licence has expired');
  return claims;
}

/**
 * Keeps the last good licence on disk (encrypted) and answers "may this person record?" offline.
 * The public key is remembered the first time the person signs in; a licence that does not verify against it is rejected.
 */
class LicenceManager {
  /**
   * embeddedKeys: public keys shipped inside the app (assets/licence-public-keys.json). When there are any, ONLY those are
   * trusted: a licence signed by anything else is refused, and nothing is learned from the server. With none (development),
   * the key is fetched and pinned the first time, as before.
   */
  constructor({ secure, api, now = () => Date.now(), autoRepin = false, embeddedKeys = [] }) {
    this.secure = secure;
    this.api = api;
    this.now = now;
    this.autoRepin = autoRepin;
    this.embeddedKeys = embeddedKeys;
  }

  /** Verify against every trusted key (several are allowed during a key rotation). */
  _verify(token, pinned) {
    const keys = this.embeddedKeys.length ? this.embeddedKeys : [pinned];
    let last;
    for (const key of keys) {
      try { return verifyLicence(token, key, this.now()); } catch (err) { last = err; if (err.code === 'licence_expired') throw err; }
    }
    throw last;
  }

  cached() { return this.secure.get('licence') || null; }

  clear() { this.secure.set('licence', null); }

  /** Fetch a fresh licence and keep it. On the first call (or after sign-in) the public key is pinned. */
  async refresh({ repin = false } = {}) {
    const lic = await this.api.licence();
    let key = !repin && this.cached() && this.cached().publicKey;
    if (!key && !this.embeddedKeys.length) key = await this.api.licencePublicKey();
    try {
      this._verify(lic.token, key);
    } catch (err) {
      if (err.code === 'licence_invalid' && this.autoRepin && !repin && !this.embeddedKeys.length) return this.refresh({ repin: true });
      throw err;
    }
    this.secure.set('licence', { ...lic, publicKey: key, fetchedAt: new Date(this.now()).toISOString() });
    return this.status();
  }

  /** What the app should believe right now, computed from the stored licence only (works offline). */
  status() {
    const c = this.cached();
    const none = { state: 'none', plan: 'free', features: [], meetingsPerMonth: null, canRecord: false, daysLeft: 0, renewDue: false };
    if (!c) return none;
    let claims;
    try {
      claims = this._verify(c.token, c.publicKey);
    } catch (err) {
      return { ...none, state: err.code === 'licence_expired' ? 'expired' : 'invalid', plan: c.plan, features: c.features || [] };
    }
    const nowMs = this.now();
    const daysLeft = Math.max(0, Math.ceil((claims.exp * 1000 - nowMs) / DAY));
    const renewDue = new Date(c.renew_after).getTime() <= nowMs;
    return {
      state: renewDue ? 'renew' : 'ok',
      plan: claims.plan,
      features: claims.features || [],
      meetingsPerMonth: claims.meetings_per_month ?? null,
      seats: claims.seats || 1,
      subscriptionStatus: c.status,
      canRecord: true,
      daysLeft,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      renewDue,
    };
  }
}

module.exports = { verifyLicence, LicenceManager };
