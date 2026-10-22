import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Chip, Seg } from '../components/ui.jsx';
import { PLAN_NAMES, useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { PITCH, day, money } from '../lib/pay.js';
import VerifyEmail from './VerifyEmail.jsx';

const PHONE = /^9\d{8}$/;
const SCENARIOS = ['sucesso', 'recusado', 'expirou', 'saldo', 'indisponivel', 'por-confirmar'];
const STEPS_WITH_POLLING = ['sending', 'waiting', 'hosted', 'refIssued', 'unknown'];

const METHOD_INFO = {
  'multicaixa-express': { name: 'Multicaixa Express', desc: 'Recebes um pedido na app e confirmas com o PIN.', time: 'Imediato', badge: 'Recomendado' },
  'emis-reference': { name: 'Referência Multicaixa', desc: 'Pagas num ATM ou no banco online, sem a app.', time: 'Até 24 h', badge: '' },
  wipay: { name: 'WiPay', desc: 'Pagas na página segura da WiPay, com o método que preferires.', time: 'Imediato', badge: '' },
  mock: { name: 'Pagamento de teste', desc: 'Só em desenvolvimento. Escolhe o resultado.', time: 'Teste', badge: 'Dev' },
};

const Svg = ({ children, size = 16, stroke = 'currentColor', width = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const CopyIcon = () => <Svg size={15}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></Svg>;

/** Which screen the server's state means. The server decides paid / failed; this only picks the words. */
function stepOf(attempt, intent) {
  if (intent.status === 'paid' && !(attempt && attempt.requires_manual_review)) return 'success';
  if (!attempt) return 'form';
  if (attempt.requires_manual_review) return 'unknown';
  if (attempt.status === 'pending') {
    if (attempt.reference) return 'refIssued';
    if (attempt.confirming) return 'unknown';
    if (attempt.method === 'wipay') return attempt.checkout_url ? 'hosted' : 'sending';       // the page comes a moment after the request
    return attempt.submitted ? 'waiting' : 'sending';
  }
  if (attempt.status === 'failed' || attempt.status === 'expired') return 'failed';
  return 'form';                                   // cancelled
}

/** The payment page. It lives inside the normal app (sidebar, page header, cards) like every other page. */
export default function Checkout() {
  const t = useT();
  const { route, nav, auth, toast, refreshAuth } = useApp();
  const plansQuery = useQuery('plans:list', null, {});
  const [planId, setPlanId] = useState(route.plan || 'pro');
  const [period, setPeriod] = useState('month');
  const [intent, setIntent] = useState(null);
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [scenario, setScenario] = useState('sucesso');
  const [attempt, setAttempt] = useState(null);
  const [step, setStep] = useState('loading');            // loading | verify | unavailable | form | sending | waiting | refIssued | success | failed | unknown | error
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [secs, setSecs] = useState(0);
  const [window_, setWindow] = useState(0);
  const [asked, setAsked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const tick = useRef(0);
  const opened = useRef('');                               // the attempt whose WiPay page was already opened for the person
  const planInfo = (plansQuery.data || []).find((p) => p.id === planId) || null;
  const planName = planInfo ? planInfo.name : (PLAN_NAMES[planId] || planId);

  const apply = useCallback((att, int) => {
    setAttempt(att); setIntent(int);
    const next = stepOf(att, int);
    setStep(next);
    if (att && att.status === 'pending' && !att.reference) { setSecs(att.seconds_left); setWindow((w) => Math.max(w, att.seconds_left)); }
    if (next === 'success') refreshAuth();
  }, [refreshAuth]);

  const begin = useCallback(async (forPeriod) => {
    setStep('loading'); setError('');
    try {
      const r = await call('billing:checkout', { plan: planId, period: forPeriod });
      setIntent(r.intent); setMethods(r.methods); setMethod((m) => (r.methods.some((x) => x.id === m) ? m : r.methods[0].id)); setStep('form');
    } catch (e) {
      if (e.code === 'billing_not_configured') setStep('unavailable');
      else if (e.code === 'email_not_verified') setStep('verify');
      else if (e.code === 'payment_in_progress') await resume(false);
      else { setError(friendly(e)); setStep('error'); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  /** Come back to a payment that was started: the open attempt decides what to show. `switchMethod` gives up a waiting reference. */
  async function resume(switchMethod) {
    try {
      const w = await call('billing:waiting');
      if (!w) { await begin(period); return; }
      const [full, list] = await Promise.all([call('billing:intent', { intentId: w.id }), call('billing:methods')]);
      setMethods(list); setPlanId(full.plan); setPeriod(full.months === 12 ? 'year' : 'month'); setMethod(list[0] ? list[0].id : '');
      let last = full.attempts[full.attempts.length - 1] || null;
      if (switchMethod && last && last.status === 'pending' && last.reference) {
        last = (await call('billing:cancel', { intentId: full.id, attemptId: last.id })).attempt;
      }
      apply(last, full);
    } catch (e) { setError(friendly(e)); setStep('error'); }
  }

  useEffect(() => { if (route.resume || route.switchMethod) resume(!!route.switchMethod); else begin('month'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While something is open, ask the server every 3 seconds (a reference only every 30; the server also checks every minute).
  useEffect(() => {
    if (!STEPS_WITH_POLLING.includes(step) || !attempt || !intent) return undefined;
    let alive = true;
    const slow = step === 'refIssued';
    const look = async () => {
      tick.current += 1;
      try {
        const r = await call('billing:attempt', { intentId: intent.id, attemptId: attempt.id, refresh: slow ? tick.current % 10 === 0 : tick.current % 3 === 0 });
        if (!alive) return;
        setOffline(false); apply(r.attempt, r.intent);
      } catch (e) { if (alive && e.code === 'offline') setOffline(true); }
    };
    const timer = setInterval(look, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [step, attempt && attempt.id, intent && intent.id, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  // a hosted checkout opens once, in the person's browser, as soon as its page is known
  useEffect(() => {
    if (step !== 'hosted' || !attempt || !attempt.checkout_url || opened.current === attempt.id) return;
    opened.current = attempt.id;
    call('billing:openCheckout', { url: attempt.checkout_url }).catch((e) => toast(friendly(e)));
  }, [step, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // the countdown ring runs locally between looks
  useEffect(() => {
    if (step !== 'waiting') return undefined;
    const timer = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [step]);

  const chooseMethod = (id) => { setMethod(id); setTried(false); setError(''); };
  const changePeriod = (p) => { if (step !== 'form' || p === period) return; setPeriod(p); begin(p); };

  async function pay() {
    const digits = phone.replace(/\D/g, '');
    const isPush = method === 'multicaixa-express';
    if (isPush && !PHONE.test(digits)) { setTried(true); return; }
    setError(''); setStep('sending'); tick.current = 0; setWindow(0);
    try {
      const a = await call('billing:pay', { intentId: intent.id, method, phone: isPush ? digits : '', scenario: method === 'mock' ? scenario : undefined });
      setPhone('');                                     // the number is not kept
      apply(a, intent);
    } catch (e) { setError(friendly(e)); setStep('form'); }
  }

  async function giveUpReference() {
    try { const r = await call('billing:cancel', { intentId: intent.id, attemptId: attempt.id }); setAttempt(r.attempt); setStep('form'); } catch (e) { toast(friendly(e)); }
  }
  async function checkNow() {
    try { const r = await call('billing:attempt', { intentId: intent.id, attemptId: attempt.id, refresh: true }); apply(r.attempt, r.intent); } catch (e) { toast(friendly(e)); }
  }
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast(t('Copiado')); } catch { /* clipboard blocked */ } };
  async function notifyMe() { try { await call('billing:waitlist', { plan: planId }); setAsked(true); } catch (e) { toast(friendly(e)); } }

  const total = intent ? money(intent.amount) : '';
  const totalPlain = intent ? total.replace(' Kz', '') : '';
  const sentTo = attempt && attempt.masked_phone ? `+244 ${attempt.masked_phone.slice(3, 4)}•• ••• ${attempt.masked_phone.slice(-3)}` : '';
  const open = ['sending', 'waiting'].includes(step);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const ringOffset = Math.round(264 * (1 - (window_ ? secs / window_ : 1)));
  const phoneBad = tried && !PHONE.test(phone.replace(/\D/g, ''));
  const info = (id) => METHOD_INFO[id] || { name: id, desc: '', time: '', badge: '' };

  const FAIL = {
    refused: ['Recusaste o pagamento no Multicaixa Express', 'Se foi engano, envia o pedido outra vez.', 'Enviar outra vez'],
    expired: ['O pedido expirou', 'Não chegou confirmação a tempo. Pode ter sido a rede ou a notificação que não apareceu.', 'Enviar outra vez'],
    insufficient_funds: ['Saldo insuficiente', 'A conta ligada a este número não tem saldo para {amount}. Carrega a conta ou usa outro número.', 'Tentar outra vez'],
    invalid_number: ['Este número não usa Multicaixa Express', 'Confirma o número, ou paga com uma referência num ATM.', 'Corrigir o número'],
    gateway_unavailable: ['O Multicaixa Express não está a responder', 'O problema não é teu. Tenta daqui a uns minutos ou paga com referência.', 'Tentar outra vez'],
    not_sent: ['Não conseguimos enviar o pedido', 'O problema é nosso, não teu: o pedido nem chegou ao banco. Tenta outra vez daqui a pouco.', 'Tentar outra vez'],
    declined: ['O pagamento não foi concluído', 'O banco não aprovou o pedido. Podes tentar outra vez ou pagar com referência.', 'Tentar outra vez'],
  };
  const fail = FAIL[(attempt && attempt.reason) || 'declined'] || FAIL.declined;
  const canRef = methods.some((m) => m.id === 'emis-reference');
  const methodLabel = attempt ? (attempt.method === 'multicaixa-express' && sentTo ? `Multicaixa Express · ${sentTo}` : t(info(attempt.method).name)) : '';
  const yearly = period === 'year';

  const picker = (
    <div className="co-col">
      <h2 id="co-pay" className="co-h">{t('Como queres pagar?')}</h2>
      <div className="co-methods" role="radiogroup" aria-labelledby="co-pay">
        {methods.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={method === m.id} className="co-method" onClick={() => chooseMethod(m.id)}>
            <span className="co-dot" aria-hidden="true" />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span className="co-method-name"><strong>{t(info(m.id).name)}</strong>{info(m.id).badge && <span className="tag accent">{t(info(m.id).badge)}</span>}</span>
              <span className="muted" style={{ fontSize: 13 }}>{t(info(m.id).desc)}</span>
            </span>
            <span className="co-time">{t(info(m.id).time)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  let body = null;
  if (step === 'loading') body = <div className="co-center" role="status"><span className="muted">{t('Um momento…')}</span></div>;
  else if (step === 'error') body = <div className="co-col"><Banner tone="error" role="alert">{error}</Banner><div className="row"><Button variant="primary" onClick={() => nav('plans')}>{t('Voltar aos planos')}</Button></div></div>;
  else if (step === 'verify') {
    body = (
      <div className="co-col" role="status">
        <span className="co-icon warn"><Icon name="shield" size={24} /></span>
        <h2 className="co-h">{t('Confirma o teu email para pagar')}</h2>
        <p className="muted">{t('Por segurança, só aceitamos pagamentos de contas com o email confirmado. Enviámos um email para {email}. Abre-o, carrega em “Confirmar email” e volta aqui.', { email: (auth.user && auth.user.email) || '' })}</p>
        <div className="row wrap"><Button variant="primary" onClick={() => setVerifying(true)}>{t('Confirmar email')}</Button><Button onClick={() => nav('plans')}>{t('Voltar aos planos')}</Button></div>
      </div>
    );
  } else if (step === 'unavailable') {
    body = (
      <div className="co-col" role="status">
        <h2 className="co-h">{t('Os pagamentos chegam em breve.')}</h2>
        <p className="muted">{t('Ainda não conseguimos cobrar. Até lá continuas no teu plano atual, sem perder nada.')}</p>
        <div className="row wrap">
          {asked ? <span className="tag accent">{t('Combinado. Avisamos-te por email.')}</span> : <Button variant="primary" onClick={notifyMe}>{t('Avisar-me')}</Button>}
          <Button onClick={() => nav('plans')}>{t('Voltar aos planos')}</Button>
        </div>
      </div>
    );
  } else if (step === 'form') {
    body = (
      <>
        {picker}
        {error && <Banner tone="error" role="alert">{error}</Banner>}
        {method === 'multicaixa-express' && (
          <div className="co-col co-sep">
            <div className="field">
              <label htmlFor="co-phone">{t('Número de telemóvel com Multicaixa Express')}</label>
              <div className={`co-phone ${phoneBad ? 'bad' : ''}`}>
                <span className="pre">+244</span>
                <input id="co-phone" inputMode="numeric" autoComplete="tel-national" placeholder="923 456 789" value={phone} aria-invalid={phoneBad} aria-describedby="co-phone-h"
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') pay(); }} />
              </div>
              <span id="co-phone-h" className="hint" style={phoneBad ? { color: 'var(--error)', fontWeight: 600 } : undefined}>{phoneBad ? t('Escreve os 9 dígitos do número, começando por 9. Exemplo: 923 456 789') : t('O número onde tens a app Multicaixa Express.')}</span>
            </div>
            <Button variant="primary" size="lg" className="co-full" onClick={pay}>{t('Pagar {amount}', { amount: total })}</Button>
            <span className="hint">{t('Vais receber um pedido no Multicaixa Express. Só és cobrado quando confirmares lá.')}</span>
          </div>
        )}
        {method === 'emis-reference' && (
          <div className="co-col co-sep">
            <p>{t('Geramos uma referência para pagares num ATM Multicaixa ou no teu banco online. O plano ativa quando o pagamento chegar, normalmente em minutos, mas pode demorar até 24 horas.')}</p>
            <Button variant="primary" size="lg" className="co-full" onClick={pay}>{t('Gerar referência de {amount}', { amount: total })}</Button>
          </div>
        )}
        {method === 'wipay' && (
          <div className="co-col co-sep">
            <p>{t('Abrimos a página segura da WiPay no teu navegador. Lá escolhes como pagar e confirmas. O plano ativa quando a WiPay nos avisar, normalmente em segundos.')}</p>
            <Button variant="primary" size="lg" className="co-full" onClick={pay}>{t('Pagar {amount} com a WiPay', { amount: total })}</Button>
            <span className="hint">{t('Só és cobrado quando confirmares na página da WiPay.')}</span>
          </div>
        )}
        {method === 'mock' && (
          <div className="co-col co-sep">
            <span id="co-mock-l" className="label">{t('Resultado a simular')}</span>
            <div className="row wrap" role="radiogroup" aria-labelledby="co-mock-l">
              {SCENARIOS.map((o) => <Chip key={o} role="radio" aria-checked={scenario === o} pressed={scenario === o} onClick={() => setScenario(o)}>{o}</Chip>)}
            </div>
            <Button variant="primary" size="lg" className="co-full" onClick={pay}>{t('Simular pagamento')}</Button>
          </div>
        )}
      </>
    );
  } else if (step === 'sending') {
    body = (
      <div className="co-center" role="status">
        <svg className="co-spin" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth="4" /><path d="M20 4a16 16 0 0 1 16 16" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" /></svg>
        <strong style={{ fontSize: 18 }}>{method === 'emis-reference' ? t('A gerar a referência…') : method === 'wipay' ? t('A preparar a página de pagamento…') : t('A enviar o pedido para o teu telemóvel…')}</strong>
        <span className="muted">{t('Não feches esta janela.')}</span>
      </div>
    );
  } else if (step === 'waiting') {
    body = (
      <div className="co-col" role="status" aria-live="polite" style={{ gap: 22 }}>
        <div className="co-wait-head">
          <div className="co-ring">
            <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="42" fill="none" stroke="var(--sunken)" strokeWidth="6" /><circle cx="48" cy="48" r="42" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray="264" strokeDashoffset={ringOffset} transform="rotate(-90 48 48)" /></svg>
            <span>{clock}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
            <h2 className="co-h">{t('Confirma no teu telemóvel')}</h2>
            <span className="muted">{t('Enviámos um pedido de {amount} para o Multicaixa Express do {phone}.', { amount: total, phone: sentTo })}</span>
          </div>
        </div>
        <ol className="co-steps">
          <li><span className="n">1</span>{t('Abre a app Multicaixa Express')}</li>
          <li><span className="n">2</span>{t('Toca na notificação de pagamento da Ivuenu')}</li>
          <li><span className="n">3</span>{t('Confirma com o teu PIN')}</li>
        </ol>
        {offline
          ? <Banner tone="warn" role="status">{t('Sem ligação à internet. Se já confirmaste no telemóvel, o pagamento conta. Voltamos a verificar quando a ligação voltar. Não pagues outra vez.')}</Banner>
          : <div className="co-status"><i className="co-pulse" />{t('À espera da confirmação. Esta página atualiza sozinha.')}</div>}
      </div>
    );
  } else if (step === 'hosted' && attempt && attempt.checkout_url) {
    body = (
      <div className="co-col" role="status" aria-live="polite" style={{ gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="co-h">{t('Conclui o pagamento na página da WiPay')}</h2>
          <span className="muted">{t('Abrimos a página no teu navegador. Escolhe como pagar e confirma lá. Esta janela atualiza sozinha quando o pagamento chegar.')}</span>
        </div>
        <div className="row wrap">
          <Button variant="primary" onClick={() => call('billing:openCheckout', { url: attempt.checkout_url }).catch((e) => toast(friendly(e)))}>{t('Abrir a página outra vez')}</Button>
          <Button variant="ghost" onClick={() => nav('home')}>{t('Voltar à Ivuenu')}</Button>
        </div>
        {offline
          ? <Banner tone="warn" role="status">{t('Sem ligação à internet. Se já pagaste, o pagamento conta. Voltamos a verificar quando a ligação voltar. Não pagues outra vez.')}</Banner>
          : <div className="co-status"><i className="co-pulse" />{t('À espera da confirmação. Se já pagaste, não pagues outra vez.')}</div>}
      </div>
    );
  } else if (step === 'refIssued' && attempt && attempt.reference) {
    const r = attempt.reference;
    body = (
      <div className="co-col">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="co-h">{t('Paga com esta referência')}</h2>
          <span className="muted">{t('Num ATM Multicaixa: Pagamentos › Pagamento por referência. No banco online ou no Multicaixa Express: Pagar › Referência.')}</span>
        </div>
        <dl className="co-ref">
          <div><dt>{t('Entidade')}</dt><dd><strong>{r.entity}</strong><button type="button" className="icon-btn bordered sm" aria-label={t('Copiar entidade')} title={t('Copiar entidade')} onClick={() => copy(r.entity)}><CopyIcon /></button></dd></div>
          <div><dt>{t('Referência')}</dt><dd><strong>{String(r.reference).replace(/(\d{3})(?=\d)/g, '$1 ')}</strong><button type="button" className="icon-btn bordered sm" aria-label={t('Copiar referência')} title={t('Copiar referência')} onClick={() => copy(r.reference)}><CopyIcon /></button></dd></div>
          <div><dt>{t('Valor exato')}</dt><dd><strong>{totalPlain}</strong></dd></div>
        </dl>
        <Banner tone="warn" icon="info">{r.due_at ? t('Válida até {date}. ', { date: `${day(r.due_at)} ${new Date(r.due_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}` }) : ''}{t('O plano ativa quando o pagamento chegar, normalmente em minutos, até 24 horas.')}</Banner>
        <div className="row wrap">
          <Button variant="primary" onClick={() => nav('home')}>{t('Voltar à Ivuenu')}</Button>
          <Button variant="ghost" onClick={giveUpReference}>{t('Escolher outro método')}</Button>
        </div>
      </div>
    );
  } else if (step === 'success') {
    body = (
      <div className="co-col" role="status">
        <span className="co-icon ok"><Svg size={28} width={2.4}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg></span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="co-h">{t('Pagamento confirmado. O teu {name} está ativo.', { name: planName })}</h2>
          <span className="muted">{t('Reuniões sem limite a partir de agora. Enviámos o recibo para {email}.', { email: (auth.user && auth.user.email) || '' })}</span>
        </div>
        <dl className="co-dl">
          <div><dt>{t('Recibo')}</dt><dd className="mono">{intent.receipt_number}</dd></div>
          <div><dt>{t('Método')}</dt><dd>{methodLabel}</dd></div>
          <div><dt>{t('Pago até')}</dt><dd>{day(intent.period_end || intent.paid_until_if_paid_now)}</dd></div>
        </dl>
        <div className="row"><Button variant="primary" onClick={() => nav('home')}>{t('Voltar à Ivuenu')}</Button></div>
      </div>
    );
  } else if (step === 'failed') {
    body = (
      <div className="co-col" role="alert">
        <span className="co-icon err"><Svg size={28} width={2.2}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.2v.3" /></Svg></span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="co-h">{t(fail[0])}</h2><span className="muted">{t(fail[1], { amount: total })}</span>
          <span className="co-nocharge">{t('Nada foi cobrado.')}</span>
        </div>
        <div className="row wrap">
          <Button variant="primary" onClick={() => { setAttempt(null); setStep('form'); }}>{t(fail[2])}</Button>
          {canRef && attempt && attempt.method !== 'emis-reference' && <Button onClick={() => { setMethod('emis-reference'); setAttempt(null); setStep('form'); }}>{t('Pagar com referência')}</Button>}
        </div>
      </div>
    );
  } else if (step === 'unknown') {
    const review = attempt && attempt.requires_manual_review;
    body = (
      <div className="co-col" role="status">
        <span className="co-icon warn"><Svg size={28} width={2}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg></span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="co-h">{review ? t('Recebemos o teu pagamento e estamos a verificá-lo') : t('Ainda estamos a confirmar com o banco')}</h2>
          <span className="muted">{review
            ? t('A nossa equipa tem de o verificar antes de ativar o plano. Não pagues outra vez; fala com o suporte se precisares.')
            : t('Se já confirmaste no telemóvel, não pagues outra vez. Continuamos a verificar e enviamos-te um email assim que soubermos, normalmente em menos de 1 hora. Se o pagamento não se confirmar, não és cobrado.')}</span>
        </div>
        <div className="row wrap">
          <Button variant="primary" onClick={() => nav('home')}>{t('Voltar à Ivuenu')}</Button>
          {!review && <Button onClick={checkNow}>{t('Verificar agora')}</Button>}
        </div>
      </div>
    );
  }

  const showSummary = intent && ['form', 'sending', 'waiting', 'hosted', 'refIssued', 'success', 'failed', 'unknown'].includes(step);
  return (
    <div className="page framed">
      <div className="page-inner">
        <header className="page-head">
          <div className="row" style={{ gap: 12 }}>
            {!open && <button type="button" className="icon-btn bordered" aria-label={t('Voltar aos planos')} title={t('Voltar aos planos')} onClick={() => nav('plans')}><Icon name="back" size={18} /></button>}
            <h1 className="display">{t('Pagamento')}</h1>
          </div>
          <span className="row muted" style={{ gap: 6, fontSize: 13 }}><Svg size={14}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></Svg>{(attempt ? attempt.method : method) === 'wipay' ? t('Pagamento seguro · via WiPay') : t('Pagamento seguro · via AppyPay')}</span>
        </header>
        <div className="page-scroll">
        {method === 'mock' && step === 'form' && <Banner tone="warn" role="status">{t('Modo de teste · nenhum dinheiro é cobrado · visível só em builds de desenvolvimento')}</Banner>}
        <div className="co-grid">
          <section className="card pad co-pay" aria-labelledby={step === 'form' ? 'co-pay' : undefined}>{body}</section>
          {showSummary && (
            <aside className="co-side" aria-labelledby="co-sum">
              <div className="card pad co-sumcard">
                <h2 id="co-sum" className="co-h" style={{ fontSize: 16 }}>{t('Resumo')}</h2>
                <span style={{ display: 'flex', flexDirection: 'column' }}><strong style={{ fontSize: 18 }}>{`Ivuenu ${planName}`}</strong><span className="hint">{t(PITCH[planId] || (planInfo && planInfo.description) || '')}</span></span>
                <Seg label={t('Período')} value={period} onChange={changePeriod} options={[{ id: 'month', label: t('Mensal') }, { id: 'year', label: t('Anual · 2 meses grátis') }]} />
                <dl className="co-sum">
                  <div><dt>{yearly ? t('{plan} · 12 meses', { plan: planName }) : t('{plan} · 1 mês', { plan: planName })}</dt><dd>{total}</dd></div>
                  <div><dt>{t('IVA ({n}%)', { n: intent.vat_percent })}</dt><dd>{t('incluído')}</dd></div>
                  <div className="total"><dt>{t('Total')}</dt><dd>{total}</dd></div>
                </dl>
                <span className="hint">{t('Pago até {date}. Não há cobrança automática: avisamos-te 3 dias antes e renovas com um toque.', { date: day(intent.period_end || intent.paid_until_if_paid_now) })}</span>
              </div>
              <span className="hint" style={{ padding: '0 4px' }}>{t('Faturado a {name}', { name: (auth.user && (auth.user.name || auth.user.email)) || '' })}</span>
            </aside>
          )}
        </div>
        </div>
      </div>
      {verifying && <VerifyEmail onClose={() => { setVerifying(false); begin(period); }} />}
    </div>
  );
}
