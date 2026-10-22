import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Banner, Button, Dialog } from './ui.jsx';
import { call, on } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

const mb = (bytes) => Math.round(bytes / 1e6);

/**
 * The voice model: a small file (40 MB) that lets the app tell the voices of an imported recording apart ("Orador 1, 2…") on this computer.
 * One-time download, only after the person agrees (the main process refuses without that), resumable, verified before it is used.
 * It is optional: without it an import still works, with every line given to one speaker.
 */
export default function VoiceModelCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let dead = false;
    call('voices:status').then((s) => { if (!dead) setSt(s); }).catch(() => {});
    const off = on('voices:progress', (s) => { if (!dead) setSt(s); });
    return () => { dead = true; off(); };
  }, []);

  if (!st) return null;

  async function start() {
    setAsking(false); setProblem('');
    try { setSt(await call('voices:download', { consent: 'confirmed' })); } catch (e) { setProblem(friendly(e)); }
  }
  const pause = () => call('voices:cancel', {}).then(setSt).catch(() => {});

  return (
    <div className="col" style={{ gap: 10 }}>
      {st.state === 'ready' && (
        <div className="row" style={{ gap: 8 }}><Icon name="check" size={18} stroke={2} style={{ color: 'var(--success)' }} /><span>{t('Reconhecimento de vozes instalado.')}</span></div>
      )}
      {(st.state === 'missing' || st.state === 'error') && (
        <>
          <span className="muted" style={{ fontSize: 13 }}>{t('Para separar as vozes, a Ivuenu precisa de um modelo pequeno ({mb} MB), transferido uma só vez. Funciona neste computador.', { mb: st.sizeMb })}</span>
          {st.state === 'error' && <Banner tone="warn" role="alert">{errorText(st.error, t)}</Banner>}
          {problem && <Banner tone="warn" role="alert">{problem}</Banner>}
          <div className="row"><Button onClick={() => setAsking(true)}>{st.partial > 0 ? t('Continuar a transferência') : t('Transferir ({mb} MB)', { mb: st.sizeMb })}</Button></div>
        </>
      )}
      {st.state === 'downloading' && (
        <>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.progress * 100)} aria-label={t('Transferência do modelo de voz')}>
            <div style={{ width: `${Math.round(st.progress * 100)}%` }} />
          </div>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }} aria-live="polite">{t('{done} de {total} MB', { done: mb(st.downloaded), total: mb(st.total) })} · {Math.round(st.progress * 100)}%</span>
            <Button size="sm" onClick={pause}>{t('Pausar')}</Button>
          </div>
        </>
      )}
      {(st.state === 'verifying' || st.state === 'extracting') && (
        <div className="row" style={{ gap: 10 }} role="status"><span className="spinner" aria-hidden="true" /><span>{t('A verificar o ficheiro…')}</span></div>
      )}
      {asking && (
        <Dialog title={t('Transferir o modelo de vozes?')} onClose={() => setAsking(false)}>
          <div className="dialog-body">
            <p>{t('Vamos transferir {mb} MB de {host}. Fica guardado neste computador. O ficheiro é verificado antes de ser usado, e se a transferência parar pode ser retomada.', { mb: st.sizeMb, host: st.host })}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setAsking(false)}>{t('Agora não')}</Button>
              <Button variant="primary" onClick={start}>{t('Transferir')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function errorText(error, t) {
  switch (error && error.code) {
    case 'offline': return t('Sem ligação à internet. O que já foi transferido fica guardado.');
    case 'checksum': return t('O ficheiro transferido estava corrompido e foi apagado. Tenta outra vez.');
    case 'disk_full': return t('Não há espaço livre suficiente no disco.');
    default: return t('A transferência falhou. Tenta outra vez mais tarde.');
  }
}
