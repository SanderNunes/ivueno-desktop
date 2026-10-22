/**
 * Client for the Ivuenu backend (backend/openapi.json). Keeps the sign-in tokens, refreshes the short-lived access
 * token once when a call is refused, and turns the backend's error envelope into one Error shape:
 * { code, message, status, details }. Errors that mean "no network" use code 'offline'.
 */
class ApiClient {
  constructor({ getBase, secure, fetchImpl = globalThis.fetch, deviceName = 'Ivuenu desktop' }) {
    this.getBase = getBase;
    this.secure = secure;
    this.fetch = fetchImpl;
    this.deviceName = deviceName;
    this.refreshing = null;
  }

  tokens() { return this.secure.get('tokens') || null; }
  signedIn() { return !!this.tokens(); }

  async _send(method, path, { body, rawBody, contentType, binary = false, query, auth = true, headers = {} } = {}) {
    const url = new URL(path, this.getBase());
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    const h = { Accept: 'application/json', ...headers };
    if (rawBody !== undefined) h['Content-Type'] = contentType || 'application/octet-stream';
    else if (body !== undefined) h['Content-Type'] = 'application/json';
    const tok = auth ? this.tokens() : null;
    if (tok) h.Authorization = `Bearer ${tok.access_token}`;
    let res;
    try {
      res = await this.fetch(url, { method, headers: h, body: rawBody !== undefined ? rawBody : (body === undefined ? undefined : JSON.stringify(body)) });
    } catch (cause) {
      const e = new Error('Sem ligação ao servidor da Ivuenu.');
      e.code = 'offline'; e.status = 0; e.cause = cause;
      throw e;
    }
    if (binary && res.ok) return { data: Buffer.from(await res.arrayBuffer()), version: Number(res.headers.get('etag')) || 0 };
    const type = res.headers.get('content-type') || '';
    const payload = type.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
    if (!res.ok) {
      const env = payload && payload.error ? payload.error : {};
      const e = new Error(env.message || `Erro ${res.status}`);
      e.code = env.code || `http_${res.status}`; e.status = res.status; e.details = env.details || null;
      throw e;
    }
    return payload;
  }

  async request(method, path, opts = {}) {
    try {
      return await this._send(method, path, opts);
    } catch (err) {
      if (err.status === 401 && opts.auth !== false && this.tokens() && !opts._retried) {
        const ok = await this._refresh();
        if (ok) return this.request(method, path, { ...opts, _retried: true });
      }
      throw err;
    }
  }

  async _refresh() {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const tok = this.tokens();
        if (!tok) return false;
        try {
          const next = await this._send('POST', '/v1/auth/refresh', { body: { refresh_token: tok.refresh_token }, auth: false });
          this.secure.set('tokens', next);
          return true;
        } catch (err) {
          if (err.code !== 'offline') this.secure.set('tokens', null);     // refused = signed out; offline = try again later
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  // --- account ---------------------------------------------------------------------------------

  async register({ email, password, name, locale = 'pt', timezone = 'Africa/Luanda' }) {
    await this._send('POST', '/v1/auth/register', { auth: false, body: { email, password, name, locale, timezone } });
    return this.login({ email, password });
  }

  async login({ email, password }) {
    const tok = await this._send('POST', '/v1/auth/login', { auth: false, body: { email, password, device: this.deviceName } });
    this.secure.set('tokens', tok);
    return this.me();
  }

  async logout() {
    const tok = this.tokens();
    try { if (tok) await this._send('POST', '/v1/auth/logout', { body: { refresh_token: tok.refresh_token } }); } catch { /* signing out locally is enough */ }
    this.secure.set('tokens', null);
  }

  forgotPassword(email) { return this._send('POST', '/v1/auth/forgot-password', { auth: false, body: { email } }); }
  // Choosing the new password happens on the page the email links to; this call is for tests and tools.
  resetPassword({ token, newPassword }) {
    return this._send('POST', '/v1/auth/reset-password', { auth: false, body: { token, new_password: newPassword } });
  }

  verifyEmail(token) { return this._send('POST', '/v1/auth/verify-email', { auth: false, body: { token } }); }
  resendVerification() { return this.request('POST', '/v1/auth/resend-verification'); }

  me() { return this.request('GET', '/v1/me'); }
  patchMe(patch) { return this.request('PATCH', '/v1/me', { body: patch }); }
  changePassword(current_password, new_password) { return this.request('POST', '/v1/me/password', { body: { current_password, new_password } }); }
  devices() { return this.request('GET', '/v1/auth/devices'); }
  endDevice(id) { return this.request('DELETE', `/v1/auth/devices/${encodeURIComponent(id)}`); }

  async deleteAccount() {
    await this.request('DELETE', '/v1/me');
    this.secure.set('tokens', null);
  }

  // --- plans and licence -----------------------------------------------------------------------

  plans() { return this.request('GET', '/v1/plans', { auth: false }); }
  licence() { return this.request('GET', '/v1/licence'); }
  reportMeeting({ client_id, started_at }) { return this.request('POST', '/v1/usage/meetings', { body: { client_id, started_at } }); }
  licencePublicKey() { return this.request('GET', '/v1/licence/public-key', { auth: false }); }
  // --- encrypted sync (the server only ever sees ciphertext) ------------------------------------

  syncKey() { return this.request('GET', '/v1/sync/key'); }
  putSyncKey(body) { return this.request('PUT', '/v1/sync/key', { body }); }
  syncList(after = 0) { return this.request('GET', '/v1/sync/items', { query: { after, limit: 200 } }); }
  syncGet(id) { return this.request('GET', `/v1/sync/items/${encodeURIComponent(id)}`, { binary: true }); }
  syncPut(id, buffer, basedOn, occurredAt) {
    return this.request('PUT', `/v1/sync/items/${encodeURIComponent(id)}`, { rawBody: buffer, headers: { 'If-Match': String(basedOn), ...(occurredAt ? { 'X-Occurred-At': occurredAt } : {}) } });
  }
  syncDelete(id) { return this.request('DELETE', `/v1/sync/items/${encodeURIComponent(id)}`); }
  syncWipe() { return this.request('DELETE', '/v1/sync'); }
  syncUsage() { return this.request('GET', '/v1/sync/usage'); }
  // linking a phone, and the person's rules for when the phone sends
  syncPairCreate(pub) { return this.request('POST', '/v1/sync/pairings', { body: { pub } }); }
  syncPairGet(id) { return this.request('GET', `/v1/sync/pairings/${encodeURIComponent(id)}`); }
  syncPairSeal(id, sealed) { return this.request('PUT', `/v1/sync/pairings/${encodeURIComponent(id)}/sealed`, { body: { sealed } }); }
  syncPairDelete(id) { return this.request('DELETE', `/v1/sync/pairings/${encodeURIComponent(id)}`); }
  syncPrefsGet() { return this.request('GET', '/v1/sync/prefs'); }
  syncPrefsPut(network) { return this.request('PUT', '/v1/sync/prefs', { body: { network } }); }

  // --- cloud tier: transcription and stronger notes; the server keeps nothing -----------------

  /** `quality: 'best'` asks for the accurate model (a whole meeting, after it ended); `preview: true` marks a live piece whose meeting gets that accurate pass (not counted against the minutes). */
  cloudTranscribe(buffer, mime, seconds, language, prompt, { quality, preview } = {}) {
    return this.request('POST', '/v1/cloud/transcribe', { rawBody: buffer, contentType: mime, query: { language, prompt, ...(quality === 'best' ? { quality } : {}), ...(preview ? { preview: 'true' } : {}) }, headers: { 'X-Audio-Seconds': String(seconds.toFixed(2)) } });
  }
  cloudUsage() { return this.request('GET', '/v1/cloud/usage'); }
  cloudNotes(body) { return this.request('POST', '/v1/cloud/notes', { body }); }
  cloudAsk(body) { return this.request('POST', '/v1/cloud/ask', { body }); }
  cloudRecipe(body) { return this.request('POST', '/v1/cloud/recipe', { body }); }
  cloudSummarize(body) { return this.request('POST', '/v1/cloud/summarize', { body }); }
  cloudEmail(body) { return this.request('POST', '/v1/cloud/email', { body }); }
  cloudClassify(body) { return this.request('POST', '/v1/cloud/classify', { body }); }

  // --- company sign-in (SSO) and the organisation screens ------------------------------------

  ssoDiscover(email) { return this._send('GET', '/v1/sso/discover', { auth: false, query: { email } }); }
  ssoStart(orgId) { return this._send('POST', '/v1/sso/start', { auth: false, body: { org_id: orgId, device: this.deviceName } }); }
  ssoPoll(pollToken) { return this._send('POST', '/v1/sso/poll', { auth: false, body: { poll_token: pollToken } }); }

  joinWaitlist(email, plan) { return this._send('POST', '/v1/waitlist', { auth: false, body: { email, plan } }); }
  checkout(plan, seats = 1, org_id, period = 'month') { return this.request('POST', '/v1/billing/checkout', { body: { plan, seats, period, ...(org_id ? { org_id } : {}) } }); }
  billingHistory() { return this.request('GET', '/v1/billing/payments'); }
  billingMethods() { return this.request('GET', '/v1/billing/methods'); }
  billingSubscription() { return this.request('GET', '/v1/billing/subscription'); }
  billingIntent(id) { return this.request('GET', `/v1/billing/intents/${encodeURIComponent(id)}`); }
  createAttempt(intentId, method, phone, scenario) {
    return this.request('POST', `/v1/billing/intents/${encodeURIComponent(intentId)}/attempts`, { body: { method, ...(phone ? { phone } : {}), ...(scenario ? { scenario } : {}) } });
  }
  attempt(intentId, attemptId, refresh = false) {
    const base = `/v1/billing/intents/${encodeURIComponent(intentId)}/attempts/${encodeURIComponent(attemptId)}`;
    return refresh ? this.request('POST', `${base}/refresh`) : this.request('GET', base);
  }
  cancelAttempt(intentId, attemptId) { return this.request('POST', `/v1/billing/intents/${encodeURIComponent(intentId)}/attempts/${encodeURIComponent(attemptId)}/cancel`); }
}

module.exports = { ApiClient };
