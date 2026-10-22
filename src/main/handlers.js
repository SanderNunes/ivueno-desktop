const calendar = require('./calendar');
const exporter = require('./export');

const BUILTIN_RECIPES = [
  { id: 'suggest-reply', name: 'Sugere o que dizer', view: 'live', builtin: true },
  { id: 'catch-up', name: 'Põe-me a par', view: 'live', builtin: true },
  { id: 'explain', name: 'Explica isso', view: 'live', builtin: true },
  { id: 'good-questions', name: 'Perguntas a fazer', view: 'live', builtin: true },
  { id: 'tldr', name: 'Versão curta', view: 'done', builtin: true },
  { id: 'decisions', name: 'Decisões', view: 'done', builtin: true },
  { id: 'unanswered', name: 'Perguntas sem resposta', view: 'done', builtin: true },
  { id: 'shorter', name: 'Notas mais curtas', view: 'done', builtin: true },
  { id: 'blind-spots', name: 'Pontos cegos', view: 'done', builtin: true, paid: true },
  { id: 'coach', name: 'Treina-me', view: 'done', builtin: true, paid: true },
];

// The only addresses the organisation screens may call: /v1/orgs, one organisation, its members/invites (and one of each), its policy, audit log,
// company sign-in settings and directory token, and accepting an invite. Nothing deeper, nothing outside /v1/orgs.
const ORG_PATH = /^\/v1\/orgs(\/(invites\/accept|[A-Za-z0-9_-]+(\/(members|invites)(\/[A-Za-z0-9_-]+)?|\/(policy|audit|sso|scim-token)|\/sso\/test)?))?$/;

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Every call the UI can make. Plain functions over injected services, so the whole layer is testable without Electron.
 * ctx: { repo, session, engine, api, licence, secure, services }
 * services: { gpuInfo(), freeDiskBytes(), openExternal(url), saveFile(name, buf, filters), writeClipboard(text),
 *             printPdf(html), fetchText(url), wipeLocal() , setTheme(t), setIsland(on) }
 */
function createHandlers(ctx) {
  const { repo, session, engine, api, licence, secure, services, sync, pairing, archive, refiner } = ctx;
  const { qrSvg } = require('./qr');
  const { STYLES, transcriptText, notesText } = require('./engine/summarize');
  const { TONES, material, hasMaterial } = require('./engine/email');
  const { parseRecipients, buildMailto, cleanLine } = require('./mail');
  const usage = ctx.usage || { report: async () => {}, flush: async () => {}, serverUsed: () => 0 };
  // The monthly count is the larger of this PC's own and the server's, so a reinstall cannot reset it.
  const usedThisMonth = () => Math.max(repo.meetingsThisMonth(), usage.serverUsed());

  const nameOfMeeting = (m) => (key) => repo.speakerName(m, key);
  const lic = () => licence.status();
  const isPaid = () => lic().plan !== 'free';

  /** What goes into an exported file (export.js): the person's choices, with safe defaults. */
  function exportOptions(m, { includeTranscript = false, include, brand = false } = {}) {
    const pick = (k, dflt) => (include && typeof include[k] === 'boolean' ? include[k] : dflt);
    return {
      includeTranscript: !!includeTranscript, nameOf: nameOfMeeting(m), brand: !!brand,
      include: { summary: pick('summary', true), mine: pick('mine', true), ai: pick('ai', true), tasks: pick('tasks', true), transcript: pick('transcript', !!includeTranscript) },
    };
  }

  /** One meeting as a file: { name, data, filters } for the save dialog. */
  async function renderFile(m, format, opts, paper) {
    const base = (m.title || 'reuniao').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'reuniao';
    switch (format) {
      case 'md': return { name: `${base}.md`, data: Buffer.from(exporter.toMarkdown(m, opts), 'utf8'), filters: [{ name: 'Markdown', extensions: ['md'] }] };
      case 'docx': return { name: `${base}.docx`, data: exporter.toDocx(m, opts), filters: [{ name: 'Word', extensions: ['docx'] }] };
      case 'pdf': return { name: `${base}.pdf`, data: await services.printPdf(exporter.toHtml(m, opts), { paper: paper === 'Letter' ? 'Letter' : 'A4' }), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      default: throw fail('invalid', 'Formato desconhecido.');
    }
  }

  function view(m) {
    if (!m) return null;
    const speakers = Object.entries(m.speakers).map(([key, s]) => {
      const display = repo.speakerName(m, key);
      return { key, name: s.name, display, color: s.color, isMe: !!s.isMe, initials: key === 'spk_me' ? initials((secure.get('user') || {}).name || 'Tu') : initials(display) };
    }).sort((a, b) => a.color - b.color);
    const { _hidden, liveSegments, ...rest } = m;
    return {
      ...rest, hiddenDetails: _hidden || 0, hasLiveVersion: !!liveSegments, audioBytes: archive && m.audio ? archive.bytes(m.id) : 0, speakers,
      segments: m.segments.map((s) => ({ ...s, who: repo.speakerName(m, s.speakerKey) })),
    };
  }

  function gate() {
    const l = lic();
    if (l.state === 'none') throw fail('licence_missing', 'Entra na tua conta para começares a gravar.');
    if (!l.canRecord) throw fail('licence_expired', 'Liga-te à internet para continuar a usar a Ivuenu.');
    const limit = l.meetingsPerMonth;
    if (limit != null && usedThisMonth() >= limit) {
      throw fail('limit_reached', `Usaste ${limit} de ${limit} reuniões este mês.`, { limit });
    }
  }

  function tasksMailto(m) {
    const open = m.tasks.filter((t) => !t.hidden);
    const body = open.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text} (${t.owner || 'Sem dono'}, ${t.due || 'Sem prazo'})`).join('\n');
    const to = m.attendees.map((a) => a.email).filter(Boolean).join(',');
    return `mailto:${encodeURI(to)}?subject=${encodeURIComponent(`Tarefas: ${m.title || 'Reunião'}`)}&body=${encodeURIComponent(body)}`;
  }

  async function calendarText() {
    const url = secure.get('calendarUrl');
    if (!url) return null;
    return services.fetchText(url.replace(/^webcal:/i, 'https:'));
  }

  const H = {
    // --- app ---------------------------------------------------------------------------------
    'app:info': async () => ({
      version: ctx.version || '0.0.0', platform: process.platform,
      engine: { id: engine.id, label: engine.label, realTranscription: engine.realTranscription, needsAudio: !!engine.needsAudio, audioFormat: engine.audioFormat || 'webm' },
    }),
    'settings:get': async () => repo.settings(),
    'settings:patch': async (patch) => {
      const next = repo.patchSettings(patch || {});
      if ('theme' in (patch || {})) services.setTheme(next.theme);
      if ('island' in (patch || {})) services.setIsland(next.island);
      if (['dictation', 'hotkeyDictation', 'hotkeyIsland'].some((k) => k in (patch || {}))) services.applyHotkeys();
      return next;
    },
    'hotkeys:status': async () => services.hotkeyStatus(),
    'dictation:state': async () => ctx.dictation.snapshot(),
    'dictation:toggle': async () => ctx.dictation.toggle(),
    'dictation:audio': async (chunk) => { ctx.dictation.receiveAudio(chunk); return { ok: true }; },
    'onboarding:get': async () => ({ done: repo.onboarded() }),
    'onboarding:done': async () => { repo.setOnboarded(true); return { done: true }; },
    'shell:openExternal': async (url) => {
      if (!/^(https:|mailto:)/i.test(String(url))) throw fail('blocked', 'Só abrimos ligações https e mailto.');
      await services.openExternal(url);
    },

    // --- this computer ---------------------------------------------------------------------
    'system:check': async (arg) => {
      const en = arg && arg.lang === 'en';
      const gpu = await services.gpuInfo();
      const free = await services.freeDiskBytes();
      const gb = (b) => Math.round(b / 1e9);
      return [
        gpu.hasDiscreteGpu
          ? { id: 'gpu', state: 'ok', badge: 'OK',
            title: en ? 'Graphics card found' : 'Placa gráfica encontrada',
            text: en ? `${gpu.name || 'GPU'}. Transcription runs fast.` : `${gpu.name || 'GPU'}. A transcrição corre depressa.` }
          : { id: 'gpu', state: 'warn', badge: en ? 'Works' : 'Funciona',
            title: en ? 'No graphics card found' : 'Placa gráfica não encontrada',
            text: en ? 'Transcription will be slower. Notes for a 1-hour meeting take about 8 minutes instead of 2.'
              : 'A transcrição vai ser mais lenta. As notas de uma reunião de 1 hora ficam prontas em cerca de 8 minutos, em vez de 2.' },
        free > 5e9
          ? { id: 'disk', state: 'ok', badge: 'OK', title: en ? 'Disk space' : 'Espaço em disco',
            text: en ? `${gb(free)} GB free. We need about 50 MB per hour of meeting.` : `${gb(free)} GB livres. Precisamos de cerca de 50 MB por hora de reunião.` }
          : { id: 'disk', state: 'warn', badge: en ? 'Careful' : 'Atenção', title: en ? 'Low disk space' : 'Pouco espaço em disco',
            text: en ? `${gb(free)} GB free. Free some space before long recordings.` : `${gb(free)} GB livres. Liberta espaço antes de gravações longas.` },
        { id: 'mic', state: 'todo', badge: '', title: en ? 'Microphone access' : 'Acesso ao microfone',
          text: en ? 'Windows will ask for permission.' : 'O Windows vai pedir autorização.' },
      ];
    },
    'model:status': async () => engine.modelStatus(),
    // the voice model (40 MB, only needed to tell the voices of an imported recording apart): the person agrees to the download in the screen, which then sends consent: 'confirmed'
    'voices:status': async () => ctx.voiceModels.status(),
    'voices:download': async ({ consent } = {}) => {
      if (consent !== 'confirmed') throw fail('consent_required', 'Confirma a transferência primeiro.');
      ctx.voiceModels.start();
      return ctx.voiceModels.status();
    },
    'voices:cancel': async ({ discard } = {}) => { await ctx.voiceModels.cancel({ discard: !!discard }); return ctx.voiceModels.status(); },

    // --- account -----------------------------------------------------------------------------
    'auth:status': async () => ({
      signedIn: api.signedIn(), user: secure.get('user') || null, licence: lic(),
    }),
    'auth:login': async ({ email, password }) => {
      const user = await api.login({ email, password });
      secure.set('user', user);
      await licence.refresh({ repin: true }).catch((e) => { if (e.code !== 'offline') throw e; });
      return { user, licence: lic() };
    },
    'auth:register': async ({ email, password, name }) => {
      const user = await api.register({ email, password, name });
      secure.set('user', user);
      await licence.refresh({ repin: true }).catch((e) => { if (e.code !== 'offline') throw e; });
      return { user, licence: lic() };
    },
    // Forgotten password: ask for a code by email, then choose a new password with it. Never says if the email exists.
    'auth:forgot': async ({ email }) => { await api.forgotPassword(String(email || '').trim()); return { sent: true }; },
    'auth:resendVerification': async () => { await api.resendVerification(); return { sent: true }; },
    'auth:refreshUser': async () => { const user = await api.me(); secure.set('user', user); return user; },
    'auth:logout': async () => {
      if (session.phase === 'recording' || session.phase === 'paused') throw fail('recording', 'Pára a gravação antes de sair da conta.');
      await api.logout(); licence.clear(); secure.set('user', null);
      return { signedIn: false };
    },
    'auth:updateProfile': async (patch) => { const user = await api.patchMe(patch); secure.set('user', user); return user; },
    'auth:changePassword': async ({ current, next }) => { await api.changePassword(current, next); return { ok: true }; },
    'auth:devices': async () => api.devices(),
    'auth:endDevice': async (id) => { await api.endDevice(id); return { ok: true }; },
    'auth:deleteAccount': async () => {
      if (session.phase === 'recording' || session.phase === 'paused') throw fail('recording', 'Pára a gravação antes de apagar a conta.');
      await api.deleteAccount();
      await services.wipeLocal();
      return { deleted: true };
    },
    'licence:status': async () => lic(),
    'licence:refresh': async () => { await usage.flush().catch(() => {}); return licence.refresh(); },
    'plans:list': async () => api.plans(),
    // company sign-in: the browser does the signing in, the app polls for the result (see backend/app/sso.py)
    'sso:discover': async ({ email }) => api.ssoDiscover(String(email || '').trim()),
    'sso:start': async ({ orgId }) => {
      const r = await api.ssoStart(orgId);
      if (!/^https?:\/\//i.test(r.url)) throw fail('blocked', 'Endereço de início de sessão inválido.');
      await services.openExternal(r.url);
      return { pollToken: r.poll_token, expiresIn: r.expires_in };
    },
    'sso:poll': async ({ pollToken }) => {
      let r;
      try { r = await api.ssoPoll(pollToken); } catch (e) {
        if (e.code === 'sso_failed') return { status: 'failed', reason: (e.details && e.details.reason) || '' };
        if (e.code === 'sso_expired') return { status: 'expired' };
        throw e;
      }
      if (r.status !== 'done') return { status: 'pending' };
      secure.set('tokens', r.tokens);
      const user = await api.me();
      secure.set('user', user);
      await licence.refresh({ repin: true }).catch((e) => { if (e.code !== 'offline') throw e; });
      return { status: 'done', user, licence: lic() };
    },
    // organisation screens: the renderer may only reach /v1/orgs (members, invites, rules, audit, directory and company sign-in settings)
    'org:list': async () => api.request('GET', '/v1/orgs'),
    'app:copy': async (text) => { await services.writeClipboard(String(text || '').slice(0, 2000)); return { copied: true }; },
    'org:call': async ({ method = 'GET', path, body, query }) => {
      if (!ORG_PATH.test(String(path || '')) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        throw fail('blocked', 'Pedido não permitido.');
      }
      return api.request(method, path, { body, query });
    },
    'org:auditExport': async ({ orgId, format }) => {
      const f = format === 'json' ? 'json' : 'csv';
      const { data } = await api.request('GET', `/v1/orgs/${encodeURIComponent(orgId)}/audit/export`, { query: { format: f }, binary: true });
      return services.saveFile(`ivuenu-auditoria.${f}`, data, [{ name: f.toUpperCase(), extensions: [f] }]);
    },
    // audio for engines that need it (the cloud engine), and the cloud minutes
    'audio:chunk': async (chunk) => { session.feedAudio(chunk); return { ok: true }; },
    // A long block of the meeting's audio, kept on this computer (never uploaded by itself) for the accurate pass.
    'audio:block': async ({ source, startMs, seconds, data }) => {
      const id = session.meetingId; const m = id && repo.getMeeting(id);
      if (!archive || !m || !m.audio || !m.audio.keep || (session.phase !== 'recording' && session.phase !== 'paused')) return { ok: false };
      const r = archive.add(id, { source, startMs, seconds, data });
      repo.updateMeeting(id, { audio: { ...m.audio, blocks: r.blocks, bytes: r.bytes } });
      return { ok: true };
    },
    // Improve a meeting's transcript from its kept audio. Returns at once; progress comes as 'refine:progress' and the result is on the meeting (meeting.refine).
    'refine:start': async ({ id }) => {
      if (!refiner || !archive) throw fail('unavailable', 'Isto não está disponível.');
      if (!repo.getMeeting(id)) throw fail('not_found', 'Reunião não encontrada.');
      if (!archive.has(id)) throw fail('no_audio', 'O áudio desta reunião já não está guardado.');
      if (refiner.state().running) throw fail('refine_busy', 'Já há uma transcrição a ser melhorada.');
      refiner.run(id).catch(() => {});
      return { started: true };
    },
    'refine:status': async () => (refiner ? refiner.state() : { running: false }),
    'refine:decoded': async ({ reqId, pcm, error }) => { if (ctx.decodeReply) ctx.decodeReply(reqId, pcm, error); return { ok: true }; },
    'audio:delete': async ({ id }) => {
      if (refiner && refiner.state().running && refiner.state().id === id) throw fail('refine_busy', 'Espera que a transcrição acabe de ser melhorada.');
      if (archive) archive.remove(id);
      if (repo.getMeeting(id)) { repo.updateMeeting(id, { audio: null, liveSegments: null }); repo.addConsent(id, 'audio_deleted', 'O áudio guardado neste computador foi apagado.'); }
      return { ok: true };
    },
    'audio:usage': async () => (archive ? archive.usage() : { meetings: 0, bytes: 0 }),
    'audio:deleteAll': async () => {
      if (!archive) return { ok: true };
      for (const id of archive.ids()) { if (refiner && refiner.state().running && refiner.state().id === id) continue; archive.remove(id); if (repo.getMeeting(id)) repo.updateMeeting(id, { audio: null, liveSegments: null }); }
      return { ok: true, ...archive.usage() };
    },
    'audio:flushed': async () => { if (services.audioFlushed) services.audioFlushed(); return { ok: true }; },
    'cloud:usage': async () => api.cloudUsage(),
    // encrypted copy of meetings in the account (see sync.js)
    // `eligible`: the plan includes sync (the paid ones). The app asks the person to turn it on; it cannot do it alone (it needs their passphrase).
    'sync:status': async () => ({ ...(await sync.status({ withUsage: true })), eligible: (lic().features || []).includes('sync') }),
    // Linking a phone: the QR code is drawn here (its link holds a secret that must not go through the server); the person approves the phone.
    'sync:pair:start': async () => { const r = await pairing.start(); let qr = null; try { qr = await qrSvg(r.link); } catch { /* shown as text instead */ } return { ...r, qrSvg: qr }; },
    'sync:pair:status': async () => pairing.status(),
    'sync:pair:accept': async () => pairing.accept(),
    'sync:pair:cancel': async () => { await pairing.cancel(); return { ok: true }; },
    'sync:prefs:get': async () => api.syncPrefsGet(),
    'sync:prefs:set': async ({ network }) => api.syncPrefsPut(network),
    'sync:enable': async ({ passphrase }) => sync.enable(passphrase),
    'sync:disable': async () => sync.disable(),
    'sync:now': async () => sync.syncNow(),
    'sync:wipeCloud': async () => sync.wipeCloud(),
    'billing:checkout': async ({ plan, period }) => api.checkout(plan, 1, undefined, period),
    'billing:methods': async () => api.billingMethods(),
    'billing:waiting': async () => (await api.billingSubscription()).pending_intent,
    'billing:summary': async () => api.billingSubscription(),
    'billing:history': async () => api.billingHistory(),
    'billing:intent': async ({ intentId }) => api.billingIntent(intentId),
    'billing:pay': async ({ intentId, method, phone, scenario }) => api.createAttempt(intentId, method, phone, scenario),
    'billing:cancel': async ({ intentId, attemptId }) => api.cancelAttempt(intentId, attemptId),
    // A hosted checkout opens in the person's own browser, and only if it is a page on WiPay's own host (the server checked it too).
    'billing:openCheckout': async ({ url }) => {
      let u; try { u = new URL(String(url)); } catch { throw fail('blocked', 'Ligação inválida.'); }
      if (u.protocol !== 'https:' || u.hostname !== 'hosted.wipay.ao') throw fail('blocked', 'Só abrimos a página de pagamento da WiPay.');
      await services.openExternal(u.toString());
      return { opened: true };
    },
    // The server decides whether it was paid. When it says so, fetch the new licence so the app unlocks at once.
    'billing:attempt': async ({ intentId, attemptId, refresh }) => {
      const r = await api.attempt(intentId, attemptId, !!refresh);
      if (r.intent.status === 'paid') await licence.refresh().catch(() => {});
      return r;
    },
    'billing:waitlist': async ({ plan }) => { const me = await api.me(); await api.joinWaitlist(me.email, plan); return { ok: true }; },
    'usage:get': async () => ({ used: usedThisMonth(), limit: lic().meetingsPerMonth }),

    // --- meetings ---------------------------------------------------------------------------
    'meetings:list': async (filter) => repo.listMeetings(filter || {}),
    'meetings:get': async (id) => view(repo.getMeeting(id)),
    'meetings:patch': async ({ id, patch }) => view(repo.updateMeeting(id, patch)),
    'meetings:delete': async (id) => {
      if (session.meetingId === id && (session.phase === 'recording' || session.phase === 'paused')) throw fail('recording', 'Pára a gravação antes de apagar a reunião.');
      repo.deleteMeeting(id); return { ok: true };
    },
    'meetings:interrupted': async () => repo.interrupted(),
    'notes:setMine': async ({ id, text }) => ({ savedAt: repo.setMyNotes(id, text) }),
    'notes:generate': async (id) => { await session.generateNotes(id); return view(repo.getMeeting(id)); },
    'recipes:list': async () => ({ builtin: BUILTIN_RECIPES, mine: repo.listRecipes(), paid: isPaid() }),
    'recipes:save': async (input) => {
      if (!isPaid()) throw fail('plan_required', 'Receitas próprias estão incluídas no Pro.', { plan: 'pro' });
      return repo.saveRecipe(input);
    },
    'recipes:delete': async (id) => repo.deleteRecipe(id),
    'recipes:run': async ({ id, recipeId, live }) => {
      const recipe = BUILTIN_RECIPES.find((r) => r.id === recipeId) || repo.listRecipes().find((r) => r.id === recipeId);
      if (!recipe) throw fail('not_found', 'Receita desconhecida.');
      if (recipe.paid && !isPaid()) throw fail('plan_required', `${recipe.name} está no Pro.`, { plan: 'pro' });
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      if (!recipe.builtin) return { text: 'Receitas próprias precisam do motor de IA local, que ainda não está instalado.', unavailable: true };
      return engine.runRecipe(m, recipeId, { live: !!live }, nameOfMeeting(m));
    },
    'chat:ask': async ({ id, question }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      repo.pushChat(id, { role: 'user', text: question });
      const answer = await engine.ask(m, question, nameOfMeeting(m));
      repo.pushChat(id, { role: 'assistant', text: answer.text, cite: answer.cite || '' });
      return view(repo.getMeeting(id));
    },
    // Summaries. 'meeting': the whole conversation (or, when its transcript was not kept, the notes); save:true stores it as the meeting's summary.
    'meetings:summarize': async ({ id, style = 'normal', save = false, language }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      const nameOf = nameOfMeeting(m);
      const fromTranscript = (m.segments || []).length > 0;
      const text = fromTranscript ? transcriptText(m, nameOf) : notesText(m);
      if (!text.trim()) throw fail('nothing_to_summarize', 'Ainda não há nada para resumir nesta reunião.');
      const lang = language || (repo.settings().appLanguage === 'en' ? 'en' : 'pt');
      const out = await engine.summarize({ scope: 'meeting', title: m.title, text, style: STYLES.includes(style) ? style : 'normal', language: lang, meeting: m }, nameOf);
      if (save) repo.updateMeeting(id, { summary: out.text.slice(0, 2000) });
      return { ...out, basis: fromTranscript ? 'transcript' : 'notes', saved: !!save };
    },
    // 'notes': only what the person wrote (the text in the box, even if not saved yet).
    'notes:summarize': async ({ id, text, style = 'short', language }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      const source = String(text === undefined ? m.myNotes : text).slice(0, 60000);
      if (source.trim().length < 20) throw fail('nothing_to_summarize', 'As tuas notas são curtas demais para resumir.');
      const lang = language || (repo.settings().appLanguage === 'en' ? 'en' : 'pt');
      return engine.summarize({ scope: 'notes', title: m.title, text: source, style: STYLES.includes(style) ? style : 'short', language: lang, meeting: m }, nameOfMeeting(m));
    },
    // Import an audio file (see importer.js): the window decodes it and sends it in pieces.
    'import:begin': async (input) => ctx.importer.begin(input || {}),
    'import:piece': async ({ id, startMs, durationMs, mime, data }) => { await ctx.importer.piece(id, { startMs, durationMs, mime, data }); return { ok: true }; },
    'import:pcm': async ({ id, data }) => { ctx.importer.pcm(id, { data }); return { ok: true }; },
    'import:finish': async ({ id }) => { const r = await ctx.importer.finish(id); return { meeting: view(r.meeting), voices: r.voices, voicesError: r.voicesError }; },
    'import:cancel': async ({ id }) => { await ctx.importer.cancel(id); return { ok: true }; },
    'import:available': async () => ({ ready: engine.canTranscribeFile(), voices: !!(ctx.voices && ctx.voices.available()), voiceModel: ctx.voiceModels ? ctx.voiceModels.status() : null }),
    'tasks:overview': async (opts) => repo.tasksOverview(opts || {}),
    'tasks:add': async ({ id, text, owner, due }) => repo.addTask(id, text, { owner, due }),
    'tasks:patch': async ({ id, taskId, patch }) => repo.patchTask(id, taskId, patch),
    'speakers:rename': async ({ id, key, name }) => { repo.renameSpeaker(id, key, name); return view(repo.getMeeting(id)); },
    'feedback:set': async ({ id, value }) => { repo.setFeedback(id, value); return { ok: true }; },
    'folders:list': async () => repo.listFolders(),
    'folders:create': async (name) => repo.createFolder(name),
    'folders:rename': async ({ id, name }) => { repo.renameFolder(id, name); return repo.listFolders(); },
    'folders:delete': async (id) => { repo.deleteFolder(id); return repo.listFolders(); },
    'search:run': async (q) => { const r = repo.search(q); if (r.total) repo.rememberSearch(q); return r; },

    // --- export -----------------------------------------------------------------------------
    'export:run': async ({ id, format, includeTranscript, include, paper, brand }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      const opts = exportOptions(m, { includeTranscript, include, brand });
      if (format === 'copy') { await services.writeClipboard(exporter.toText(m, opts)); return { copied: true }; }
      if (format === 'tasks-mail') { await services.openExternal(tasksMailto(m)); return { opened: true }; }
      const file = await renderFile(m, format, opts, paper);
      return services.saveFile(file.name, file.data, file.filters);
    },

    // The follow-up email: written by the AI when there is one, else assembled from the notes. Nothing is sent: the person edits it and opens it in their own email program.
    'meetings:draftEmail': async ({ id, tone = 'friendly', language = 'auto', includeTasks = true }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      if (!hasMaterial(material(m)) && !(m.segments || []).length) throw fail('nothing_to_write', 'Ainda não há notas para escrever o email.');
      const nameOf = nameOfMeeting(m);
      const names = (m.attendees || []).map((a) => a.name || a.email).filter(Boolean);
      const out = await engine.draftEmail({
        meeting: m, tone: TONES.includes(tone) ? tone : 'friendly', language: ['auto', 'pt', 'en'].includes(language) ? language : 'auto',
        includeTasks: !!includeTasks, senderName: (secure.get('user') || {}).name || '', attendeeNames: names,
      }, nameOf);
      return { ...out, to: parseRecipients((m.attendees || []).map((a) => a.email).filter(Boolean)).valid };
    },
    'mail:open': async ({ to, subject, body }) => {
      const { url, truncated } = buildMailto({ to, subject, body });
      if (truncated) await services.writeClipboard(String(body || '').slice(0, 20000));        // the whole text is on the clipboard, the email has the start
      await services.openExternal(url);
      return { opened: true, truncated };
    },

    // Sharing notes: who to send to (the people of the meeting and of the person's team), then a file + an email ready to send.
    'share:suggest': async ({ id }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      const me = String((secure.get('user') || {}).email || '').toLowerCase();
      const people = [];
      const add = (name, email, source, org) => { const e = String(email || '').trim(); if (e && e.toLowerCase() !== me && !people.some((p) => p.email.toLowerCase() === e.toLowerCase())) people.push({ name: name || e, email: e, source, ...(org ? { org } : {}) }); };
      for (const a of m.attendees || []) add(a.name, a.email, 'meeting');
      try {
        if (api.signedIn()) {
          for (const o of (await api.request('GET', '/v1/orgs')) || []) {
            for (const x of (await api.request('GET', `/v1/orgs/${encodeURIComponent(o.id)}/members`)) || []) add(x.name, x.email, 'team', o.name);
          }
        }
      } catch { /* offline or not in a team: the people of the meeting are enough */ }
      return people.slice(0, 200);
    },
    'share:send': async ({ id, format = 'pdf', include, paper = 'A4', brand = false, to = [], subject = '', message = '', openMail = true }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      if (!['pdf', 'docx', 'md'].includes(format)) throw fail('invalid', 'Formato desconhecido.');
      const opts = exportOptions(m, { include, brand });
      if (!opts.include.summary && !opts.include.mine && !opts.include.ai && !opts.include.tasks && !opts.include.transcript) throw fail('invalid', 'Escolhe pelo menos uma coisa para partilhar.');
      const recipients = parseRecipients(to);
      const file = await renderFile(m, format, opts, paper);
      const saved = await services.saveFile(file.name, file.data, file.filters);
      if (!saved.saved) return { saved: false };
      let mail = null;
      if (openMail) {
        const lines = [String(message || '').trim(), `Em anexo: ${saved.name}`, exporter.toEmailText(m, opts)].filter(Boolean);
        mail = buildMailto({ to: recipients.valid, subject: cleanLine(subject, 200) || m.title || 'Notas da reunião', body: lines.join('\n\n') });
        await services.openExternal(mail.url);
      }
      if (saved.path && services.revealFile) services.revealFile(saved.path);                  // the file, ready to drag into the email
      return { saved: true, name: saved.name, path: saved.path || '', mailOpened: !!mail, truncated: !!(mail && mail.truncated), invalid: recipients.invalid };
    },

    // Re-run the detection of the kind of meeting (the person's own choice is never changed by it).
    'meetings:detectType': async ({ id }) => {
      const m = repo.getMeeting(id);
      if (!m) throw fail('not_found', 'Reunião não encontrada.');
      const found = await engine.detectType(m, nameOfMeeting(m));
      if (found && found.key) repo.updateMeeting(id, { templateDetected: { key: found.key, confidence: found.confidence ?? 0, by: found.by || 'rules' } });
      return view(repo.getMeeting(id));
    },

    // --- recording --------------------------------------------------------------------------
    'rec:state': async () => session.snapshot(),
    'rec:start': async ({ input, consent }) => {
      gate();
      const start = { ...(input || {}) };
      const s = repo.settings();
      // The audio is kept on this computer only when the person allows it and the meeting keeps its transcript ("Só notas" keeps nothing).
      if (archive && s.audioKeep !== 'off' && (start.keepTranscript ?? s.keepTranscript)) start.audio = { keep: true, keepUntil: null, blocks: 0, bytes: 0 };
      const m = session.start(start, consent);
      usage.report(m).catch(() => {});                      // tell the server in the background; queued if offline
      return view(m);
    },
    'rec:pause': async () => { session.pause(); return session.snapshot(); },
    'rec:resume': async () => { session.resume(); return session.snapshot(); },
    'rec:stop': async () => { const m = await session.stop(); return view(m); },
    'rec:quickNote': async (text) => { session.quickNote(text); return { ok: true }; },
    'rec:resumeInterrupted': async (id) => { gate(); return view(session.resumeInterrupted(id)); },
    'rec:dismissInterrupted': async (id) => {
      const m = repo.getMeeting(id);
      if (m) repo.updateMeeting(id, { status: 'done', notesState: m.notesState === 'writing' ? 'none' : m.notesState, endedAt: m.endedAt || new Date().toISOString() });
      return { ok: true };
    },

    // --- calendar ---------------------------------------------------------------------------
    'calendar:status': async () => {
      const url = secure.get('calendarUrl');
      let host = '';
      try { host = new URL(url.replace(/^webcal:/i, 'https:')).hostname; } catch { /* not connected */ }
      return { connected: !!url, host };
    },
    'calendar:set': async (url) => {
      const clean = String(url || '').trim();
      if (!/^(https:|webcal:)/i.test(clean)) throw fail('invalid', 'O endereço do calendário tem de começar por https:// ou webcal://');
      const text = await services.fetchText(clean.replace(/^webcal:/i, 'https:'));
      if (!/BEGIN:VCALENDAR/.test(text)) throw fail('invalid', 'Este endereço não parece ser um calendário (.ics).');
      secure.set('calendarUrl', clean);
      return { connected: true };
    },
    'calendar:clear': async () => { secure.set('calendarUrl', null); return { connected: false }; },
    'calendar:upcoming': async () => {
      let text;
      try { text = await calendarText(); } catch { return { connected: true, error: true, events: [] }; }
      if (text === null) return { connected: false, events: [] };
      return { connected: true, events: calendar.upcoming(text, { hours: 48 }) };
    },
  };

  return H;
}

module.exports = { createHandlers, BUILTIN_RECIPES, initials };
