import React from 'react';
import { useT } from '../lib/i18n.js';
import { PLAN_NAMES, useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { day, money } from '../lib/pay.js';

const STATE = { paid: 'Pago', failed: 'Recusado', cancelled: 'Anulada', expired: 'Expirada', pending: 'À espera' };
const METHOD = { 'multicaixa-express': 'Multicaixa Express', 'emis-reference': 'Referência', mock: 'Teste' };

/** Settings › Plan: when it is paid until, a renew button, and every payment with its receipt number. */
export default function PayHistory() {
  const t = useT();
  const { nav } = useApp();
  const summary = useQuery('billing:summary', null, {});
  const history = useQuery('billing:history', null, {});
  const s = summary.data;
  const rows = history.data || [];
  if (!s || (rows.length === 0 && !s.period_end)) return null;
  const paidPlan = s.plan_was && s.plan !== 'free';
  const last = rows.find((r) => r.status === 'paid');
  return (
    <section className="card" aria-labelledby="st-pay" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row wrap" style={{ justifyContent: 'space-between', padding: '16px 20px', gap: 12 }}>
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <strong id="st-pay" style={{ fontSize: 16 }}>{paidPlan ? `${PLAN_NAMES[s.plan]} · ${t('mensal')}` : t('Pagamentos')}</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            {s.period_end && paidPlan ? t('Pago até {date}', { date: day(s.period_end) }) : t('Sem plano pago de momento.')}
            {last ? ` · ${t('último pagamento com')} ${t(METHOD[last.method] || last.method)}${last.masked_phone ? ` +244 ${last.masked_phone.slice(3, 4)}•• ••• ${last.masked_phone.slice(-3)}` : ''}` : ''}
          </span>
        </span>
        {s.plan_was && <button type="button" className="btn sm" onClick={() => nav('checkout', { plan: s.plan_was })}>{t('Renovar agora')}</button>}
      </div>
      {rows.length > 0 && (
        <table className="pay-table">
          <thead><tr><th>{t('Data')}</th><th>{t('Método')}</th><th>{t('Valor')}</th><th>{t('Estado')}</th><th>{t('Recibo')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.attempt_id}>
                <td className="mono">{day(r.at)}</td><td>{t(METHOD[r.method] || r.method)}</td><td>{money(r.amount)}</td>
                <td><span className={`pay-pill ${r.status}`}>{t(STATE[r.status] || r.status)}</span></td>
                <td className="mono" style={{ color: r.receipt_number ? undefined : 'var(--text-3)' }}>{r.receipt_number || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
