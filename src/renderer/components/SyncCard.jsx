import React, { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog, Field } from './ui.jsx';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

const mb = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Settings › Privacy: the encrypted copy of meetings in the account, for using them on other computers. */
export default function SyncCard() {
  const t = useT();
  const { toast, nav } = useApp();
  const { data: s, reload } = useQuery('sync:status', null, { kinds: ['sync'] });
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  async function run(channel, arg, done) {
    setBusy(true); setError('');
    try { await call(channel, arg); if (done) toast(done); await reload(); } catch (e) { setError(friendly(e)); }
    setBusy(false);
  }
  if (!s) return null;

  if (s.eligible === false) {
    return (
      <section id="sync" className="card" aria-labelledby="st-sync">
        <h2 id="st-sync">{t('Sincronização e cópia de segurança')}</h2>
        <p>{t('Com um plano pago, as tuas reuniões ficam em todos os teus computadores, encriptadas: só tu as podes abrir.')}</p>
        <div className="row"><Button variant="primary" onClick={() => nav('plans')}>{t('Ver planos')}</Button></div>
      </section>
    );
  }

  return (
    <section id="sync" className="card" aria-labelledby="st-sync">
      <h2 id="st-sync">{t('Sincronização e cópia de segurança')}</h2>
      {!s.enabled ? (
        <>
          <p>{t('Guarda uma cópia das tuas reuniões na tua conta, encriptada neste computador. Só tu a podes abrir, com uma frase-passe que nós não guardamos. Serve para veres as reuniões noutros computadores.')}</p>
          <Banner tone="warn" icon="shield">{t('Se perderes a frase-passe, não conseguimos recuperar a cópia. As reuniões deste computador não são afetadas.')}</Banner>
          {error && <Banner tone="error" role="alert">{error}</Banner>}
          <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (pass) run('sync:enable', { passphrase: pass }, t('Cópia ligada.')).then(() => setPass('')); }}>
            <Field label={t('Frase-passe da cópia')} htmlFor="sync-pass" hint={t('Pelo menos 8 caracteres. Se já usas a cópia noutro computador, escreve a mesma frase-passe.')}>
              <input id="sync-pass" type="password" className="input" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            <div className="row"><Button type="submit" variant="primary" disabled={busy || pass.length < 8}>{busy ? t('Um momento…') : t('Ligar a cópia')}</Button></div>
          </form>
        </>
      ) : (
        <>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span className="col" style={{ gap: 2 }}>
              <strong>{t('Ligada')}{s.lastRun ? ` · ${t('última sincronização')} ${new Date(s.lastRun).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</strong>
              <span className="muted" style={{ fontSize: 13 }}>
                {s.pending ? t('{n} à espera de subir.', { n: s.pending }) : t('Tudo em dia.')}
                {s.usage ? ` ${t('{n} reuniões, {size}.', { n: s.usage.items, size: mb(s.usage.bytes) })}` : ''}
              </span>
            </span>
            <Button disabled={busy} onClick={() => run('sync:now')}>{busy ? t('Um momento…') : t('Sincronizar agora')}</Button>
          </div>
          {(s.lastError || error) && <Banner tone="warn">{error || s.lastError}</Banner>}
          <p className="muted" style={{ fontSize: 13 }}>{t('Para uma reunião ficar só neste computador, abre-a e escolhe “Não sincronizar”. Apagar uma reunião apaga também a cópia na nuvem e nos teus outros computadores.')}</p>
          <div className="row wrap">
            <Button onClick={() => run('sync:disable', null, t('Cópia desligada neste computador.'))}>{t('Desligar neste computador')}</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>{t('Apagar a cópia na nuvem')}</Button>
          </div>
        </>
      )}
      {confirm && (
        <Dialog title={t('Apagar a cópia na nuvem?')} onClose={() => setConfirm(false)}>
          <div className="dialog-body">
            <p>{t('Apaga todas as reuniões copiadas e a chave. As reuniões deste computador ficam. Os teus outros computadores deixam de sincronizar. Não dá para desfazer.')}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setConfirm(false)}>{t('Cancelar')}</Button>
              <Button variant="danger" onClick={async () => { setConfirm(false); await run('sync:wipeCloud', null, t('Cópia na nuvem apagada.')); }}>{t('Apagar a cópia')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
