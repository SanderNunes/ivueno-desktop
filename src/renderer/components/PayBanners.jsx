import React from 'react';
import { useT } from '../lib/i18n.js';
import { PLAN_NAMES, useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { day, money } from '../lib/pay.js';

/** On Home: a reference still waiting to be paid, a plan about to end, or one that just ended. Nothing shows when all is fine. */
export default function PayBanners() {
  const t = useT();
  const { nav } = useApp();
  const { data: s } = useQuery('billing:summary', null, {});
  if (!s) return null;
  const planName = PLAN_NAMES[s.plan_was] || s.plan_was;
  const ref = s.pending_reference && s.pending_reference.reference;
  const spaced = (r) => String(r.reference).replace(/(\d{3})(?=\d)/g, '$1 ');
  return (
    <>
      {ref && (
        <div className="pay-banner warn" role="status">
          <strong>{t('Pagamento por referência à espera')}</strong>
          <span className="body">
            {t('Entidade')} <span className="mono" style={{ fontWeight: 700 }}>{ref.entity}</span> · {t('Referência')} <span className="mono" style={{ fontWeight: 700 }}>{spaced(ref)}</span> · {money(s.pending_intent.amount)}
            {ref.due_at ? ` · ${t('válida até')} ${day(ref.due_at)}, ${new Date(ref.due_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
          <span className="links">
            <button type="button" onClick={() => nav('checkout', { resume: true })}>{t('Ver referência')}</button>
            <button type="button" onClick={() => nav('checkout', { switchMethod: true })}>{t('Pagar de outra forma')}</button>
          </span>
        </div>
      )}
      {!ref && s.renewal_due && (
        <div className="pay-banner info" role="status">
          <strong>{t('O teu {name} termina a {date}', { name: planName, date: day(s.period_end) })}</strong>
          <span className="body">{t('Renova com um toque no Multicaixa Express para continuares sem limite.')}</span>
          <span><button type="button" className="btn primary sm" onClick={() => nav('checkout', { plan: s.plan_was })}>{t('Renovar · {amount}', { amount: money(s.renewal_amount).replace(',00', '') })}</button></span>
        </div>
      )}
      {!ref && s.ended_recently && s.plan === 'free' && (
        <div className="pay-banner warn" role="status">
          <strong>{t('O {name} terminou', { name: planName })}</strong>
          <span className="body">{t('Estás no Gratuito. Tudo o que gravaste continua aqui.')}</span>
          <span><button type="button" className="btn primary sm" onClick={() => nav('checkout', { plan: s.plan_was })}>{t('Renovar · {amount}', { amount: money(s.renewal_amount).replace(',00', '') })}</button></span>
        </div>
      )}
    </>
  );
}
