import React, { useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Skeleton, RecDot } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import VerifyEmail from './VerifyEmail.jsx';
import SyncPrompt from '../components/SyncPrompt.jsx';
import PayBanners from '../components/PayBanners.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import { clockStr, durationStr, eventWhen, groupByDay, hm, monthName, statusOf, tasksLabel } from '../lib/format.mjs';


export default function Home() {
  const t = useT();
  const { route, nav, rec, openStart, auth } = useApp();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(8);
  const [verifying, setVerifying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dropped, setDropped] = useState(null);                 // an audio file dropped on the page
  const folderId = route.folderId || null;
  const folders = useQuery('folders:list', null, { kinds: ['folders'] });
  const list = useQuery('meetings:list', { folderId, q }, { kinds: ['meetings', 'folders'] });
  const usage = useQuery('usage:get', null, { kinds: ['meetings'] });
  const cal = useQuery('calendar:upcoming', null, { kinds: [] });

  const recording = rec && (rec.phase === 'recording' || rec.phase === 'paused');
  const meetings = (list.data || []).filter((m) => m.status !== 'recording' && m.status !== 'paused');
  const visible = meetings.slice(0, limit);
  const groups = groupByDay(visible);
  const folderName = folderId && folders.data ? (folders.data.find((f) => f.id === folderId) || {}).name : '';
  const u = usage.data;
  const now = new Date();
  const nextReset = t('1 de {month}', { month: monthName(new Date(now.getFullYear(), now.getMonth() + 1, 1)) });
  const loading = list.loading;
  const totalEver = (list.data || []).length;

  return (
    <div className="page framed" onDragOver={(e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|opus|flac|webm|mp4)$/i.test(f.name))) { e.preventDefault(); setDropped(f); setImporting(true); } }}>
      <div className="page-inner">
        <header className="page-head">
          <h1 className="display">{folderName || t('Início')}</h1>
          <div className="row wrap grow" style={{ justifyContent: 'flex-end', flex: '1 1 420px' }}>
            <div className="search-wrap grow" style={{ maxWidth: 360, flex: '1 1 220px' }}>
              <label className="sr-only" htmlFor="h-search">{t("Pesquisar reuniões")}</label>
              <Icon name="search" size={18} />
              <input id="h-search" className="input search" placeholder={t("Pesquisar reuniões")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="sr-only" htmlFor="h-folder">{t("Filtrar por pasta")}</label>
            <select id="h-folder" className="select" value={folderId || ''} onChange={(e) => nav('home', { folderId: e.target.value || null })}>
              <option value="">{t("Todas as pastas")}</option>
              {(folders.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <Button icon="arrowDown" onClick={() => { setDropped(null); setImporting(true); }}>{t("Importar áudio")}</Button>
            {!recording && <Button variant="primary" icon="plus" onClick={() => openStart()}>{t("Nova reunião")}</Button>}
          </div>
        </header>

        <div className="page-scroll">
        <SyncPrompt />
        {auth.user && auth.user.email_verified === false && (
          <Banner tone="info" action={<Button size="sm" onClick={() => setVerifying(true)}>{t('Introduzir código')}</Button>}>
            {t('Confirma o teu email para criares organizações, convidares pessoas ou comprares um plano.')}
          </Banner>
        )}

        <PayBanners />

        {u && u.limit != null && (
          <Banner tone={u.used >= u.limit ? 'warn' : 'info'} action={<a href="#" onClick={(e) => { e.preventDefault(); nav('plans'); }}>{t("Ver planos")}</a>}>
            {u.used >= u.limit
              ? t('Usaste {limit} de {limit} reuniões este mês. Podes continuar a ler, editar e exportar. Novas gravações voltam a {reset}.', { limit: u.limit, reset: nextReset })
              : t('Usaste {used} de {limit} reuniões este mês. O contador volta a zero a {reset}.', { used: u.used, limit: u.limit, reset: nextReset })}
          </Banner>
        )}

        <section aria-labelledby="h-next" className="col" style={{ gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 id="h-next" className="section">{t("A seguir")}</h2>
            <span className="muted" style={{ fontSize: 12 }}>{t('Próximas 48 horas')}{cal.data && cal.data.connected ? ` · ${t('O teu calendário')}` : ''}</span>
          </div>
          <div className="up-grid">
            {recording && (
              <div className="up-card">
                <div className="col" style={{ gap: 4 }}>
                  <span className="row tone-rec" style={{ fontSize: 12, gap: 6 }}><RecDot small />{rec.phase === 'paused' ? t('Em pausa') : t('A gravar')} · <span className="mono">{clockStr(rec.elapsedMs)}</span></span>
                  <strong>{rec.title || t('Reunião sem título')}</strong>
                </div>
                <div><Button variant="primary" size="sm" onClick={() => nav('live')}>{t("Abrir notas")}</Button></div>
              </div>
            )}
            {cal.data && cal.data.events.slice(0, 4).map((e) => (
              <div className="up-card" key={e.id}>
                <div className="col" style={{ gap: 4 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-hover)' }}>{eventWhen(e.start, e.end)}</span>
                  <strong>{e.title}</strong>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted" style={{ fontSize: 12 }}>{e.attendees.length ? e.attendees.slice(0, 2).map((a) => a.name || a.email).join(', ') + (e.attendees.length > 2 ? ` +${e.attendees.length - 2}` : '') : ''}</span>
                  {!recording && <Button size="sm" onClick={() => openStart({ title: e.title, attendees: e.attendees, calendarEventId: e.id, subtitle: t('Do teu calendário · {from}–{to}', { from: hm(new Date(e.start).toISOString()), to: hm(new Date(e.end).toISOString()) }) })}>{t("Tomar notas")}</Button>}
                </div>
              </div>
            ))}
          </div>
          {cal.data && !cal.data.connected && !recording && (
            <div><Button size="sm" variant="ghost" onClick={() => nav('settings', { section: 'cal' })}>{t("Liga o teu calendário")}</Button></div>
          )}
          {cal.data && cal.data.error && <span className="muted" style={{ fontSize: 13 }}>{t("Não foi possível ler o calendário agora.")}</span>}
        </section>

        <section aria-labelledby="h-recent" className="col" style={{ gap: 16 }}>
          <h2 id="h-recent" className="section">{t("Recentes")}</h2>
          {loading && <div className="col" style={{ gap: 14 }} aria-busy="true"><Skeleton w="55%" /><Skeleton w="68%" /><Skeleton w="40%" /></div>}
          {!loading && totalEver === 0 && !q && (
            <div className="empty">
              <h3>{t("Grava a tua primeira reunião.")}</h3>
              <p className="muted" style={{ maxWidth: 320 }}>{t("Funciona com Zoom, Meet, Teams, WhatsApp ou uma conversa na mesma sala. Nenhum bot entra na chamada.")}</p>
              <Button variant="primary" size="lg" onClick={() => openStart()}>{t("Começar a gravar")}</Button>
              <span className="muted" style={{ fontSize: 12 }}>{t("Guardada neste computador.")}</span>
            </div>
          )}
          {!loading && totalEver > 0 && meetings.length === 0 && <p className="muted">{t("Nenhuma reunião encontrada.")}</p>}
          {groups.map((g) => (
            <div className="col" style={{ gap: 4 }} key={g.heading}>
              <h3 className="h-sub" style={{ marginBottom: 4 }}>{g.heading}</h3>
              {g.items.map((m) => {
                const st = statusOf(m);
                return (
                  <button type="button" key={m.id} className="m-row" onClick={() => nav('detail', { id: m.id })} title={m.title}>
                    <span className="title">{m.title || t('Reunião sem título')}</span>
                    <span className="meta">
                      <span className="mono" style={{ fontSize: 12 }}>{hm(m.startedAt || m.createdAt)}</span>
                      <span>{durationStr(m.durationSeconds)}</span>
                      <span>{m.folderName}</span>
                      <span className="c1">{tasksLabel(m)}</span>
                      <span className={`c2 tone-${st.tone}`}>{st.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {meetings.length > limit && <Button variant="ghost" onClick={() => setLimit(limit + 20)} style={{ alignSelf: 'flex-start' }}>{t("Mostrar reuniões anteriores")}</Button>}
        </section>
        </div>
      </div>
      {verifying && <VerifyEmail onClose={() => setVerifying(false)} />}
      {importing && <ImportDialog initialFile={dropped} onClose={() => { setImporting(false); setDropped(null); }} />}
    </div>
  );
}
