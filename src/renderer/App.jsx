import React, { useCallback, useEffect, useRef, useState } from 'react';
import { translate } from './lib/i18n.js';
import { setFormatLang } from './lib/format.mjs';
import { setErrorLang } from './lib/errors.mjs';
import { AppContext } from './lib/app-context.js';
import { call, on, send } from './lib/bridge.js';
import { useRecState } from './lib/hooks.js';
import { startMeter, audioBus } from './lib/audio.js';
import { webmToPcm16 } from './lib/pcm.mjs';
import Sidebar from './components/Sidebar.jsx';
import { Banner, Toast, Button, Skeleton } from './components/ui.jsx';
import Auth from './screens/Auth.jsx';
import LangSelect from './components/LangSelect.jsx';
import Onboarding from './screens/Onboarding.jsx';
import Home from './screens/Home.jsx';
import StartDialog from './screens/StartDialog.jsx';
import Live from './screens/Live.jsx';
import Detail from './screens/Detail.jsx';
import Tasks from './screens/Tasks.jsx';
import Search from './screens/Search.jsx';
import Settings from './screens/Settings.jsx';
import Plans from './screens/Plans.jsx';
import Checkout from './screens/Checkout.jsx';

export default function App() {
  const [boot, setBoot] = useState({ loading: true });
  const [settings, setSettings] = useState(null);
  const [route, setRoute] = useState({ name: 'home' });
  const [start, setStart] = useState(null);                 // null = closed, object = open with prefill
  const [message, setMessage] = useState('');
  const [audioErrors, setAudioErrors] = useState([]);
  const rec = useRecState();
  const lang = (settings && settings.appLanguage) || 'pt';
  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
  const toastTimer = useRef(null);

  const toast = useCallback((m) => {
    setMessage(m); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(''), 3000);
  }, []);

  const refreshAuth = useCallback(async () => {
    const [auth, onboarding, s, info] = await Promise.all([call('auth:status'), call('onboarding:get'), call('settings:get'), call('app:info')]);
    setSettings(s);
    setBoot({ loading: false, auth, onboarded: onboarding.done, info });
  }, []);

  useEffect(() => { refreshAuth().catch(() => setBoot({ loading: false, failed: true })); }, [refreshAuth]);
  useEffect(() => on('licence:changed', (licence) => setBoot((b) => (b.auth ? { ...b, auth: { ...b.auth, licence } } : b))), []);

  // Theme: "system" follows Windows; light/dark are forced.
  useEffect(() => {
    const root = document.documentElement;
    if (settings && settings.theme !== 'system') root.dataset.theme = settings.theme; else delete root.dataset.theme;
  }, [settings && settings.theme]);

  // words made outside React (dates, error messages) follow the language too
  setFormatLang(lang); setErrorLang(lang);
  useEffect(() => { if (settings) document.documentElement.lang = settings.appLanguage === 'en' ? 'en' : 'pt-AO'; }, [settings && settings.appLanguage]);

  const patchSettings = useCallback(async (patch) => { setSettings(await call('settings:patch', patch)); }, []);

  // Audio levels: measured here (the window that owns the microphone) while recording; paused = not listening.
  const isRec = !!rec && rec.phase === 'recording';
  const micId = settings && settings.micId;
  // Everybody in the room (place = room): there is no call to listen to, so the computer's sound is not captured; the voices are told apart afterwards.
  const place = (rec && rec.place) || 'both';
  const captureSystem = (settings ? settings.captureSystem : true) && place !== 'room';
  const archiveOn = !!(rec && rec.audioKept);                            // the audio of this meeting is kept on this computer for the accurate pass
  const recRef = useRef(null); recRef.current = rec;
  const audioFormat = (rec && rec.engine && rec.engine.audioFormat) || 'webm';
  const needsAudio = !!(rec && rec.engine && rec.engine.needsAudio);     // the cloud engine takes pieces of audio; the demo one only needs levels
  const meterRef = useRef(null);
  useEffect(() => {
    if (!isRec) return undefined;
    let stopped = false; let meter = null;
    startMeter({
      micId, captureSystem, onLevels: (l) => { send('rec:levels', l); audioBus.emit(l); },
      onChunk: needsAudio ? (chunk) => call('audio:chunk', chunk).catch(() => {}) : null, format: audioFormat,
      onBlock: archiveOn ? (block) => call('audio:block', block).catch(() => {}) : null, offsetMs: recRef.current ? recRef.current.elapsedMs : 0,
      expectSystem: place === 'online', onWarn: (w) => setAudioErrors((e) => (e.includes(w) ? e : [...e, w])),
    }).then((m) => { if (stopped) m.stop(); else { meter = m; meterRef.current = m; setAudioErrors(m.errors); } });
    return () => {
      stopped = true; meterRef.current = null; if (meter) meter.stop();
      setAudioErrors([]); send('rec:levels', { mic: 0, sys: 0 }); audioBus.emit({ mic: 0, sys: 0 });
    };
  }, [isRec, micId, captureSystem, needsAudio, audioFormat, archiveOn, place]);
  // The accurate pass asks this window to decode a block of kept audio (Chromium has the decoders) so the voices can be told apart.
  useEffect(() => on('refine:decode', async ({ reqId, data }) => {
    try {
      const bytes = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      await call('refine:decoded', { reqId, pcm: new Uint8Array(await webmToPcm16(bytes)) });
    } catch { await call('refine:decoded', { reqId, error: true }).catch(() => {}); }
  }), []);
  // Stopping: the main process asks for the last seconds of sound before it closes the recording.
  useEffect(() => on('audio:flush', async () => {
    try { if (meterRef.current) await meterRef.current.flush(); } finally { call('audio:flushed').catch(() => {}); }
  }), []);

  // Dictation: the hotkey is handled by the main process; this window only measures the microphone while it listens.
  const [dictating, setDictating] = useState(false);
  useEffect(() => on('dictation:state', (d) => setDictating(d.phase === 'listening')), []);
  useEffect(() => {
    if (!dictating || isRec) return undefined;          // while recording, the meter above already feeds the island
    let stopped = false; let meter = null;
    // one long piece: the main process asks for it when the hotkey is pressed again (the cleanup below stops the microphone)
    startMeter({ micId, captureSystem: false, onLevels: (l) => send('dictation:levels', l), onChunk: (c) => call('dictation:audio', c).catch(() => {}), format: 'pcm16', chunkMs: 110000, pauseCut: false })
      .then((m) => { if (stopped) m.stop(); else meter = m; });
    return () => { stopped = true; if (meter) meter.stop(); send('dictation:levels', { mic: 0, sys: 0 }); };
  }, [dictating, isRec, micId]);

  const nav = useCallback((name, params = {}) => setRoute({ name, ...params }), []);
  const openStart = useCallback((prefill = {}) => setStart(prefill), []);
  const logout = useCallback(async () => {
    try { await call('auth:logout'); await refreshAuth(); setRoute({ name: 'home' }); } catch (e) { toast(e.message); }
  }, [refreshAuth, toast]);

  if (boot.loading || !settings) {
    return <Frame><div className="center-page"><div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}><Skeleton h={20} w={120} /><Skeleton /><Skeleton w="70%" /></div></div></Frame>;
  }
  if (boot.failed) return <Frame><div className="center-page"><Banner tone="error" role="alert">{t("Não foi possível iniciar a Ivuenu. Fecha e abre outra vez.")}</Banner></div></Frame>;

  const ctx = {
    settings, patchSettings, auth: boot.auth, info: boot.info, refreshAuth, rec, route, nav, openStart, toast, logout, audioErrors,
  };

  if (!boot.onboarded) {
    return <AppContext.Provider value={ctx}><Frame><Onboarding onDone={async () => { await call('onboarding:done'); await refreshAuth(); }} /></Frame><Toast message={message} /></AppContext.Provider>;
  }
  if (!boot.auth.signedIn) {
    return <AppContext.Provider value={ctx}><Frame><div className="center-page"><Auth onDone={refreshAuth} /><LangSelect id="auth-lang" compact /></div></Frame><Toast message={message} /></AppContext.Provider>;
  }

  const lic = boot.auth.licence;
  const idle = !rec || rec.phase === 'idle' || rec.phase === 'done';
  const screens = {
    home: <Home />, live: <Live />, detail: <Detail key={route.id} />, tasks: <Tasks />, search: <Search />, settings: <Settings />, plans: <Plans />, checkout: <Checkout key={`${route.plan || ''}${route.resume ? 'r' : ''}${route.switchMethod ? 's' : ''}`} />,
  };

  return (
    <AppContext.Provider value={ctx}>
      <Frame>
      <div className="shell">
        <Sidebar />
        <main className="main" id="main">
          {idle && (lic.state === 'renew' || lic.state === 'expired' || lic.state === 'invalid') && (
            <div style={{ padding: '12px clamp(16px, 4vw, 56px) 0' }}>
              <Banner tone="warn" action={<Button size="sm" onClick={() => call('licence:refresh').then((s) => setBoot((b) => ({ ...b, auth: { ...b.auth, licence: s } }))).catch((e) => toast(e.message))}>{t("Verificar agora")}</Button>}>
                {lic.state === 'expired' || lic.state === 'invalid'
                  ? t('Liga-te à internet para continuar a usar a Ivuenu. As tuas reuniões continuam todas aqui.')
                  : t(lic.daysLeft === 1 ? 'Liga-te à internet para continuar a usar a Ivuenu. Falta {n} dia. As tuas reuniões continuam todas aqui.' : 'Liga-te à internet para continuar a usar a Ivuenu. Faltam {n} dias. As tuas reuniões continuam todas aqui.', { n: lic.daysLeft })}
              </Banner>
            </div>
          )}
          {screens[route.name] || screens.home}
        </main>
        {start && <StartDialog prefill={start} onClose={() => setStart(null)} onStarted={() => { setStart(null); nav('live'); }} />}
        <Toast message={message} />
      </div>
      </Frame>
    </AppContext.Provider>
  );
}

/** One rounded window: our title bar on top, the whole screen content below. No cards-in-a-window. */
function Frame({ children }) {
  return <div className="app-frame"><div className="drag-strip" aria-hidden="true" /><div className="app-body">{children}</div></div>;
}
