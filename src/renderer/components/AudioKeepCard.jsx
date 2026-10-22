import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog, Field, Switch } from './ui.jsx';
import { call, on } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

const KEEP = [['off', 'Não guardar'], ['final', 'Até a transcrição melhorada estar pronta'], ['7d', '7 dias'], ['30d', '30 dias']];
const size = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** Settings › Gravação: whether the audio of a meeting stays on this computer, for how long, and whether the accurate pass runs by itself. */
export default function AudioKeepCard() {
  const t = useT();
  const { settings, patchSettings, toast } = useApp();
  const [usage, setUsage] = useState(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const load = () => call('audio:usage').then(setUsage).catch(() => {});
  useEffect(() => { load(); return on('data:changed', () => load()); }, []);

  async function wipe() {
    setAsking(false); setError('');
    try { await call('audio:deleteAll'); toast(t('Áudio apagado.')); load(); } catch (e) { setError(friendly(e)); }
  }

  const off = settings.audioKeep === 'off';
  return (
    <section id="audio" className="card" aria-labelledby="st-audio">
      <h2 id="st-audio">{t('Áudio guardado neste computador')}</h2>
      <Field label={t('Guardar o áudio das reuniões')} htmlFor="st-keep" hint={t('Fica só neste computador. Serve para melhorar a transcrição depois da reunião e para confirmares uma frase ouvindo o que foi dito.')}>
        <select id="st-keep" className="select" style={{ maxWidth: 360 }} value={settings.audioKeep} onChange={(e) => patchSettings({ audioKeep: e.target.value })}>
          {KEEP.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
        </select>
      </Field>
      <Switch checked={settings.refineAuto !== false && !off} disabled={off} onChange={(v) => patchSettings({ refineAuto: v })} label={t('Melhorar a transcrição depois de cada reunião')}
        hint={t('Envia o áudio guardado, em blocos, para uma transcrição mais exata, separa as vozes e escreve as notas outra vez. Precisa de internet.')} />
      <p className="muted" style={{ fontSize: 13 }}>
        {off ? t('Sem áudio guardado, a transcrição ao vivo é a final e conta para os teus minutos.')
          : t('Com o áudio guardado, a transcrição ao vivo é só uma pré-visualização e não gasta os teus minutos: conta a transcrição melhorada.')}
      </p>
      {error && <Banner tone="error" role="alert">{error}</Banner>}
      <div className="row wrap" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <span className="muted" style={{ fontSize: 13 }}>{usage ? (usage.meetings ? t('{n} reuniões com áudio guardado, {size}.', { n: usage.meetings, size: size(usage.bytes) }) : t('Nenhum áudio guardado.')) : ''}</span>
        <Button variant="danger" disabled={!usage || !usage.meetings} onClick={() => setAsking(true)}>{t('Apagar todo o áudio')}</Button>
      </div>
      {asking && (
        <Dialog title={t('Apagar todo o áudio?')} onClose={() => setAsking(false)}>
          <div className="dialog-body">
            <p>{t('Apaga o áudio guardado de todas as reuniões. As transcrições e as notas ficam. Já não será possível melhorar a transcrição dessas reuniões.')}</p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setAsking(false)}>{t('Cancelar')}</Button>
              <Button variant="danger" onClick={wipe}>{t('Apagar o áudio')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
