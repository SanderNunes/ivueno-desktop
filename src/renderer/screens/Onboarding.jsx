import React, { useEffect, useRef, useState } from 'react';
import Icon, { Logo } from '../components/Icon.jsx';
import LangSelect from '../components/LangSelect.jsx';
import { Button, Field } from '../components/ui.jsx';
import Auth from './Auth.jsx';
import { useApp } from '../lib/app-context.js';
import { useT } from '../lib/i18n.js';
import { call } from '../lib/bridge.js';
import { listMics, startMeter } from '../lib/audio.js';

const STEP_KEYS = ['welcome', 'check', 'data', 'finish', 'mic', 'signin', 'ready'];

/** First run: seven short steps, in the language chosen at the bottom left (Português by default). */
export default function Onboarding({ onDone }) {
  const { settings, patchSettings, auth, refreshAuth, info } = useApp();
  const t = useT();
  const [step, setStep] = useState(auth.signedIn ? 5 : 0);
  const next = () => setStep((s) => Math.min(STEP_KEYS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const key = STEP_KEYS[step];
  const signingIn = key === 'signin' && !auth.signedIn;

  return (
    <div className="wizard">
      <nav className="wizard-steps" aria-label="Passos">
        <div className="row" style={{ gap: 10, fontSize: 17, fontWeight: 700 }}><Logo size={26} />ivuenu</div>
        <ol>
          {STEP_KEYS.map((k, i) => (
            <li key={k} aria-current={i === step ? 'step' : undefined}>
              {i < step ? <Icon name="check" size={16} stroke={2.2} style={{ color: 'var(--success)' }} /> : <span className="step-dot" />}{t(`steps.${k}`)}
            </li>
          ))}
        </ol>
        <div style={{ marginTop: 'auto' }}><LangSelect id="wiz-lang" /></div>
      </nav>
      <div className={`wizard-main ${signingIn ? 'centered' : ''}`}>
        {key === 'welcome' && <Welcome t={t} onNext={next} />}
        {key === 'check' && <Check t={t} lang={settings.appLanguage} onNext={next} onBack={back} />}
        {key === 'data' && <Where t={t} onNext={next} onBack={back} />}
        {key === 'finish' && <Finishing t={t} lang={settings.appLanguage} onNext={next} onBack={back} />}
        {key === 'mic' && <Mic t={t} settings={settings} patch={patchSettings} onNext={next} onBack={back} />}
        {key === 'signin' && (auth.signedIn
          ? <div className="col" style={{ gap: 24, flex: 1 }}><h1 className="display">{t('steps.signin')}</h1><p className="muted">{t('auth.alreadySigned')}</p><Nav t={t} onNext={next} /></div>
          : <div className="col" style={{ gap: 16, alignItems: 'center', width: '100%' }}>
            <Auth initialMode="signup" onDone={async () => { await refreshAuth(); next(); }} />
            <Button variant="ghost" onClick={back}>{t('common.back')}</Button>
          </div>)}
        {key === 'ready' && (
          <div className="col" style={{ gap: 24, flex: 1 }}>
            <div className="col" style={{ gap: 6 }}><h1 className="display">{t('ready.title')}</h1><p className="muted" style={{ maxWidth: 520 }}>{t('ready.body')}</p></div>
            <div style={{ marginTop: 'auto' }}><Button variant="primary" size="lg" onClick={onDone}>{t('ready.go')}</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}

const Nav = ({ t, onBack, onNext, nextLabel, disabled }) => (
  <div className="row" style={{ marginTop: 'auto', justifyContent: 'space-between' }}>
    {onBack ? <Button variant="ghost" size="lg" onClick={onBack}>{t('common.back')}</Button> : <span />}
    <Button variant="primary" size="lg" onClick={onNext} disabled={disabled}>{nextLabel || t('common.continue')}</Button>
  </div>
);

function Welcome({ t, onNext }) {
  return (
    <div className="col" style={{ gap: 24, flex: 1 }}>
      <div className="col" style={{ gap: 12 }}>
        <h1 className="display">{t('welcome.title')}</h1>
        <p className="muted" style={{ maxWidth: 520, fontSize: 16, lineHeight: '26px' }}>{t('welcome.body')}</p>
      </div>
      <ul className="col" style={{ margin: 0, padding: 0, listStyle: 'none', gap: 10 }}>
        {['welcome.p1', 'welcome.p2', 'welcome.p3'].map((k) => (
          <li key={k} className="row" style={{ alignItems: 'flex-start', gap: 10 }}><Icon name="check" size={18} stroke={2.2} style={{ color: 'var(--accent)', marginTop: 2 }} />{t(k)}</li>
        ))}
      </ul>
      <Nav t={t} onNext={onNext} nextLabel={t('welcome.start')} />
    </div>
  );
}

function Check({ t, lang, onNext, onBack }) {
  const [items, setItems] = useState(null);
  const [micOk, setMicOk] = useState(false);
  useEffect(() => { call('system:check', { lang }).then(setItems); }, [lang]);
  async function giveMic() {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((x) => x.stop()); setMicOk(true); } catch { setMicOk(false); }
  }
  const iconFor = (it) => (it.state === 'ok' ? <Icon name="check" size={20} stroke={2} style={{ color: 'var(--success)' }} /> : it.id === 'mic' ? <Icon name="mic" size={20} /> : <Icon name="alert" size={20} stroke={1.8} style={{ color: 'var(--warning)' }} />);
  return (
    <div className="col" style={{ gap: 24, flex: 1 }}>
      <div className="col" style={{ gap: 6 }}><h1 className="display">{t('check.title')}</h1><p className="muted" style={{ maxWidth: 560 }}>{t('check.body')}</p></div>
      <ul className="check-list">
        {!items && <li><span /><span className="muted">{t('check.checking')}</span><span /></li>}
        {(items || []).map((it) => (
          <li key={it.id} style={{ alignItems: it.id === 'mic' ? 'center' : 'start' }}>
            {iconFor(it.id === 'mic' && micOk ? { ...it, state: 'ok' } : it)}
            <div className="col" style={{ gap: 4 }}><strong>{it.title}</strong><span className="muted">{it.id === 'mic' && micOk ? t('check.micOk') : it.text}</span></div>
            {it.id === 'mic' ? (micOk ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>OK</span> : <Button onClick={giveMic}>{t('check.giveMic')}</Button>)
              : <span style={{ fontSize: 12, fontWeight: 600, color: it.state === 'ok' ? 'var(--success)' : 'var(--warning)' }}>{it.badge}</span>}
          </li>
        ))}
      </ul>
      <Nav t={t} onBack={onBack} onNext={onNext} />
    </div>
  );
}

function Where({ t, onNext, onBack }) {
  return (
    <div className="col" style={{ gap: 24, flex: 1 }}>
      <h1 className="display">{t('data.title')}</h1>
      <div className="col" style={{ gap: 10 }}>
        <div className="radio-card on"><Icon name="laptop" size={20} stroke={1.8} /><span className="col" style={{ gap: 4 }}><strong>{t('data.local')}</strong><span style={{ fontSize: 13 }}>{t('data.localHint')}</span></span></div>
        <div className="radio-card on"><Icon name="shield" size={20} stroke={1.8} /><span className="col" style={{ gap: 4 }}><strong>{t('data.cloud')}</strong><span style={{ fontSize: 13 }}>{t('data.cloudHint')}</span></span></div>
        <span className="muted" style={{ fontSize: 12 }}>{t('data.later')}</span>
      </div>
      <Nav t={t} onBack={onBack} onNext={onNext} />
    </div>
  );
}

/** "Finishing setup": three real checks run one after the other (storage, preferences, engine), then Continue unlocks. */
function Finishing({ t, lang, onNext, onBack }) {
  const [done, setDone] = useState(0);
  const tasks = ['fin.storage', 'fin.prefs', 'fin.engine'];
  useEffect(() => {
    let dead = false;
    const pause = () => new Promise((r) => setTimeout(r, 350));
    (async () => {
      await call('system:check', { lang }); await pause(); if (dead) return; setDone(1);
      await call('settings:get'); await pause(); if (dead) return; setDone(2);
      await call('model:status'); await pause(); if (dead) return;
      setDone(3);
    })().catch(() => { if (!dead) setDone(3); });
    return () => { dead = true; };
  }, [lang]);
  const finished = done >= tasks.length;
  return (
    <div className="col" style={{ gap: 24, flex: 1 }}>
      <div className="col" style={{ gap: 6 }}><h1 className="display">{t('fin.title')}</h1><p className="muted" style={{ maxWidth: 520 }}>{t('fin.body')}</p></div>
      <ul className="check-list" aria-live="polite">
        {tasks.map((k, i) => (
          <li key={k} style={{ alignItems: 'center', gridTemplateColumns: '24px minmax(0, 1fr)' }}>
            {i < done ? <Icon name="check" size={20} stroke={2} style={{ color: 'var(--success)' }} /> : i === done ? <span className="spinner" aria-hidden="true" /> : <span className="step-dot" />}
            <span style={{ fontWeight: i === done ? 600 : 400, color: i > done ? 'var(--text-3)' : 'var(--text)' }}>{t(k)}</span>
          </li>
        ))}
      </ul>
      {finished && <span className="row" style={{ gap: 6, color: 'var(--success)', fontWeight: 600 }}><Icon name="check" size={16} stroke={2.2} />{t('fin.done')}</span>}
      <Nav t={t} onBack={onBack} onNext={onNext} disabled={!finished} />
    </div>
  );
}

function Mic({ t, settings, patch, onNext, onBack }) {
  const [mics, setMics] = useState([]);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const meter = useRef(null);
  useEffect(() => { listMics().then(setMics); }, []);
  useEffect(() => {
    let dead = false;
    startMeter({ micId: settings.micId, captureSystem: false, onLevels: ({ mic }) => { setLevel(mic); if (mic > 0.35) setHeard(true); } })
      .then((m) => { if (dead) m.stop(); else meter.current = m; });
    return () => { dead = true; if (meter.current) meter.current.stop(); };
  }, [settings.micId]);
  const on = Math.round(level * 20);
  return (
    <div className="col" style={{ gap: 24, flex: 1 }}>
      <h1 className="display">{t('mic.title')}</h1>
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label={t('mic.title')} htmlFor="fr-mic">
          <select id="fr-mic" className="select" style={{ height: 40 }} value={settings.micId} onChange={(e) => patch({ micId: e.target.value })}>
            <option value="">{t('mic.default')}</option>
            {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <span style={{ fontSize: 13 }}>{t('mic.say')}</span>
        <div className="meter" role="meter" aria-label={t('mic.level')} aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
          {Array.from({ length: 20 }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
        </div>
        {heard && <span className="row" style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600, gap: 6 }}><Icon name="check" size={14} stroke={2.2} />{t('mic.heard')}</span>}
      </div>
      <Nav t={t} onBack={onBack} onNext={onNext} />
    </div>
  );
}
