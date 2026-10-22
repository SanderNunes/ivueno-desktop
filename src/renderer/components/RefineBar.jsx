import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog } from './ui.jsx';
import VoiceModelCard from './VoiceModelCard.jsx';
import { call, on } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

const WHY = {
  offline: 'Sem ligação à internet. Tenta outra vez quando estiveres online.',
  cloud_minutes_exhausted: 'Os minutos de transcrição deste mês acabaram.',
  plan_required: 'O teu plano não inclui transcrição.',
  cloud_disabled_by_policy: 'A tua empresa não permite a transcrição na nuvem.',
  no_text: 'Não foi percebida fala no áudio guardado.',
  too_little_text: 'A segunda transcrição encontrou muito menos texto do que a primeira, por isso ficou a primeira.',
  interrupted: 'A transcrição foi interrompida porque a aplicação fechou. Tenta outra vez.',
  no_audio: 'O áudio desta reunião já não está guardado.',
};
const STAGE = { transcribing: 'A melhorar a transcrição…', voices: 'A separar as vozes…', notes: 'A escrever as notas outra vez…' };
const size = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** On a meeting: the state of the accurate pass over its kept audio, and what the person can do about it. Nothing when there is no audio and no pass. */
export default function RefineBar({ m }) {
  const t = useT();
  const { toast } = useApp();
  const [prog, setProg] = useState(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => on('refine:progress', (p) => { if (p.id === m.id) setProg(p.done ? null : p); }), [m.id]);

  const r = m.refine;
  const kept = !!m.audio;
  const running = !!prog || !!(r && r.state === 'running');
  if (!kept && !r) return null;

  async function start() {
    setBusy(true);
    try { await call('refine:start', { id: m.id }); } catch (e) { toast(friendly(e)); }
    setBusy(false);
  }
  async function remove() {
    setAsking(false);
    try { await call('audio:delete', { id: m.id }); toast(t('Áudio apagado.')); } catch (e) { toast(friendly(e)); }
  }

  if (running) {
    const pct = prog && prog.totalMs ? Math.min(99, Math.round((prog.doneMs / prog.totalMs) * 100)) : null;
    return (
      <Banner tone="info" role="status">
        <span className="body">{t(STAGE[(prog && prog.stage) || 'transcribing'])}{prog && prog.stage === 'transcribing' && pct != null ? ` ${pct}%` : ''}{' '}
          <span className="muted">{t('Podes continuar a usar a Ivuenu.')}</span></span>
      </Banner>
    );
  }

  const failed = r && r.state === 'failed';
  const done = r && r.state === 'done';
  return (
    <div className="col" style={{ gap: 10 }}>
      {failed && <Banner tone="warn" role="status"><span className="body">{t(WHY[r.error] || 'Não foi possível melhorar a transcrição. Tenta outra vez.')}</span></Banner>}
      {done && r.voiceState === 'model_missing' && (
        <Banner tone="info" role="status"><span className="body">{t('Para separar as vozes das pessoas, falta o modelo de vozes (40 MB, uma só vez). Depois de o transferires, carrega em “Melhorar transcrição”.')}</span></Banner>
      )}
      {done && r.voiceState === 'model_missing' && <VoiceModelCard />}
      <div className="row wrap" style={{ gap: '6px 12px', fontSize: 13 }}>
        {done && <span className="tag ok">{t('Transcrição melhorada')}</span>}
        {done && r.voices > 1 && <span className="tag">{t('{n} vozes separadas', { n: r.voices })}</span>}
        {kept && <span className="muted">{t('Áudio guardado neste computador')}{m.audio.keepUntil ? ` ${t('até')} ${new Date(m.audio.keepUntil).toLocaleDateString('pt-PT')}` : ''}{m.audioBytes ? ` · ${size(m.audioBytes)}` : ''}</span>}
        {kept && <Button size="sm" disabled={busy} onClick={start}>{failed ? t('Tentar outra vez') : done ? t('Melhorar de novo') : t('Melhorar transcrição')}</Button>}
        {kept && <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>{t('Apagar áudio')}</Button>}
      </div>
      {asking && (
        <Dialog title={t('Apagar o áudio desta reunião?')} onClose={() => setAsking(false)}>
          <div className="dialog-body">
            <p>{t('A transcrição e as notas ficam. Já não será possível melhorar a transcrição desta reunião.')}</p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setAsking(false)}>{t('Cancelar')}</Button>
              <Button variant="danger" onClick={remove}>{t('Apagar o áudio')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
