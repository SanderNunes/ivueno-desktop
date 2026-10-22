import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Dialog, Field, Seg, Switch } from '../components/ui.jsx';
import { useApp, PLAN_NAMES, TEMPLATE_NAMES } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { listMics } from '../lib/audio.js';
import { friendly } from '../lib/errors.mjs';
import { monthName, passwordStrength } from '../lib/format.mjs';
import { LANGUAGES, useT } from '../lib/i18n.js';
import VerifyEmail from './VerifyEmail.jsx';

const TABS = [['perfil', 'Perfil'], ['disp', 'Dispositivos'], ['sync', 'Sincronização'], ['grav', 'Gravação'], ['dit', 'Ditado'], ['cal', 'Calendário'], ['rec', 'Receitas'], ['priv', 'Privacidade'], ['org', 'Organização'], ['plano', 'Plano e uso']];

/** Settings as tabs along the top: one section at a time, the sidebar of the app never changes. */
export default function Settings() {
  const { route } = useApp();
  const t = useT();
  const [tab, setTab] = useState(route.section && TABS.some(([id]) => id === route.section) ? route.section : 'perfil');
  useEffect(() => { if (route.section && TABS.some(([id]) => id === route.section)) setTab(route.section); }, [route.section]);
  const onKey = (e) => {
    const i = TABS.findIndex(([id]) => id === tab);
    if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length][0]);
    if (e.key === 'ArrowLeft') setTab(TABS[(i - 1 + TABS.length) % TABS.length][0]);
  };
  return (
    <div className="page framed" style={{ '--max': '880px' }}>
      <div className="page-inner" style={{ gap: 20 }}>
        <h1 className="display">{t('set.title')}</h1>
        <div role="tablist" aria-label={t("Definições")} className="tabs" onKeyDown={onKey}>
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`tab-${id}`} className="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{t(`set.${id}`)}</button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="col page-scroll" style={{ gap: 24 }}>
          {tab === 'perfil' && <Profile />}
          {tab === 'disp' && <Devices />}
          {tab === 'grav' && <><Recording /><AudioKeepCard /></>}
          {tab === 'dit' && <DictationSection />}
          {tab === 'cal' && <CalendarSection />}
          {tab === 'rec' && <RecipesSection />}
          {tab === 'sync' && <><SyncCard /><PhoneCard /></>}
          {tab === 'priv' && <Privacy />}
          {tab === 'org' && <OrgSection />}
          {tab === 'plano' && <PlanUsage />}
        </div>
      </div>
    </div>
  );
}

// Turn a key press into the text Electron wants ("Control+Shift+I"). Needs at least one modifier, except for F-keys.
function accelerator(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code;
  if (key === 'Space' || /^F\d{1,2}$/.test(key) || /^[A-Z0-9]$/.test(key)) { /* fine */ } else return null;
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null;
  return [...mods, key].join('+');
}

function HotkeyField({ label, hint, value, onChange, ok }) {
  const t = useT();
  const [capturing, setCapturing] = useState(false);
  return (
    <div className="list-row">
      <span className="col"><strong>{label}</strong><span className="muted" style={{ fontSize: 12 }}>{hint}</span>
        {ok === false && <span style={{ fontSize: 12, color: 'var(--error)' }}>{t("O Windows não deixou usar este atalho: outra aplicação já o usa. Escolhe outro.")}</span>}</span>
      <button type="button" className="btn mono" aria-label={`${label}: ${value}. Clica e carrega nas teclas novas`}
        onClick={() => setCapturing(true)} onBlur={() => setCapturing(false)}
        onKeyDown={(e) => {
          if (!capturing) return;
          e.preventDefault();
          if (e.key === 'Escape') { setCapturing(false); return; }
          const a = accelerator(e);
          if (a) { onChange(a); setCapturing(false); }
        }}>{capturing ? 'Carrega nas teclas…' : value.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl')}</button>
    </div>
  );
}

function DictationSection() {
  const t = useT();
  const { settings, patchSettings, info } = useApp();
  const status = useQuery('hotkeys:status', null, { kinds: ['hotkeys'] });
  const st = status.data || {};
  return (
    <section id="dit" className="card" aria-labelledby="st-dit">
      <h2 id="st-dit">{t("Ditado e atalhos")}</h2>
      <Switch checked={settings.dictation} onChange={(v) => patchSettings({ dictation: v })} label={t("Ativar o ditado")} hint={t("Carrega no atalho, fala, e carrega outra vez. A ilha mostra “A ouvir”.")} />
      <HotkeyField label={t("Atalho do ditado")} hint={t("Carrega uma vez para começar e outra para parar.")} value={settings.hotkeyDictation} ok={settings.dictation ? st.dictation : null} onChange={(v) => patchSettings({ hotkeyDictation: v })} />
      <HotkeyField label={t("Atalho da ilha")} hint={t("Abre e recolhe a ilha de gravação.")} value={settings.hotkeyIsland} ok={st.island} onChange={(v) => patchSettings({ hotkeyIsland: v })} />
      <div className="row muted" style={{ fontSize: 13, gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)', alignItems: 'flex-start' }}>
        <Icon name="info" size={16} stroke={1.8} style={{ flex: 'none', marginTop: 2 }} />
        <span>{t('O atalho funciona como interruptor (não é preciso manter premido).')} {info.engine.realTranscription ? '' : t('Com o motor de demonstração, o ditado ouve mas ainda não escreve texto: falta o motor de voz.')}</span>
      </div>
    </section>
  );
}

function Profile() {
  const { auth, refreshAuth, toast, settings, patchSettings } = useApp();
  const t = useT();
  const [name, setName] = useState((auth.user && auth.user.name) || '');
  const [pw, setPw] = useState(false);
  const [verifying, setVerifying] = useState(false);
  async function saveName() {
    if (name.trim() === (auth.user.name || '')) return;
    try { await call('auth:updateProfile', { name: name.trim() }); await refreshAuth(); toast('Nome guardado'); } catch (e) { toast(friendly(e)); }
  }
  return (
    <section id="perfil" className="card" aria-labelledby="st-p">
      <h2 id="st-p">{t("Perfil")}</h2>
      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 16 }}>
        <Field label={t("Nome")} htmlFor="st-name"><input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} /></Field>
        <Field label={t("Email")} htmlFor="st-mail">
          <input id="st-mail" className="input" value={(auth.user && auth.user.email) || ''} disabled />
          {auth.user && (auth.user.email_verified
            ? <span className="row" style={{ fontSize: 12, color: 'var(--success)', gap: 6, fontWeight: 600 }}><Icon name="check" size={14} stroke={2.2} />{t('Email confirmado')}</span>
            : <span className="row" style={{ fontSize: 12, gap: 8 }}><span style={{ color: 'var(--warning)', fontWeight: 600 }}>{t('Email por confirmar')}</span>
              <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setVerifying(true); }}>{t('Introduzir código')}</a></span>)}
        </Field>
        <Field label={t('set.appLang')} htmlFor="st-lang">
          <select id="st-lang" className="select" value={settings.appLanguage || 'pt'} onChange={(e) => patchSettings({ appLanguage: e.target.value })}>
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
        <Field label={t('set.theme')} htmlFor="st-theme">
          <select id="st-theme" className="select" value={settings.theme} onChange={(e) => patchSettings({ theme: e.target.value })}>
            <option value="system">{t("Como o Windows")}</option><option value="light">{t("Claro")}</option><option value="dark">{t("Escuro")}</option>
          </select>
        </Field>
      </div>
      <div className="row wrap" style={{ justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <span className="col"><strong>{t("Palavra-passe")}</strong><span className="muted" style={{ fontSize: 12 }}>{t("Mínimo 10 caracteres")}</span></span>
        <Button onClick={() => setPw(true)}>{t("Mudar palavra-passe")}</Button>
      </div>
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
      {verifying && <VerifyEmail onClose={() => setVerifying(false)} />}
    </section>
  );
}

function PasswordDialog({ onClose }) {
  const t = useT();
  const { toast } = useApp();
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [err, setErr] = useState('');
  const strength = passwordStrength(next);
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { await call('auth:changePassword', { current: cur, next }); toast('Palavra-passe mudada'); onClose(); } catch (x) { setErr(friendly(x)); }
  }
  return (
    <Dialog title={t("Mudar palavra-passe")} onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        {err && <Banner tone="error" role="alert">{err}</Banner>}
        <Field label={t("Palavra-passe atual")} htmlFor="pw-cur"><input id="pw-cur" type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label={t("Nova palavra-passe")} htmlFor="pw-new" hint={strength.label}><input id="pw-new" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" variant="primary" disabled={!cur || !strength.ok}>{t("Mudar")}</Button></div>
      </form>
    </Dialog>
  );
}

function Devices() {
  const t = useT();
  const { toast } = useApp();
  const { data, error, reload } = useQuery('auth:devices', null, {});
  return (
    <section id="disp" className="card" aria-labelledby="st-d">
      <h2 id="st-d">{t("Dispositivos com sessão iniciada")}</h2>
      {error && <span className="muted">{friendly(error)}</span>}
      {(data || []).map((d, i) => (
        <div className="list-row" key={d.id}>
          <span className="col"><strong>{d.device || t('Dispositivo')}</strong><span className="muted" style={{ fontSize: 12 }}>{t('Sessão iniciada a {date}', { date: new Date(d.created_at).toLocaleDateString('pt-PT') })}</span></span>
          <Button size="sm" onClick={async () => { try { await call('auth:endDevice', d.id); reload(); } catch (e) { toast(friendly(e)); } }}>{t("Terminar sessão")}</Button>
        </div>
      ))}
    </section>
  );
}

function Recording() {
  const t = useT();
  const { settings, patchSettings, info } = useApp();
  const { auth, nav } = useApp();
  const cloud = useQuery('cloud:usage', null, {});
  const [mics, setMics] = useState([]);
  useEffect(() => { listMics().then(setMics); }, []);
  return (
    <section id="grav" className="card" aria-labelledby="st-g">
      <h2 id="st-g">{t("Gravação · predefinições")}</h2>
      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
        <Field label={t("Microfone")} htmlFor="st-mic">
          <select id="st-mic" className="select" value={settings.micId} onChange={(e) => patchSettings({ micId: e.target.value })}>
            <option value="">{t("Predefinido do Windows")}</option>
            {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <Field label={t("Idioma falado")} htmlFor="st-sl">
          <select id="st-sl" className="select" value={settings.language} onChange={(e) => patchSettings({ language: e.target.value })}>
            <option value="auto">{t("Automático")}</option><option value="pt">Português</option><option value="en">English</option>
          </select>
        </Field>
        <Field label={t("Estilo das notas")} htmlFor="st-ns">
          <select id="st-ns" className="select" value={settings.template} onChange={(e) => patchSettings({ template: e.target.value })}>
            {Object.entries(TEMPLATE_NAMES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </Field>
      </div>
      <div className="col" style={{ gap: 4 }}>
        <span className="label">{t('Transcrição e IA')}</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {t('O áudio é enviado ao serviço de transcrição da Ivuenu e apagado logo a seguir; o texto é enviado para escrever as notas, os resumos e os emails. As reuniões ficam guardadas neste computador.')}
          {cloud.data ? ` ${t('{used} de {limit} minutos usados este mês.', { used: cloud.data.minutes_used, limit: cloud.data.minutes_limit })}` : ''}
        </span>
      </div>
      <Switch checked={settings.captureSystem} onChange={(v) => patchSettings({ captureSystem: v })} label={t("Gravar o som do computador")} hint={t("Necessário para ouvir quem está do outro lado da chamada")} />
      <Switch checked={settings.keepTranscript} onChange={(v) => patchSettings({ keepTranscript: v })} label={t("Guardar a transcrição depois das notas")} hint={t("Desligado = só notas: a transcrição é apagada depois")} />
      <Switch checked={settings.redact} onChange={(v) => patchSettings({ redact: v })} label={t("Ocultar detalhes sensíveis")} hint={t("Cartões e palavras-passe ficam •••• na transcrição e nas notas")} />
      <Switch checked={settings.island} onChange={(v) => patchSettings({ island: v })} label={t("Mostrar a ilha de gravação")} hint={t("Uma pílula no topo do ecrã enquanto gravas. Atalho: Ctrl+Shift+I")} />
      <div className="row muted" style={{ fontSize: 13, gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <Icon name="info" size={16} stroke={1.8} />{info.engine.realTranscription ? t('Transcrição e IA: serviço da Ivuenu, na nuvem.') : t('Modo de desenvolvimento: a conversa é simulada.')}
      </div>
    </section>
  );
}

function CalendarSection() {
  const t = useT();
  const { toast } = useApp();
  const status = useQuery('calendar:status', null, {});
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function connect(e) {
    e.preventDefault(); setBusy(true);
    try { await call('calendar:set', url); setUrl(''); status.reload(); toast(t('Calendário ligado')); } catch (x) { toast(friendly(x)); }
    setBusy(false);
  }
  const s = status.data;
  return (
    <section id="cal" className="card" aria-labelledby="st-c">
      <h2 id="st-c">{t("Calendário")} <span className="tag" style={{ verticalAlign: 'middle', fontSize: 12, fontWeight: 600 }}>{t("no computador")}</span></h2>
      {s && s.connected ? (
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <span className="col"><strong>{t('Ligado a {host}', { host: s.host })}</strong><span className="muted" style={{ fontSize: 12 }}>{t("Lido neste computador. Só títulos, horas e participantes.")}</span></span>
          <Button size="sm" onClick={async () => { await call('calendar:clear'); status.reload(); }}>{t("Desligar")}</Button>
        </div>
      ) : (
        <form className="col" style={{ gap: 10 }} onSubmit={connect}>
          <p className="muted">{t("Cola o endereço secreto (.ics) do teu calendário Outlook ou Google. Fica guardado encriptado neste computador e nunca é mostrado.")}</p>
          <div className="row wrap">
            <label className="sr-only" htmlFor="st-ics">{t("Endereço do calendário")}</label>
            <input id="st-ics" type="password" autoComplete="off" className="input grow" style={{ flex: '1 1 320px' }} placeholder={t("https://… ou webcal://…")} value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" variant="primary" disabled={!url.trim() || busy}>{busy ? 'A verificar…' : 'Ligar'}</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function RecipesSection() {
  const t = useT();
  const { auth, nav, toast } = useApp();
  const { data, reload } = useQuery('recipes:list', null, {});
  const [edit, setEdit] = useState(null);
  const paid = auth.licence.plan !== 'free';
  async function save(e) {
    e.preventDefault();
    try { await call('recipes:save', edit); setEdit(null); reload(); } catch (x) { toast(friendly(x)); }
  }
  return (
    <section id="rec" className="card" aria-labelledby="st-r">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 id="st-r">{t("Receitas")}</h2>
        {paid ? <Button size="sm" variant="primary" onClick={() => setEdit({ name: '', prompt: '', view: 'done' })}>{t("Nova receita")}</Button> : <Button size="sm" icon="lock" onClick={() => nav('plans')}>{t("Receitas próprias: Pro")}</Button>}</div>
      <p className="muted">{t("As ajudas de um clique. As da Ivuenu só se leem; as tuas podes editar.")}</p>
      {(data ? data.mine : []).map((r) => (
        <div className="list-row" key={r.id}><span className="col"><strong>{r.name}</strong><span className="muted" style={{ fontSize: 12 }}>Tua · “{r.prompt}”</span></span>
          <span className="row"><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>{t("Editar")}</Button>
            <Button size="sm" variant="ghost" aria-label={`Apagar receita ${r.name}`} onClick={async () => { await call('recipes:delete', r.id); reload(); }}><Icon name="trash" size={16} /></Button></span></div>
      ))}
      {(data ? data.builtin : []).map((r) => (
        <div className="list-row" key={r.id}><span className="col"><strong>{t(r.name)}</strong><span className="muted" style={{ fontSize: 12 }}>Ivuenu · {r.view === 'live' ? t('ao vivo') : t('depois da reunião')}</span></span>
          <span className="muted row" style={{ fontSize: 12, gap: 4 }}><Icon name="lock" size={14} stroke={1.8} />{t("Só leitura")}</span></div>
      ))}
      {edit && (
        <Dialog title={edit.id ? 'Editar receita' : 'Nova receita'} onClose={() => setEdit(null)}>
          <form className="dialog-body" onSubmit={save}>
            <Field label={t("Nome")} htmlFor="rc-n"><input id="rc-n" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label={t("O que pedir")} htmlFor="rc-p"><textarea id="rc-p" className="input" style={{ height: 100, padding: 10 }} value={edit.prompt} onChange={(e) => setEdit({ ...edit, prompt: e.target.value })} /></Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}><Button onClick={() => setEdit(null)}>{t("Cancelar")}</Button><Button type="submit" variant="primary" disabled={!edit.name.trim() || !edit.prompt.trim()}>{t("Guardar")}</Button></div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

function Privacy() {
  const t = useT();
  const { toast, refreshAuth } = useApp();
  const [typed, setTyped] = useState('');
  const ok = typed.trim() === 'APAGAR';
  async function del() {
    try { await call('auth:deleteAccount'); await refreshAuth(); } catch (e) { toast(friendly(e)); }
  }
  return (
    <section id="priv" className="card" aria-labelledby="st-v">
      <h2 id="st-v">{t("Privacidade")}</h2>
      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
        {[['Áudio', 'É enviado para transcrição e apagado logo a seguir.'], ['Transcrições e notas', 'Ficam no teu computador. O texto vai para a nuvem só para escrever notas, resumos e emails.'], ['Nuvem', 'Nada fica guardado no servidor, a não ser a cópia encriptada, se a ligares.']].map(([title, d]) => (
          <div key={title} className="col" style={{ padding: 14, borderRadius: 8, background: 'var(--bg)', gap: 4 }}><strong>{t(title)}</strong><span className="muted" style={{ fontSize: 13 }}>{t(d)}</span></div>
        ))}
      </div>
      <div className="danger-zone">
        <strong style={{ color: 'var(--error)' }}>{t("Apagar a minha conta e dados")}</strong>
        <span>{t("Apaga a conta, todas as reuniões, notas e transcrições, neste computador e na conta. Não dá para desfazer.")}</span>
        <label htmlFor="st-del" style={{ fontSize: 13, fontWeight: 600 }}>{t("Escreve")} <span className="mono" style={{ background: 'var(--sunken)', padding: '0 4px', borderRadius: 4 }}>APAGAR</span> {t("para confirmar")}</label>
        <div className="row wrap">
          <input id="st-del" className="input mono grow" style={{ flex: '1 1 200px' }} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Button variant="danger" disabled={!ok} onClick={del}>{t("Apagar a minha conta e dados")}</Button>
        </div>
      </div>
    </section>
  );
}

import PayHistory from '../components/PayHistory.jsx';
import SyncCard from '../components/SyncCard.jsx';
import PhoneCard from '../components/PhoneCard.jsx';
import AudioKeepCard from '../components/AudioKeepCard.jsx';
import OrgSection from '../components/OrgSection.jsx';

function PlanUsage() {
  const t = useT();
  const { auth, nav } = useApp();
  const usage = useQuery('usage:get', null, { kinds: ['meetings'] });
  const { data: sync } = useQuery('sync:status', null, { kinds: ['sync'] });
  const u = usage.data;
  const next = monthName(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  return (
    <>
    <section id="plano" className="card" aria-labelledby="st-pl">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 id="st-pl">{t("Plano e uso")}</h2><a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); nav('plans'); }}>{t("Ver planos")}</a></div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <strong>{PLAN_NAMES[auth.licence.plan] === 'Gratuito' ? t('Gratuito') : PLAN_NAMES[auth.licence.plan] || t('Gratuito')}</strong>
        <span>{u && u.limit != null ? <><span className="mono">{u.used} / {u.limit}</span> {t("reuniões este mês")}</> : u ? t('{n} reuniões este mês', { n: u.used }) : ''}</span>
      </div>
      {u && u.limit != null && <div className="progress" role="progressbar" aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.limit} aria-label={t("Reuniões usadas este mês")}><div style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} /></div>}
      {u && u.limit != null && <span className="muted" style={{ fontSize: 12 }}>{t('Volta a zero a 1 de {month}.', { month: next })}</span>}
      <div className="row wrap" style={{ justifyContent: 'space-between', fontSize: 13, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <span><strong>{t('Sincronização')}</strong> · {sync && sync.eligible === false ? t('só nos planos pagos') : sync && sync.enabled ? t('Ligada') : t('Desligada')}{sync && sync.eligible !== false && !sync.enabled ? ` · ${t('as reuniões só existem neste computador')}` : ''}</span>
        <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); if (sync && sync.eligible === false) nav('plans'); else nav('settings', { section: 'sync' }); }}>{sync && sync.eligible === false ? t('Ver planos') : sync && sync.enabled ? t('Ver') : t('Ligar')}</a>
      </div>
    </section>
      <PayHistory />
    </>
  );
}
