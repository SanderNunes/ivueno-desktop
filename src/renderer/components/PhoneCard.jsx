import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog, Field, Seg } from './ui.jsx';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

const NETWORKS = [
  { id: 'wifi', label: 'Só com Wi-Fi' },
  { id: 'any', label: 'Wi-Fi e dados móveis' },
  { id: 'manual', label: 'Só quando eu pedir' },
];

/** Settings › Sincronização: link a phone (QR code) and say when the phone may send. Only once sync is on. */
export default function PhoneCard() {
  const t = useT();
  const { toast } = useApp();
  const { data: s } = useQuery('sync:status', null, { kinds: ['sync'] });
  const [network, setNetwork] = useState(null);
  const [linking, setLinking] = useState(false);
  const on = !!(s && s.eligible && s.enabled);

  useEffect(() => { if (on) call('sync:prefs:get').then((p) => setNetwork(p.network)).catch(() => setNetwork('wifi')); }, [on]);
  if (!on) return null;

  async function choose(id) {
    const before = network;
    setNetwork(id);
    try { await call('sync:prefs:set', { network: id }); toast(t('Guardado.')); } catch (e) { setNetwork(before); toast(friendly(e)); }
  }

  return (
    <section id="phone" className="card" aria-labelledby="st-phone">
      <h2 id="st-phone">{t('Telemóvel')}</h2>
      <p>{t('Liga a app do telemóvel à tua sincronização lendo um código QR. Não precisas de escrever a frase-passe no telemóvel.')}</p>
      <div className="row"><Button variant="primary" onClick={() => setLinking(true)}>{t('Ligar um telemóvel')}</Button></div>
      <Field label={t('Quando o telemóvel envia')} hint={t('As notas são pequenas. Esta regra aplica-se também ao áudio, quando o telemóvel o enviar.')}>
        <Seg label={t('Quando o telemóvel envia')} value={network || 'wifi'} onChange={choose} options={NETWORKS.map((n) => ({ id: n.id, label: t(n.label) }))} />
      </Field>
      {linking && <PairDialog onClose={() => setLinking(false)} />}
    </section>
  );
}

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function PairDialog({ onClose }) {
  const t = useT();
  const { toast } = useApp();
  const [made, setMade] = useState(null);                       // { link, expiresAt, qrSvg }
  const [state, setState] = useState('starting');                // starting | waiting | joined | done | expired | error
  const [device, setDevice] = useState('');
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const finished = useRef(false);

  async function start() {
    setState('starting'); setError(''); setMade(null);
    try { const r = await call('sync:pair:start'); setMade(r); setLeft(r.expiresAt - Date.now()); setState('waiting'); } catch (e) { setError(friendly(e)); setState('error'); }
  }
  useEffect(() => { start(); return () => { if (!finished.current) call('sync:pair:cancel').catch(() => {}); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state !== 'waiting' && state !== 'joined') return undefined;
    let alive = true;
    const look = async () => {
      try {
        const r = await call('sync:pair:status');
        if (!alive) return;
        if (r.state === 'joined') { setDevice(r.device || ''); setState('joined'); }
        else if (r.state === 'expired' || r.state === 'none') setState('expired');
        else if (r.state === 'done') { finished.current = true; setState('done'); }
      } catch { /* offline: try again */ }
    };
    const poll = setInterval(look, 2000);
    const tick = setInterval(() => made && setLeft(made.expiresAt - Date.now()), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, [state, made]);

  async function accept() {
    setBusy(true); setError('');
    try { await call('sync:pair:accept'); finished.current = true; setState('done'); toast(t('Telemóvel ligado.')); } catch (e) { setError(friendly(e)); }
    setBusy(false);
  }
  async function refuse() { await call('sync:pair:cancel').catch(() => {}); finished.current = true; onClose(); }

  const copy = async () => { try { await navigator.clipboard.writeText(made.link); toast(t('Copiado')); } catch { /* clipboard blocked */ } };

  return (
    <Dialog title={t('Ligar um telemóvel')} onClose={onClose}>
      <div className="dialog-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        {state === 'starting' && <span className="muted" role="status">{t('Um momento…')}</span>}
        {state === 'error' && <><Banner tone="error" role="alert">{error}</Banner><Button onClick={start}>{t('Tentar outra vez')}</Button></>}
        {state === 'waiting' && made && (
          <>
            <p>{t('Abre a app Ivuenu no telemóvel, entra na tua conta e lê este código.')}</p>
            {made.qrSvg
              ? <img alt={t('Código QR para ligar o telemóvel')} width="220" height="220" style={{ background: '#fff', borderRadius: 8 }} src={`data:image/svg+xml;utf8,${encodeURIComponent(made.qrSvg)}`} />
              : (
                <div className="col" style={{ gap: 8, width: '100%' }}>
                  <span className="muted" style={{ fontSize: 13 }}>{t('Não foi possível desenhar o código. Copia esta ligação para a app do telemóvel:')}</span>
                  <input className="input mono" readOnly value={made.link} aria-label={t('Ligação para o telemóvel')} onFocus={(e) => e.target.select()} />
                  <div><Button size="sm" onClick={copy}>{t('Copiar')}</Button></div>
                </div>
              )}
            <span className="muted" style={{ fontSize: 13 }}>{t('O código vale {time}. Não o mostres a ninguém.', { time: mmss(left) })}</span>
          </>
        )}
        {state === 'joined' && (
          <>
            <p><strong>{device ? `“${device}”` : t('Um telemóvel')}</strong> {t('quer ligar-se à tua sincronização. Só aceites se for o teu telemóvel.')}</p>
            {error && <Banner tone="error" role="alert">{error}</Banner>}
            <div className="row" style={{ gap: 8 }}>
              <Button onClick={refuse}>{t('Recusar')}</Button>
              <Button variant="primary" disabled={busy} onClick={accept}>{busy ? t('Um momento…') : t('Aceitar')}</Button>
            </div>
          </>
        )}
        {state === 'done' && <><p><strong>{t('Telemóvel ligado.')}</strong></p><p className="muted">{t('As tuas reuniões e notas vão aparecer nele.')}</p><Button variant="primary" onClick={onClose}>{t('Fechar')}</Button></>}
        {state === 'expired' && <><p>{t('O código expirou.')}</p><Button variant="primary" onClick={start}>{t('Gerar outro')}</Button></>}
      </div>
    </Dialog>
  );
}
