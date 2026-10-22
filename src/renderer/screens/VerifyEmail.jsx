import React, { useState } from 'react';
import { Banner, Button, Dialog } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { useT } from '../lib/i18n.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';

/**
 * Confirm the address: the email has a button that opens a page in the browser. Here the person only asks for a new email
 * or says "I confirmed" so the app re-reads the account. Needed to create organisations, invite people or buy a plan.
 */
export default function VerifyEmail({ onClose }) {
  const t = useT();
  const { auth, refreshAuth, toast } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirmed() {
    setError(''); setBusy(true);
    try {
      const user = await call('auth:refreshUser');
      if (user.email_verified) { await refreshAuth(); toast(t('Email confirmado. Obrigado.')); onClose(); }
      else setError(t('Ainda não está confirmado. Abre o email e carrega no botão.'));
    } catch (err) { setError(friendly(err)); }
    setBusy(false);
  }
  async function again() {
    setError('');
    try { await call('auth:resendVerification'); toast(t('Novo email enviado.')); } catch (err) { setError(friendly(err)); }
  }

  return (
    <Dialog title={t('Confirmar email')} onClose={onClose}>
      <div className="dialog-body">
        <p>{t('Enviámos um email para {email}. Abre-o e carrega em “Confirmar email”. Depois volta aqui. O link vale 24 horas.', { email: (auth.user && auth.user.email) || '' })}</p>
        {error && <Banner tone="error" role="alert">{error}</Banner>}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <a href="#" style={{ fontWeight: 600, fontSize: 13 }} onClick={(e) => { e.preventDefault(); again(); }}>{t('Enviar outro email')}</a>
          <Button variant="primary" onClick={confirmed} disabled={busy}>{t('Já confirmei')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
