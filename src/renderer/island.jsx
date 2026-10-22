import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import { call, on, send } from './lib/bridge.js';
import { clockStr, setFormatLang } from './lib/format.mjs';
import { translate } from './lib/i18n.js';

const BARS = 22;
const h2 = (v) => `${Math.round(3 + v * 19)}px`;
const MIC = '#63C3A6';
const SYS = '#EDE9E3';
const QUIET = '#6B655C';

/** The recording island: always dark, always on top, never steals the keyboard. Shows what is being heard. */
function Island() {
  const [snap, setSnap] = useState(null);
  const [mode, setMode] = useState('collapsed');
  const [mic, setMic] = useState(Array(40).fill(0.04));
  const [sys, setSys] = useState(Array(40).fill(0.04));
  const [main, setMain] = useState(Array(BARS).fill(0.04));
  const [note, setNote] = useState('');
  const reduce = useRef(false);
  // The island is its own window: it reads the interface language from the settings (and follows changes).
  const [lang, setLang] = useState('pt');
  const t = (key, vars) => translate(lang, key, vars);
  useEffect(() => {
    const load = () => call('settings:get').then((s) => { setLang(s.appLanguage || 'pt'); setFormatLang(s.appLanguage); }).catch(() => {});
    load();
    return on('data:changed', (e) => { if (e.kind === 'settings' || e.kind === 'all') load(); });
  }, []);

  useEffect(() => {
    try { reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* default */ }
    call('rec:state').then(setSnap).catch(() => {});
    const offs = [
      on('rec:state', setSnap),
      on('island:mode', setMode),
      on('rec:levels', ({ mic: m, sys: s }) => {
        const push = (a, v) => a.slice(1).concat([Math.max(0.04, v)]);
        setMic((a) => push(a, m)); setSys((a) => push(a, s)); setMain((a) => push(a, Math.max(m, s)));
      }),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  const [dict, setDict] = useState({ phase: 'idle' });
  useEffect(() => {
    call('dictation:state').then(setDict).catch(() => {});
    return on('dictation:state', setDict);
  }, []);

  if (!snap) return null;

  // Dictation takes the island when nothing is being recorded: "A ouvir" with the real microphone bars.
  const recordingNow = snap.phase === 'recording' || snap.phase === 'paused';
  if (dict.phase !== 'idle' && !recordingNow) {
    const listening = dict.phase === 'listening';
    return (
      <div className="island-root">
        <div className="island pill" role="status" aria-live="polite" style={{ cursor: 'default' }}>
          {listening ? <span className="dot pulse" style={{ background: '#63C3A6' }} /> : <span className="dot sq" />}
          {listening ? (
            <>
              <span style={{ fontWeight: 600, color: '#8AD8BF' }}>{t('A ditar')}</span>
              <span className="waves" aria-hidden="true">{main.map((v, i) => <i key={i} style={{ height: reduce.current ? '3px' : h2(v), background: MIC }} />)}</span>
            </>
          ) : dict.phase === 'inserting' ? (
            <span className="ok-text" style={{ flex: 1 }}>{t('A transcrever…')}</span>
          ) : (
            <span className="warn" style={{ flex: 1 }}>{t(dict.message || 'O ditado falhou.')}</span>
          )}
        </div>
      </div>
    );
  }
  const phase = snap.phase;
  const h = (v, max) => `${Math.round(3 + v * (max - 3))}px`;
  const src = snap.source;
  const color = src === 'them' ? SYS : src === 'me' ? MIC : QUIET;
  const who = src === 'me' ? t('Tu') : src === 'them' ? t('Outros') : t('Silêncio');
  const dotClass = phase === 'paused' ? 'dot sq' : phase === 'done' || phase === 'writing' ? 'dot done' : 'dot pulse';
  const time = phase === 'done' ? `${Math.max(1, Math.round(snap.elapsedMs / 60000))} min` : clockStr(snap.elapsedMs);
  const label = phase === 'writing' ? t('A escrever as notas…') : phase === 'done' ? t('Notas prontas') : phase === 'paused' ? t('Em pausa') : snap.quiet ? t('Sem som') : '';

  if (mode === 'collapsed') {
    return (
      <div className="island-root">
        <button type="button" className="island pill" aria-expanded="false" aria-label={t(phase === 'paused' ? 'Em pausa, {time}. Abrir controlos' : 'A gravar, {time}. Abrir controlos', { time })}
          onClick={() => (phase === 'done' ? (send('island:open-main')) : send('island:expand'))} style={{ color: '#EDE9E3', textAlign: 'left' }}>
          <span className={dotClass} />
          <span className="time" style={{ minWidth: 64, color: phase === 'paused' ? '#A0998F' : '#EDE9E3' }}>{time}</span>
          {phase === 'recording' || phase === 'paused' ? (
            <span className="waves" aria-hidden="true">{main.map((v, i) => <i key={i} style={{ height: reduce.current || phase === 'paused' ? '3px' : h(v, 22), background: color }} />)}</span>
          ) : <span className="grow" />}
          {label ? <span className={phase === 'done' || phase === 'writing' ? 'ok-text' : 'warn'}>{label}</span>
            : <span className="src"><Icon2 src={src} />{who}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="island-root">
      <div className="island open" role="region" aria-label={t('Ivuenu a gravar')}>
        <div className="row" style={{ gap: 10 }}>
          <span className={dotClass} />
          <span style={{ fontWeight: 600, color: '#FF8A80' }}>{phase === 'paused' ? t('Em pausa') : phase === 'recording' ? t('A gravar') : label}</span>
          <span className="time">{time}</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{snap.title || t('Reunião sem título')}</span>
          <button type="button" className="icon-btn" aria-label={t('Recolher')} style={{ width: 28, height: 28, color: '#EDE9E3' }} onClick={() => send('island:collapse')}>▲</button>
        </div>
        <div className="tray">
          <span className="l">{t('Tu')}</span>
          <span className="waves" aria-hidden="true" style={{ height: 26 }}>{mic.map((v, i) => <i key={i} style={{ height: reduce.current ? '3px' : h(v, 26), background: MIC }} />)}</span>
          <span className="l">{t('Outros')}</span>
          <span className="waves" aria-hidden="true" style={{ height: 26 }}>{sys.map((v, i) => <i key={i} style={{ height: reduce.current ? '3px' : h(v, 26), background: SYS }} />)}</span>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { call('rec:quickNote', note.trim()); setNote(''); } }}>
          <label className="sr-only" htmlFor="il-note">{t('Nota rápida')}</label>
          <input id="il-note" placeholder={t('Nota rápida · Enter junta às tuas notas')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="ib" aria-label={phase === 'paused' ? t('Retomar') : t('Pausar')} onClick={() => call(phase === 'paused' ? 'rec:resume' : 'rec:pause')}>{phase === 'paused' ? '▶' : '❚❚'}</button>
          <button type="button" className="ib" aria-label={t('Abrir a Ivuenu')} onClick={() => send('island:open-main')}>↗</button>
          <button type="button" className="stop" onClick={() => call('rec:stop')} disabled={phase !== 'recording' && phase !== 'paused'}>■ {t('Parar')}</button>
        </form>
      </div>
    </div>
  );
}

function Icon2({ src }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true };
  if (src === 'me') return <svg {...common} stroke={MIC}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
  if (src === 'them') return <svg {...common} stroke={SYS}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
  return null;
}

createRoot(document.getElementById('root')).render(<Island />);
