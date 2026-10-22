import React, { useEffect, useState } from 'react';
import { Logo } from '../components/Icon.jsx';
import { Button, Field, Banner } from '../components/ui.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { passwordStrength } from '../lib/format.mjs';
import { useT } from '../lib/i18n.js';

/** Sign in / create account. Generic error on purpose: it never says which of email and password was wrong. */
export default function Auth({ onDone, initialMode = 'login' }) {
  const t = useT();
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState(null);                       // {orgName, pollToken} while the browser is doing the company sign-in
  const strength = passwordStrength(password);
  const signup = mode === 'signup';

  async function submit(e) {
    e.preventDefault();
    setError(''); setTaken(false);
    if (signup && !strength.ok) { setError(t('auth.pwShort')); return; }
    setBusy(true);
    try {
      await call(signup ? 'auth:register' : 'auth:login', { email: email.trim(), password, name: name.trim() });
      await onDone();
    } catch (err) {
      setTaken(err.code === 'email_taken');
      setError(friendly(err));
    } finally { setBusy(false); }
  }

  // company sign-in: the browser signs the person in, this window asks every 2 seconds whether it is done
  useEffect(() => {
    if (!sso) return undefined;
    let alive = true;
    const look = async () => {
      try {
        const r = await call('sso:poll', { pollToken: sso.pollToken });
        if (!alive || r.status === 'pending') return;
        setSso(null);
        if (r.status === 'done') await onDone();
        else setError(r.status === 'expired' ? t('O pedido expirou. Tenta outra vez.') : ssoReason(r.reason, t));
      } catch (e) { if (alive && e.code !== 'offline') { setSso(null); setError(friendly(e)); } }
    };
    const timer = setInterval(look, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [sso && sso.pollToken]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startSso() {
    setError('');
    if (!/.+@.+\..+/.test(email.trim())) { setError(t('Escreve primeiro o teu email de trabalho.')); return; }
    setBusy(true);
    try {
      const found = await call('sso:discover', { email: email.trim() });
      if (!found.sso) { setError(t('Este email não tem início de sessão da empresa. Usa a palavra-passe.')); return; }
      const { pollToken } = await call('sso:start', { orgId: found.org_id });
      setSso({ orgName: found.org_name, pollToken });
    } catch (err) { setError(friendly(err)); } finally { setBusy(false); }
  }

  if (sso) {
    return (
      <div className="card auth-card" role="status">
        <div className="row" style={{ gap: 10, fontSize: 18, fontWeight: 700 }}><Logo />ivuenu</div>
        <h1 style={{ fontSize: 22, lineHeight: '30px', fontWeight: 600 }}>{t('Entrar com {name}', { name: sso.orgName })}</h1>
        <p className="muted">{t('Abrimos o início de sessão da tua empresa no navegador. Termina lá e volta aqui: esta janela atualiza sozinha.')}</p>
        <Button onClick={() => setSso(null)}>{t('Cancelar')}</Button>
      </div>
    );
  }

  if (mode === 'forgot') return <Forgot initialEmail={email} onBack={(e) => { if (e) setEmail(e); setMode('login'); setError(''); }} />;

  return (
    <form className="card auth-card" onSubmit={submit} noValidate>
      <div className="row" style={{ gap: 10, fontSize: 18, fontWeight: 700 }}><Logo />ivuenu</div>
      <div className="col" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 22, lineHeight: '30px', fontWeight: 600 }}>{signup ? t('auth.signupTitle') : t('auth.loginTitle')}</h1>
        <p className="muted">{signup ? t('auth.signupBody') : t('auth.loginBody')}</p>
      </div>
      {error && !taken && <Banner tone="error" role="alert">{error}</Banner>}
      {signup && <Field label={t('common.name')} htmlFor="au-name"><input id="au-name" className="input lg" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
      <Field label={t('common.email')} htmlFor="au-mail">
        <input id="au-mail" type="email" className="input lg" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={taken || undefined} required />
        {taken && <span style={{ fontSize: 12, color: 'var(--error)' }}>{t('auth.taken')} <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); setTaken(false); }}>{t('auth.login')}</a></span>}
      </Field>
      <Field label={t('common.password')} htmlFor="au-pw">
        <input id="au-pw" type="password" className="input lg" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} required />
        {signup && password && (
          <>
            <div className="strength" aria-hidden="true">{[1, 2, 3, 4].map((n) => <i key={n} className={n <= strength.score ? (strength.ok ? 'good' : 'on') : ''} />)}</div>
            <span style={{ fontSize: 12, color: strength.ok ? 'var(--success)' : 'var(--warning)' }}>{strength.label}</span>
          </>
        )}
      </Field>
      <Button variant="primary" size="lg" type="submit" disabled={busy || !email || !password}>{busy ? t('common.busy') : signup ? t('auth.signup') : t('auth.login')}</Button>
      {!signup && (
        <div className="col muted" style={{ gap: 8, fontSize: 13 }}>
          <span><a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setMode('forgot'); setError(''); }}>{t('auth.forgot')}</a></span>
          <span><a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); startSso(); }}>{t('auth.sso')}</a></span>
        </div>
      )}
      {signup && <span className="muted" style={{ fontSize: 12 }}>{t('auth.terms')}</span>}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, fontSize: 13 }}>
        {signup ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
        <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setMode(signup ? 'login' : 'signup'); setError(''); }}>{signup ? t('auth.login') : t('auth.signup')}</a>
      </div>
    </form>
  );
}

/** Forgotten password: type the email, we send a link; the new password is chosen on the page the link opens. */
function Forgot({ initialEmail = '', onBack }) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await call('auth:forgot', { email }); setSent(true); } catch (err) { setError(friendly(err)); }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="card auth-card">
        <div className="row" style={{ gap: 10, fontSize: 18, fontWeight: 700 }}><Logo />ivuenu</div>
        <h1 style={{ fontSize: 22, lineHeight: '30px', fontWeight: 600 }}>{t('forgot.sentTitle')}</h1>
        <p className="muted">{t('forgot.sentBody')}</p>
        <Button variant="primary" size="lg" onClick={() => onBack(email)}>{t('forgot.backLogin')}</Button>
        <a href="#" style={{ fontWeight: 600, fontSize: 13 }} onClick={(e) => { e.preventDefault(); setSent(false); }}>{t('forgot.again')}</a>
      </div>
    );
  }
  return (
    <form className="card auth-card" onSubmit={send} noValidate>
      <div className="row" style={{ gap: 10, fontSize: 18, fontWeight: 700 }}><Logo />ivuenu</div>
      <div className="col" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 22, lineHeight: '30px', fontWeight: 600 }}>{t('forgot.title')}</h1>
        <p className="muted">{t('forgot.body')}</p>
      </div>
      {error && <Banner tone="error" role="alert">{error}</Banner>}
      <Field label={t('common.email')} htmlFor="fg-mail"><input id="fg-mail" type="email" className="input lg" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required /></Field>
      <Button variant="primary" size="lg" type="submit" disabled={busy || !email}>{busy ? t('common.busy') : t('forgot.send')}</Button>
      <a href="#" style={{ fontWeight: 600, fontSize: 13 }} onClick={(e) => { e.preventDefault(); onBack(email); }}>{t('forgot.backLogin')}</a>
    </form>
  );
}

function ssoReason(reason, t) {
  switch (reason) {
    case 'account_exists_not_member': return t('Já existe uma conta com este email. Pede um convite à tua empresa, aceita-o em Definições › Organização e volta a tentar.');
    case 'seats_full': return t('A tua empresa não tem lugares livres. Fala com o administrador.');
    case 'account_suspended': return t('Esta conta está suspensa. Fala com o suporte da Ivuenu.');
    case 'domain_not_allowed': return t('Este email não pertence à tua empresa.');
    default: return t('A tua empresa não confirmou a entrada. Tenta outra vez.');
  }
}
