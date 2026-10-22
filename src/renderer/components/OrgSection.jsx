import React, { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { Banner, Button, Dialog, Field, Switch } from './ui.jsx';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useApp } from '../lib/app-context.js';

const org = (method, path, body, query) => call('org:call', { method, path, body, query });
const ROLE = { owner: 'Dono', admin: 'Administrador', member: 'Membro' };

/** Settings › Organisation: members and invites, company rules, the audit log, directory sync and company sign-in. */
export default function OrgSection() {
  const t = useT();
  const { toast, nav } = useApp();
  const orgs = useQuery('org:list', null, { kinds: ['orgs'] });
  const [current, setCurrent] = useState('');
  const list = orgs.data || [];
  const mine = list.find((o) => o.id === current) || list[0];
  const [error, setError] = useState('');

  if (!orgs.data) return null;
  const fail = (e) => setError(e.code === 'plan_required' ? t('Esta função precisa do plano Equipa (convites, auditoria) ou Empresa (diretório e início de sessão da empresa).') : friendly(e));
  const reloadAll = () => orgs.reload();

  if (!mine) return <Start onDone={reloadAll} toast={toast} fail={fail} error={error} />;
  const admin = mine.role === 'owner' || mine.role === 'admin';
  const owner = mine.role === 'owner';
  return (
    <>
      <section className="card" aria-labelledby="st-org">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <h2 id="st-org">{mine.name}</h2>
          <span className="row" style={{ gap: 8 }}>
            {list.length > 1 && (
              <select className="select" aria-label={t('Organização')} value={mine.id} onChange={(e) => setCurrent(e.target.value)}>{list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            )}
            <span className="tag accent">{t(ROLE[mine.role])}</span>
          </span>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>{mine.member_count === 1 ? t('1 membro.') : t('{n} membros.', { n: mine.member_count })} <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); nav('plans'); }}>{t('Ver planos')}</a></span>
        {error && <Banner tone="warn" role="alert">{error}</Banner>}
      </section>
      <Members key={`m-${mine.id}`} org={mine} admin={admin} owner={owner} fail={fail} setError={setError} reload={reloadAll} toast={toast} />
      {admin && <Rules key={`r-${mine.id}`} org={mine} fail={fail} setError={setError} toast={toast} />}
      {admin && <Audit key={`a-${mine.id}`} org={mine} fail={fail} setError={setError} toast={toast} />}
      {owner && <Enterprise key={`e-${mine.id}`} org={mine} fail={fail} setError={setError} toast={toast} />}
    </>
  );
}

function Start({ onDone, toast, fail, error }) {
  const t = useT();
  const { auth } = useApp();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const verified = !auth.user || auth.user.email_verified !== false;
  return (
    <section className="card" aria-labelledby="st-org0">
      <h2 id="st-org0">{t('Organização')}</h2>
      <p className="muted">{t('Uma organização junta a tua equipa: lugares, regras da empresa, auditoria e início de sessão da empresa. Ainda não fazes parte de nenhuma.')}</p>
      {error && <Banner tone="warn" role="alert">{error}</Banner>}
      {!verified && <Banner tone="info">{t('Confirma o teu email para criares organizações ou aceitares convites.')}</Banner>}
      <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); try { await org('POST', '/v1/orgs', { name }); toast(t('Organização criada.')); setName(''); onDone(); } catch (err) { fail(err); } }}>
        <Field label={t('Criar uma organização')} htmlFor="org-new"><input id="org-new" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Nome da empresa')} /></Field>
        <Button type="submit" variant="primary" disabled={name.trim().length < 2 || !verified}>{t('Criar')}</Button>
      </form>
      <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); try { await org('POST', '/v1/orgs/invites/accept', { token: token.trim() }); toast(t('Entraste na organização.')); setToken(''); onDone(); } catch (err) { fail(err); } }}>
        <Field label={t('Tenho um convite')} htmlFor="org-inv" hint={t('Cola o código do convite que recebeste por email.')}><input id="org-inv" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
        <Button type="submit" disabled={token.trim().length < 10 || !verified}>{t('Aceitar')}</Button>
      </form>
    </section>
  );
}

function Members({ org: o, admin, owner, fail, setError, reload, toast }) {
  const t = useT();
  const { auth } = useApp();
  const members = useQuery('org:call', { path: `/v1/orgs/${o.id}/members` }, { kinds: ['orgs'] });
  const invites = useQuery('org:call', { path: `/v1/orgs/${o.id}/invites` }, { kinds: ['orgs'], enabled: admin });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [shown, setShown] = useState(null);                 // an invite code, shown once so it can be sent
  const act = async (fn, done) => { setError(''); try { await fn(); if (done) toast(done); members.reload(); invites.reload(); reload(); } catch (e) { fail(e); } };
  const me = auth.user && auth.user.email;
  return (
    <section className="card" aria-labelledby="st-mem">
      <h2 id="st-mem">{t('Membros')}</h2>
      <div className="col" style={{ gap: 6 }}>
        {(members.data || []).map((m) => (
          <div key={m.user_id} className="row wrap" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="col" style={{ gap: 0 }}><strong>{m.name || m.email}</strong><span className="muted" style={{ fontSize: 12 }}>{m.email}</span></span>
            <span className="row" style={{ gap: 8 }}>
              {owner && m.role !== 'owner' ? (
                <select className="select" aria-label={`${t('Função de')} ${m.email}`} value={m.role} onChange={(e) => act(() => org('PATCH', `/v1/orgs/${o.id}/members/${m.user_id}`, { role: e.target.value }), t('Guardado.'))}>
                  <option value="member">{t(ROLE.member)}</option><option value="admin">{t(ROLE.admin)}</option>
                </select>
              ) : <span className="tag">{t(ROLE[m.role])}</span>}
              {((admin && m.role !== 'owner') || m.email === me) && m.role !== 'owner' && (
                <Button size="sm" onClick={() => act(() => org('DELETE', `/v1/orgs/${o.id}/members/${m.user_id}`), m.email === me ? t('Saíste da organização.') : t('Membro removido.'))}>{m.email === me ? t('Sair') : t('Remover')}</Button>
              )}
            </span>
          </div>
        ))}
      </div>
      {admin && (
        <>
          {(invites.data || []).filter((i) => i.status === 'pending').map((i) => (
            <div key={i.id} className="row wrap" style={{ justifyContent: 'space-between' }}>
              <span>{i.email} <span className="muted" style={{ fontSize: 12 }}>· {t('convite pendente')}</span></span>
              <Button size="sm" onClick={() => act(() => org('DELETE', `/v1/orgs/${o.id}/invites/${i.id}`), t('Convite cancelado.'))}>{t('Cancelar')}</Button>
            </div>
          ))}
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); act(async () => { const r = await org('POST', `/v1/orgs/${o.id}/invites`, { email: email.trim(), role }); setShown({ email: r.email, token: r.token }); setEmail(''); }); }}>
            <Field label={t('Convidar por email')} htmlFor="org-mail"><input id="org-mail" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t('Função')} htmlFor="org-role"><select id="org-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}><option value="member">{t(ROLE.member)}</option><option value="admin">{t(ROLE.admin)}</option></select></Field>
            <Button type="submit" variant="primary" disabled={!/.+@.+\..+/.test(email)}>{t('Convidar')}</Button>
          </form>
        </>
      )}
      {shown && (
        <Dialog title={t('Convite criado')} onClose={() => setShown(null)}>
          <div className="dialog-body">
            <p>{t('Envia este código a {email}. Aparece só agora. A pessoa cola-o em Definições › Organização › “Tenho um convite”.', { email: shown.email })}</p>
            <input className="input mono" readOnly value={shown.token} onFocus={(e) => e.target.select()} aria-label={t('Código do convite')} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => call('app:copy', shown.token).then(() => toast(t('Copiado'))).catch(() => {})}>{t('Copiar')}</Button>
              <Button variant="primary" onClick={() => setShown(null)}>{t('Fechar')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function Rules({ org: o, fail, setError, toast }) {
  const t = useT();
  const policy = useQuery('org:call', { path: `/v1/orgs/${o.id}/policy` }, {});
  const p = policy.data;
  const [days, setDays] = useState(null);
  if (!p) return null;
  const shownDays = days === null ? (p.retention_days || '') : days;
  const save = async (patch) => { setError(''); try { await org('PUT', `/v1/orgs/${o.id}/policy`, { ...p, ...patch }); toast(t('Guardado.')); policy.reload(); } catch (e) { fail(e); } };
  return (
    <section className="card" aria-labelledby="st-rules">
      <h2 id="st-rules">{t('Regras da empresa')}</h2>
      <Field label={t('Apagar reuniões com mais de (dias)')} htmlFor="org-ret" hint={t('Vale para as cópias na nuvem de todos os membros. Vazio = guardar sempre.')}>
        <div className="row"><input id="org-ret" className="input" style={{ maxWidth: 120 }} inputMode="numeric" value={shownDays} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          <Button disabled={days === null} onClick={() => save({ retention_days: days ? Math.max(1, Math.min(3650, Number(days))) : null }).then(() => setDays(null))}>{t('Guardar')}</Button></div>
      </Field>
      <Switch checked={p.allow_cloud} onChange={(v) => save({ allow_cloud: v })} label={t('Permitir transcrição e notas na nuvem')} hint={t('Desligado: ninguém da organização envia áudio ou texto para o servidor.')} />
      <Switch checked={p.require_consent_reminder} onChange={(v) => save({ require_consent_reminder: v })} label={t('Lembrar de avisar os participantes')} hint={t('Mostra o lembrete antes de cada gravação.')} />
    </section>
  );
}

function Audit({ org: o, fail, setError, toast }) {
  const t = useT();
  const log = useQuery('org:call', { path: `/v1/orgs/${o.id}/audit`, query: { limit: 8 } }, { kinds: ['orgs'] });
  const exportAs = async (format) => { setError(''); try { const r = await call('org:auditExport', { orgId: o.id, format }); if (r && r.saved) toast(t('Guardado.')); } catch (e) { fail(e); } };
  return (
    <section className="card" aria-labelledby="st-aud">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <h2 id="st-aud">{t('Auditoria')}</h2>
        <span className="row"><Button size="sm" onClick={() => exportAs('csv')}>{t('Exportar CSV')}</Button><Button size="sm" onClick={() => exportAs('json')}>{t('Exportar JSON')}</Button></span>
      </div>
      {log.error ? <Banner tone="warn">{log.error.code === 'plan_required' ? t('O registo de auditoria precisa do plano Equipa ou Empresa.') : friendly(log.error)}</Banner> : null}
      <div className="col" style={{ gap: 4 }}>
        {(log.data || []).map((e) => <span key={e.id} style={{ fontSize: 13 }}><span className="mono muted">{new Date(e.at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</span> · {e.action}</span>)}
        {log.data && log.data.length === 0 && <span className="muted">{t('Nada registado ainda.')}</span>}
      </div>
    </section>
  );
}

function Enterprise({ org: o, fail, setError, toast }) {
  const t = useT();
  const sso = useQuery('org:call', { path: `/v1/orgs/${o.id}/sso` }, {});
  const [form, setForm] = useState(null);
  const [token, setToken] = useState(null);
  const [testing, setTesting] = useState('');
  const s = sso.data;
  if (!s) return null;
  const f = form || { issuer: s.issuer, client_id: s.client_id, client_secret: '', domains: (s.domains || []).join(', '), enabled: s.configured ? s.enabled : true };
  const set = (patch) => setForm({ ...f, ...patch });
  const save = async (e) => {
    e.preventDefault(); setError('');
    try {
      await org('PUT', `/v1/orgs/${o.id}/sso`, { issuer: f.issuer.trim(), client_id: f.client_id.trim(), client_secret: f.client_secret, domains: f.domains.split(/[\s,;]+/).filter(Boolean), enabled: f.enabled });
      toast(t('Guardado.')); setForm(null); sso.reload();
    } catch (err) { fail(err); }
  };
  const test = async () => { setTesting(''); try { const r = await org('POST', `/v1/orgs/${o.id}/sso/test`); setTesting(t('O fornecedor de identidade respondeu bem.')); return r; } catch (err) { setTesting(err.code === 'sso_unavailable' ? t('Não foi possível ler as definições do fornecedor. Confirma o endereço.') : friendly(err)); } };
  return (
    <section className="card" aria-labelledby="st-ent">
      <h2 id="st-ent">{t('Início de sessão da empresa e diretório')}</h2>
      <p className="muted" style={{ fontSize: 13 }}>{t('Plano Empresa. As pessoas entram com a conta da empresa (OpenID Connect: Microsoft Entra ID, Google Workspace, Okta, Keycloak). No teu fornecedor, regista este endereço de retorno:')} <span className="mono">{s.redirect_uri}</span></p>
      <form className="col" style={{ gap: 12 }} onSubmit={save}>
        <Field label={t('Endereço do emissor (issuer)')} htmlFor="sso-iss"><input id="sso-iss" className="input" value={f.issuer} onChange={(e) => set({ issuer: e.target.value })} placeholder="https://login.empresa.com" /></Field>
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
          <Field label={t('ID do cliente')} htmlFor="sso-id"><input id="sso-id" className="input" value={f.client_id} onChange={(e) => set({ client_id: e.target.value })} /></Field>
          <Field label={t('Segredo do cliente')} htmlFor="sso-sec" hint={s.has_secret ? t('Já guardado. Deixa vazio para o manter.') : ''}><input id="sso-sec" type="password" className="input" autoComplete="off" value={f.client_secret} onChange={(e) => set({ client_secret: e.target.value })} /></Field>
        </div>
        <Field label={t('Domínios de email da empresa')} htmlFor="sso-dom" hint={t('Separados por vírgula. Só estes emails podem entrar.')}><input id="sso-dom" className="input" value={f.domains} onChange={(e) => set({ domains: e.target.value })} placeholder="empresa.com" /></Field>
        <Switch checked={f.enabled} onChange={(v) => set({ enabled: v })} label={t('Ligado')} />
        {testing && <Banner tone="info">{testing}</Banner>}
        <div className="row wrap"><Button type="submit" variant="primary" disabled={!f.issuer || !f.client_id || !f.domains}>{t('Guardar')}</Button>
          {s.configured && <Button onClick={test}>{t('Testar ligação')}</Button>}
          {s.configured && <Button variant="danger" onClick={async () => { try { await org('DELETE', `/v1/orgs/${o.id}/sso`); toast(t('Desligado.')); setForm(null); sso.reload(); } catch (e) { fail(e); } }}>{t('Remover')}</Button>}</div>
      </form>
      <div className="col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <strong>{t('Diretório (SCIM)')}</strong>
        <span className="muted" style={{ fontSize: 13 }}>{t('Deixa o teu diretório adicionar pessoas novas e remover quem sai. Quem sai fica sem acesso.')} {s.scim_enabled ? t('Está ligado.') : ''}</span>
        <div className="row wrap">
          <Button onClick={async () => { try { setToken(await org('POST', `/v1/orgs/${o.id}/scim-token`)); sso.reload(); } catch (e) { fail(e); } }}>{s.scim_enabled ? t('Criar novo token') : t('Ligar e criar token')}</Button>
          {s.scim_enabled && <Button onClick={async () => { try { await org('DELETE', `/v1/orgs/${o.id}/scim-token`); toast(t('Desligado.')); sso.reload(); } catch (e) { fail(e); } }}>{t('Desligar')}</Button>}
        </div>
      </div>
      {token && (
        <Dialog title={t('Token do diretório')} onClose={() => setToken(null)}>
          <div className="dialog-body">
            <p>{t('Cola isto no teu diretório. O token aparece só agora.')}</p>
            <Field label={t('Endereço base')} htmlFor="scim-url"><input id="scim-url" className="input mono" readOnly value={token.base_url} onFocus={(e) => e.target.select()} /></Field>
            <Field label={t('Token')} htmlFor="scim-tok"><input id="scim-tok" className="input mono" readOnly value={token.token} onFocus={(e) => e.target.select()} /></Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" onClick={() => setToken(null)}>{t('Fechar')}</Button></div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
