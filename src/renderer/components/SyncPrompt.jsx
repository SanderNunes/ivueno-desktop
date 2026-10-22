import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog, Field } from './ui.jsx';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

/**
 * For the paid plans, sync is meant to be on. It cannot switch itself on: the copy is encrypted with a passphrase only the person knows,
 * so the one thing we need from them is that passphrase. This asks once (a dialog, the first time they see Home), and keeps a banner
 * on Home until it is on. Nothing is uploaded before they answer.
 */
export default function SyncPrompt() {
  const t = useT();
  const { settings, patchSettings, toast } = useApp();
  const { data: s, reload } = useQuery('sync:status', null, { kinds: ['sync'] });
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needed = !!(s && s.eligible && !s.enabled);

  useEffect(() => {
    if (needed && !settings.syncPrompted) { setOpen(true); patchSettings({ syncPrompted: true }); }
  }, [needed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!needed) return null;

  async function turnOn(e) {
    e.preventDefault();
    if (pass.length < 8) return;
    setBusy(true); setError('');
    try { await call('sync:enable', { passphrase: pass }); setPass(''); setOpen(false); toast(t('Sincronização ligada.')); await reload(); } catch (err) { setError(friendly(err)); }
    setBusy(false);
  }

  return (
    <>
      <Banner tone="info" icon="shield" action={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>{t('Ligar')}</Button>}>
        <span className="body">{t('Liga a sincronização para teres as tuas reuniões em todos os computadores. É encriptada: só tu a podes abrir.')}</span>
      </Banner>
      {open && (
        <Dialog title={t('Ligar a sincronização')} onClose={() => setOpen(false)}>
          <form onSubmit={turnOn}>
            <div className="dialog-body">
              <p>{t('As tuas reuniões ficam disponíveis em todos os computadores onde entrares com a tua conta. Para as proteger, escolhe uma frase-passe: nós não a guardamos.')}</p>
              <Banner tone="warn" icon="shield">{t('Se perderes a frase-passe, não conseguimos recuperar a cópia. As reuniões deste computador não são afetadas.')}</Banner>
              {error && <Banner tone="error" role="alert">{error}</Banner>}
              <Field label={t('Frase-passe da cópia')} htmlFor="sp-pass" hint={t('Pelo menos 8 caracteres. Se já usas a sincronização noutro computador, escreve a mesma frase-passe.')}>
                <input id="sp-pass" type="password" className="input" autoComplete="off" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
              </Field>
            </div>
            <div className="dialog-foot">
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <Button type="button" onClick={() => setOpen(false)}>{t('Agora não')}</Button>
                <Button type="submit" variant="primary" disabled={busy || pass.length < 8}>{busy ? t('Um momento…') : t('Ligar a sincronização')}</Button>
              </div>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
