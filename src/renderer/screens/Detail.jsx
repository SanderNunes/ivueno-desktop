import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Avatar, Banner, Button, Chip, Dialog, IconButton } from '../components/ui.jsx';
import { useApp, TEMPLATE_NAMES } from '../lib/app-context.js';
import { useMeeting, useQuery, useDebounced, useDismiss } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import RefineBar from '../components/RefineBar.jsx';
import { clockStr, durationStr, fold, highlightParts, parseClock, weekdayName } from '../lib/format.mjs';
import { friendly } from '../lib/errors.mjs';
import SummarizeDialog from '../components/SummarizeDialog.jsx';
import EmailDialog from '../components/EmailDialog.jsx';
import ShareDialog from '../components/ShareDialog.jsx';

const p2 = (n) => String(n).padStart(2, '0');
const hms = (s) => (/^\d\d:\d\d:\d\d$/.test(s) ? s : '');

export default function Detail() {
  const t = useT();
  const { route, nav, toast, auth, settings } = useApp();
  const id = route.id;
  const { data: m, loading, error } = useMeeting(id);
  const { data: syncState } = useQuery('sync:status', null, { kinds: ['sync'] });
  const folders = useQuery('folders:list', null, { kinds: ['folders'] });
  const recipes = useQuery('recipes:list', null, { kinds: [] });
  const [tab, setTab] = useState(route.tab || 'notes');
  const [goto, setGoto] = useState(route.atMs ?? null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useDismiss(exportOpen, () => setExportOpen(false));
  const [includeTr, setIncludeTr] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recipe, setRecipe] = useState(null);
  const [summing, setSumming] = useState(null);            // null | 'meeting' | 'notes': the summarise dialog
  const [emailing, setEmailing] = useState(false);
  const [sharing, setSharing] = useState(false);

  // --- the person's own notes (autosave) ---
  const [mine, setMine] = useState('');
  const [saved, setSaved] = useState('saved');
  const dirty = useRef(false);
  const loadedFor = useRef(null);
  const saveNotes = useDebounced(async (text) => {
    try { await call('notes:setMine', { id, text }); dirty.current = false; setSaved('saved'); } catch (e) { toast(friendly(e)); }
  }, 1000);
  useEffect(() => { if (m && loadedFor.current !== m.id) { setMine(m.myNotes); loadedFor.current = m.id; } }, [m && m.id]);// eslint-disable-line
  useEffect(() => () => { if (dirty.current) saveNotes.flush(document.getElementById('dt-notes')?.value ?? ''); }, []);// eslint-disable-line

  const [title, setTitle] = useState('');
  useEffect(() => { if (m) setTitle(m.title); }, [m && m.id]);// eslint-disable-line

  if (loading) return <div className="detail"><div className="detail-inner"><div className="skel" style={{ height: 36, width: '50%' }} /></div></div>;
  if (error || !m) {
    return <div className="detail"><div className="detail-inner"><Banner tone="error" role="alert">{t("Esta reunião já não existe.")}</Banner><Button onClick={() => nav('home')}>{t("Voltar ao início")}</Button></div></div>;
  }

  const paid = auth.licence.plan !== 'free';
  const d = m.startedAt ? new Date(m.startedAt) : null;
  const when = d ? `${weekdayName(d)}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} · ${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
  const demoNotes = m.notesEngine === 'demo';
  const openTasks = m.tasks.filter((t) => !t.hidden);
  const detected = m.templateDetected && TEMPLATE_NAMES[m.templateDetected.key] ? m.templateDetected : null;
  const kindKey = m.template !== 'auto' ? m.template : (detected ? detected.key : null);        // the person's choice wins; on auto the detected kind is used

  async function rewrite(template) {
    try {
      if (template) await call('meetings:patch', { id, patch: { template } });
      await call('notes:generate', id);
    } catch (e) { toast(friendly(e)); }
  }
  async function doExport(format) {
    setExportOpen(false);
    try {
      const r = await call('export:run', { id, format, includeTranscript: includeTr });
      if (format === 'copy') toast('Notas copiadas'); else if (r && r.saved) toast(`Guardado: ${r.name}`);
    } catch (e) { toast(friendly(e)); }
  }
  async function runRecipe(r) {
    setRecipe({ name: r.name, text: 'A pensar…' });
    try { const out = await call('recipes:run', { id, recipeId: r.id, live: false }); setRecipe({ name: r.name, text: out.text }); }
    catch (e) { setRecipe({ name: r.name, text: friendly(e) }); }
  }

  function appendToNotes(text) {
    const next = `${mine.trimEnd()}${mine.trim() ? '\n\n' : ''}— ${t('Resumo')} —\n${text}`;
    setMine(next); dirty.current = true; setSaved('saving'); saveNotes.run(next);
  }

  const doneRecipes = recipes.data ? [...recipes.data.builtin.filter((r) => r.view === 'done'), ...recipes.data.mine] : [];

  return (
    <div className="detail framed">
      <div className="detail-inner">
        <button type="button" className="back" onClick={() => nav('home')}><Icon name="back" size={16} stroke={2} />{t("Início")}</button>

        <header className="page-head" style={{ alignItems: 'flex-start' }}>
          <div className="col grow" style={{ gap: 10, flex: '1 1 420px' }}>
            <label className="sr-only" htmlFor="dt-title">{t("Título")}</label>
            <input id="dt-title" className="title-input" style={{ flex: 'none', fontSize: 22, lineHeight: '30px', fontWeight: 600, height: 38, width: '100%' }} value={title} placeholder={t("Reunião sem título")}
              onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== m.title && call('meetings:patch', { id, patch: { title } })} />
            <div className="row wrap" style={{ gap: '8px 16px', fontSize: 13, color: 'var(--text-2)' }}>
              <span>{when}{m.durationSeconds != null ? ` · ${durationStr(m.durationSeconds)}` : ''}</span>
              <span className="row" style={{ paddingLeft: 7 }} aria-label={`${m.speakers.length} participantes`}>{m.speakers.map((s) => <Avatar key={s.key} stack color={s.color} initials={s.initials} title={s.display} />)}</span>
              {m.consent.status === 'confirmed'
                ? <span className="tag ok"><Icon name="shieldCheck" size={14} stroke={1.8} />{t("Participantes avisados")}</span>
                : <span className="tag"><Icon name="shield" size={14} stroke={1.8} />{t("Só notas pessoais")}</span>}
              <span className="row" style={{ gap: 6 }}><Icon name="laptop" size={14} stroke={1.8} />{t("Guardada neste computador.")}</span>
              {kindKey && TEMPLATE_NAMES[kindKey] && <span className="tag" title={m.template === 'auto' ? t('Tipo de reunião detetado automaticamente') : t('Tipo de reunião escolhido por ti')}>{t(TEMPLATE_NAMES[kindKey])}{m.template === 'auto' ? ` · ${t('automático')}` : ''}</span>}
            </div>
          </div>
          <div className="row wrap" style={{ position: 'relative' }}>
            <label className="sr-only" htmlFor="dt-folder">{t("Pasta")}</label>
            <select id="dt-folder" className="select" value={m.folderId || ''} onChange={(e) => call('meetings:patch', { id, patch: { folderId: e.target.value || null } })}>
              <option value="">{t("Sem pasta")}</option>
              {(folders.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <Button icon="mail" onClick={() => setEmailing(true)}>{t("Escrever email")}</Button>
            <Button icon="share" onClick={() => setSharing(true)}>{t("Partilhar")}</Button>
            <div ref={exportRef} style={{ position: 'relative' }}>
              <Button icon="export" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>{t("Exportar")}<Icon name="chevronDown" size={14} stroke={2} /></Button>
              {exportOpen && (
                <div className="menu" role="menu" style={{ top: 44, right: 0, width: 270 }}>
                  <button type="button" role="menuitem" onClick={() => doExport('copy')}>{t("Copiar notas como texto")}</button>
                  <button type="button" role="menuitem" onClick={() => doExport('docx')}>Word (.docx)</button>
                  <button type="button" role="menuitem" onClick={() => doExport('pdf')}>PDF</button>
                  <button type="button" role="menuitem" onClick={() => doExport('md')}>Markdown (.md)</button>
                  <hr />
                  <button type="button" role="menuitem" onClick={() => doExport('tasks-mail')}>{t("Enviar tarefas por email")}</button>
                  <label className="row" style={{ padding: '8px 10px', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={includeTr} onChange={(e) => setIncludeTr(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                    <span className="col"><span>{t("Incluir transcrição")}</span><span className="sub">{t("Desligado por defeito")}</span></span>
                  </label>
                </div>
              )}
            </div>
            {syncState && syncState.enabled && m.status === 'done' && (
              <IconButton icon="offline" bordered label={m.syncOff ? t('Voltar a sincronizar esta reunião') : t('Não sincronizar esta reunião')} aria-pressed={!!m.syncOff}
                onClick={() => call('meetings:patch', { id, patch: { syncOff: !m.syncOff } }).then(() => toast(m.syncOff ? t('Esta reunião volta a sincronizar.') : t('Esta reunião fica só neste computador.'))).catch((e) => toast(friendly(e)))} />
            )}
            <IconButton icon="trash" label={t("Apagar reunião")} onClick={() => setConfirmDelete(true)} />
          </div>
        </header>

        <RefineBar m={m} />

        <div role="tablist" aria-label={t("Secções da reunião")} className="tabs">
          {[['notes', t('Notas')], ['transcript', t('Transcrição')], ['tasks', t('Tarefas'), openTasks.filter((x) => !x.done).length], ['chat', t('Conversa')]].map(([k, label, n]) => (
            <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}{n ? <span className="n">{n}</span> : null}</button>
          ))}
        </div>

        <div className="page-scroll">
        <div className="row wrap" role="group" aria-label={t("Pedir à Ivuenu")}>
          <span className="h-sub" style={{ marginRight: 4 }}>{t("Pedir à Ivuenu")}</span>
          <Chip onClick={() => setSumming('meeting')}>{t("Resumir")}</Chip>
          {doneRecipes.map((r) => (r.paid && !paid
            ? <Chip key={r.id} locked icon="lock" title={t("Incluído no Pro")} onClick={() => nav('plans')}>{t(r.name)}<span className="sr-only">, {t('Incluído no Pro')}</span></Chip>
            : <Chip key={r.id} onClick={() => runRecipe(r)}>{t(r.name)}</Chip>))}
        </div>
        {recipe && (
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><strong>{recipe.name}</strong><IconButton icon="close" size="sm" label={t("Fechar")} onClick={() => setRecipe(null)} /></div>
            <p style={{ whiteSpace: 'pre-line', fontSize: 15, lineHeight: '24px' }}>{recipe.text}</p>
            <div><Button size="sm" icon="copy" onClick={() => navigator.clipboard.writeText(recipe.text).then(() => toast('Copiado'))}>{t("Copiar")}</Button></div>
          </div>
        )}

        {tab === 'notes' && (
          <div role="tabpanel" aria-label={t("Notas")} className="col" style={{ gap: 16 }}>
            {m.notesState === 'ready' && m.summary && (
              <div className="card row wrap" style={{ padding: '14px 16px', justifyContent: 'space-between', gap: 12 }}>
                <p style={{ flex: '1 1 420px', fontSize: 16, lineHeight: '24px' }}><b>{t("Resumo ·")} </b>{m.summary}</p>
                <Button size="sm" onClick={() => setSumming('meeting')}>{t("Resumir de novo")}</Button>
                <span className="row" style={{ gap: 2 }} role="group" aria-label={t("Avaliar o resumo")}>
                  <IconButton icon="thumb" size="sm" label={t("Resumo útil")} onClick={() => call('feedback:set', { id, value: 1 }).then(() => toast(t('Obrigado')))} />
                  <IconButton icon="thumb" size="sm" label={t("Resumo não útil")} style={{ transform: 'rotate(180deg)' }} onClick={() => call('feedback:set', { id, value: -1 }).then(() => toast(t('Obrigado')))} />
                </span>
              </div>
            )}
            <div className="two-col">
              <section className="note-card" aria-labelledby="dt-mine">
                <div className="row" style={{ justifyContent: 'space-between', padding: '16px 20px 8px' }}>
                  <h2 id="dt-mine" className="panel-title">{t("As tuas notas")}</h2>
                  <span className="row" style={{ gap: 10 }}>
                    {mine.trim().length >= 20 && <Button size="sm" onClick={() => setSumming('notes')}>{t("Resumir notas")}</Button>}
                    <span className="row muted" style={{ fontSize: 12, gap: 6 }}><Icon name="check" size={14} stroke={2} />{saved === 'saving' ? 'A guardar…' : 'Guardado'}</span>
                  </span>
                </div>
                <label className="sr-only" htmlFor="dt-notes">{t("As tuas notas")}</label>
                <textarea id="dt-notes" value={mine} onChange={(e) => { setMine(e.target.value); dirty.current = true; setSaved('saving'); saveNotes.run(e.target.value); }} />
              </section>

              <section className="note-card" aria-labelledby="dt-ai">
                <div className="row wrap" style={{ justifyContent: 'space-between', padding: '16px 20px 8px' }}>
                  <h2 id="dt-ai" className="panel-title row" style={{ gap: 8 }}>{t("Notas da Ivuenu")}
                    <span className="tag info" style={{ height: 'auto', padding: '2px 8px' }}>{demoNotes ? t('extraído da conversa, sem IA · revê antes de enviar') : t('escrito pela IA · revê antes de enviar')}</span></h2>
                  <div className="row wrap">
                    <label className="sr-only" htmlFor="dt-style">{t("Estilo das notas")}</label>
                    <select id="dt-style" className="select" style={{ height: 32, fontSize: 13, maxWidth: 'min(100%, 300px)' }} value={m.template} onChange={(e) => rewrite(e.target.value)}>
                      {Object.entries(TEMPLATE_NAMES).map(([k, v]) => <option key={k} value={k}>{k === 'auto' && detected ? `${t(v)} · ${t('detetado')}: ${t(TEMPLATE_NAMES[detected.key])}` : t(v)}</option>)}
                    </select>
                    <Button size="sm" onClick={() => rewrite()} disabled={m.notesState === 'writing' || m.status === 'recording'}>{m.notesState === 'ready' ? t('Reescrever notas') : t('Escrever notas')}</Button>
                  </div>
                </div>
                {detected && (
                  <div className="row wrap muted" style={{ gap: 8, padding: '0 20px 4px', fontSize: 12 }}>
                    <span>{t('Tipo de reunião detetado: {type}.', { type: t(TEMPLATE_NAMES[detected.key]) })}</span>
                    {m.template === 'auto' && <span>{t('As notas usam este tipo.')}</span>}
                    {m.template !== 'auto' && m.template !== detected.key && <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); rewrite(detected.key); }}>{t('Usar o tipo detetado e reescrever')}</a>}
                  </div>
                )}

                {m.notesState === 'writing' && (
                  <div role="status" aria-live="polite" style={{ padding: '12px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="col" style={{ gap: 8 }}><strong style={{ fontSize: 15 }}>{t("A escrever as notas…")}</strong><div className="progress"><div className="indet" /></div></div>
                    <div className="col muted" style={{ gap: 8 }}>
                      <span className="row" style={{ gap: 8 }}><Icon name="check" size={16} stroke={2} style={{ color: 'var(--success)' }} />{t('Ler a transcrição · {n} oradores', { n: m.speakers.length })}{m.durationSeconds != null ? `, ${durationStr(m.durationSeconds)}` : ''}</span>
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{t("Juntar o que foi dito às tuas notas")}</span>
                      <span>{t("Encontrar tarefas e prazos")}</span>
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>{t("Podes continuar a editar as tuas notas.")}</span>
                  </div>
                )}
                {m.notesState === 'failed' && (
                  <div style={{ padding: '12px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Banner tone="error" role="alert"><strong>{t("Não foi possível escrever as notas.")}</strong><br /><span className="body">{/mem[óo]ri/i.test(m.notesError) ? t('O computador ficou sem memória livre. Fecha outras aplicações e tenta outra vez.') : t('Não foi possível escrever as notas. Tenta outra vez.')} {t('As tuas notas e a transcrição estão guardadas.')}</span></Banner>
                    <div><Button variant="primary" onClick={() => rewrite()}>{t("Tentar outra vez")}</Button></div>
                  </div>
                )}
                {m.notesState === 'none' && m.status !== 'recording' && (
                  <div style={{ padding: '12px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p className="muted">{t("A gravação ficou guardada, mas as notas ainda não foram escritas.")}</p>
                    <div><Button variant="primary" onClick={() => rewrite()}>{t("Escrever notas")}</Button></div>
                  </div>
                )}
                {m.notesState === 'ready' && (
                  <div className="ai-body">
                    <p className="muted" style={{ fontSize: 12, lineHeight: '16px', marginBottom: 6 }}>{t("Linhas tuas mantêm-se tal como as escreveste. O que a Ivuenu acrescentou está em cinzento, com a hora de onde veio.")}</p>
                    {m.aiBlocks.map((b, i) => (
                      <div key={i} className="col" style={{ gap: 2, padding: '4px 0' }}>
                        <span>{b.mine}</span>
                        {b.add && <span className="ai-add">{b.add} {hms(b.t) && <a href="#" className="mono" onClick={(e) => { e.preventDefault(); setGoto(parseClock(b.t)); setTab('transcript'); }}>{b.t}</a>}</span>}
                      </div>
                    ))}
                    {m.aiBlocks.length === 0 && <p className="muted">{t("Escreve notas durante a reunião e a Ivuenu junta o que foi dito.")}</p>}
                    {m.aiExtra.length > 0 && <h3 style={{ margin: '12px 0 2px', fontSize: 16, fontWeight: 700, color: 'var(--text-2)' }}>{t("Também foi dito")}</h3>}
                    {m.aiExtra.map((x, i) => <span key={i} className="muted" style={{ fontSize: 15, lineHeight: '24px' }}>• {x.text} {hms(x.t) && <a href="#" className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }} onClick={(e) => { e.preventDefault(); setGoto(parseClock(x.t)); setTab('transcript'); }}>{x.t}</a>}</span>)}
                  </div>
                )}
              </section>
            </div>

            <details className="consent">
              <summary><Icon name="shield" size={16} stroke={1.8} />{t("Registo de consentimento")}<span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {m.consent.events.length} eventos</span></summary>
              <ol>{m.consent.events.map((ev, i) => <li key={i}><span className="mono muted">{new Date(ev.t).toTimeString().slice(0, 8)}</span>{ev.note}</li>)}</ol>
            </details>
          </div>
        )}

        {tab === 'transcript' && <TranscriptTab m={m} goto={goto} clearGoto={() => setGoto(null)} />}
        {tab === 'tasks' && <TasksTab m={m} />}
        {tab === 'chat' && <ChatTab m={m} onCite={(ms) => { setGoto(ms); setTab('transcript'); }} />}
        </div>
      </div>

      {emailing && <EmailDialog meetingId={id} onClose={() => setEmailing(false)} />}
      {sharing && <ShareDialog meetingId={id} title={m.title} onClose={() => setSharing(false)} />}
      {summing && <SummarizeDialog scope={summing} meetingId={id} notesText={mine} onClose={() => setSumming(null)} onAppendToNotes={appendToNotes} onSaved={() => toast(t('Resumo guardado.'))} />}
      {confirmDelete && (
        <Dialog title={t("Apagar esta reunião?")} onClose={() => setConfirmDelete(false)}>
          <div className="dialog-body">
            <p>{t("Apaga as notas, a transcrição e as tarefas desta reunião, neste computador. Não dá para desfazer.")}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setConfirmDelete(false)}>{t("Cancelar")}</Button>
              <Button variant="danger" onClick={async () => { try { await call('meetings:delete', id); nav('home'); } catch (e) { toast(friendly(e)); setConfirmDelete(false); } }}>{t("Apagar")}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function TranscriptTab({ m, goto, clearGoto }) {
  const t = useT();
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [limit, setLimit] = useState(300);
  const [time, setTime] = useState('');
  const [renaming, setRenaming] = useState(null);
  const refs = useRef({});

  const needle = fold(q).trim();
  const matches = needle ? m.segments.filter((s) => fold(s.text).includes(needle) || (s.translation && fold(s.translation).includes(needle))).map((s) => s.id) : [];

  function scrollTo(segId) {
    const index = m.segments.findIndex((s) => s.id === segId);
    if (index >= limit) setLimit(index + 50);
    requestAnimationFrame(() => { const el = refs.current[segId]; if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  }
  useEffect(() => {
    if (goto == null || !m.segments.length) return;
    const near = m.segments.reduce((best, s) => (Math.abs(s.startMs - goto) < Math.abs(best.startMs - goto) ? s : best), m.segments[0]);
    scrollTo(near.id); clearGoto();
  }, [goto]);// eslint-disable-line
  useEffect(() => { setHit(0); if (matches.length) scrollTo(matches[0]); }, [q]);// eslint-disable-line

  function step(delta) {
    if (!matches.length) return;
    const next = (hit + delta + matches.length) % matches.length;
    setHit(next); scrollTo(matches[next]);
  }

  if (m.transcriptDeletedAt) {
    return (
      <div role="tabpanel" aria-label={t("Transcrição")} className="empty" style={{ padding: '32px 24px', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>{t("Transcrição apagada")}</strong>
        <span className="muted" style={{ maxWidth: 320 }}>{t('Esta foi uma reunião só de notas. A transcrição foi apagada a {date} às {time}, depois de as notas serem escritas.', { date: new Date(m.transcriptDeletedAt).toLocaleDateString('pt-PT'), time: new Date(m.transcriptDeletedAt).toTimeString().slice(0, 5) })}</span>
        <span className="muted" style={{ fontSize: 12 }}>{t("A conversa e as ajudas usam só as notas.")}</span>
      </div>
    );
  }
  return (
    <div role="tabpanel" aria-label={t("Transcrição")} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row wrap">
          <div className="search-wrap" style={{ flex: '1 1 260px', maxWidth: 420 }}>
            <label className="sr-only" htmlFor="dt-tsearch">{t("Pesquisar na transcrição")}</label>
            <Icon name="search" size={18} />
            <input id="dt-tsearch" className="input search" value={q} placeholder={t("Pesquisar na transcrição")} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); }} />
          </div>
          {needle && <span className="row muted" style={{ fontSize: 13, gap: 6 }}>{matches.length} resultados{matches.length > 0 && <> · <span className="mono">{hit + 1} / {matches.length}</span></>}
            <IconButton icon="chevronUp" size="sm" label={t("Anterior")} onClick={() => step(-1)} /><IconButton icon="chevronDown" size="sm" label={t("Seguinte")} onClick={() => step(1)} /></span>}
        </div>
        <form className="row" onSubmit={(e) => {
          e.preventDefault(); const ms = parseClock(time);
          if (ms == null || !m.segments.length) { toast(t('Escreve uma hora como 01:24:00')); return; }
          const near = m.segments.reduce((b, s) => (Math.abs(s.startMs - ms) < Math.abs(b.startMs - ms) ? s : b), m.segments[0]); scrollTo(near.id);
        }}>
          <label htmlFor="dt-time" style={{ fontSize: 13 }}>{t("Ir para")}</label>
          <input id="dt-time" className="input mono" style={{ width: 100, height: 32 }} value={time} placeholder="00:12:38" onChange={(e) => setTime(e.target.value)} />
        </form>
      </div>
      {m.segments.length === 0 && <p className="muted">{t("Não há transcrição nesta reunião.")}</p>}
      <div className="col" style={{ gap: 18 }}>
        {m.segments.slice(0, limit).map((s) => {
          const sp = m.speakers.find((x) => x.key === s.speakerKey);
          return (
            <div className="line" key={s.id} ref={(el) => { refs.current[s.id] = el; }}>
              <span className="bar" style={{ background: `var(--spk-${(sp ? sp.color : 0) % 8})` }} />
              <div className="col" style={{ gap: 2 }}>
                <div className="who">
                  {renaming === s.speakerKey
                    ? <form onSubmit={async (e) => { e.preventDefault(); const n = e.target.elements.n.value; setRenaming(null); await call('speakers:rename', { id: m.id, key: s.speakerKey, name: n }); }}>
                      <input name="n" className="input" style={{ height: 28 }} autoFocus defaultValue={sp ? sp.name : ''} placeholder={s.who} aria-label={`Nome de ${s.who}`} onBlur={() => setRenaming(null)} /></form>
                    : <button type="button" title={t("Mudar o nome")} onClick={() => setRenaming(s.speakerKey)} style={{ border: 0, background: 'transparent', padding: 0, fontWeight: 700, textDecoration: 'underline dotted var(--border-strong)', textUnderlineOffset: 3 }}>{s.who}</button>}
                  <span className="mono faint" style={{ fontSize: 12 }}>{clockStr(s.startMs)}</span>
                </div>
                <p>{highlightParts(s.text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>
                {s.translation && <p className="tr">{s.translation}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {m.segments.length > limit && <Button variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setLimit(limit + 300)}>Mostrar mais {Math.min(300, m.segments.length - limit)}</Button>}
    </div>
  );
}

function TasksTab({ m }) {
  const t = useT();
  const { toast } = useApp();
  const [text, setText] = useState('');
  const items = m.tasks.filter((t) => !t.hidden);
  const patch = (taskId, p) => call('tasks:patch', { id: m.id, taskId, patch: p }).catch((e) => toast(friendly(e)));
  async function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await call('tasks:add', { id: m.id, text: text.trim() }); setText('');
  }
  return (
    <div role="tabpanel" aria-label={t("Tarefas")} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.length === 0 && <p className="muted">{t("Ainda não há tarefas. Adiciona uma abaixo.")}</p>}
      {items.map((task) => (
        <div className="task" key={task.id}>
          <input type="checkbox" checked={task.done} onChange={() => patch(task.id, { done: !task.done })} aria-label={`${t('Concluir')}: ${task.text}`} />
          <div className="col" style={{ gap: 4 }}>
            <span className={task.done ? 'done' : ''} style={{ fontSize: 15 }}>{task.text}</span>
            <span className="row muted" style={{ gap: 12, fontSize: 12 }}><span>{task.owner || t('Sem dono')}</span><span>{task.due || t('Sem prazo')}</span></span>
          </div>
          <IconButton icon="eyeOff" size="sm" label={t("Ocultar tarefa")} onClick={() => patch(task.id, { hidden: true })} />
        </div>
      ))}
      <form className="row wrap" style={{ paddingTop: 8 }} onSubmit={add}>
        <label className="sr-only" htmlFor="dt-add">{t("Nova tarefa")}</label>
        <input id="dt-add" className="input grow" style={{ flex: '1 1 240px' }} placeholder={t("Adicionar tarefa…")} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit">{t("Adicionar")}</Button>
        <Button variant="primary" icon="export" onClick={() => call('export:run', { id: m.id, format: 'tasks-mail' }).catch((e) => toast(friendly(e)))}>{t("Enviar tarefas")}</Button>
      </form>
    </div>
  );
}

function ChatTab({ m, onCite }) {
  const t = useT();
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  async function ask(question) {
    const t = question.trim(); if (!t) return;
    setBusy(true); setQ('');
    try { await call('chat:ask', { id: m.id, question: t }); } catch (e) { toast(friendly(e)); }
    setBusy(false);
  }
  return (
    <div role="tabpanel" aria-label={t("Conversa")} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      {m.chat.length === 0 && <p className="muted">{t("Pergunta algo sobre esta reunião, por exemplo “quem ficou de avisar o suporte?”.")}</p>}
      {m.chat.map((c, i) => c.role === 'user'
        ? <div key={i} className="chat-user">{c.text}</div>
        : <div key={i} className="chat-ai"><span className="h-sub">Ivuenu</span><p style={{ fontSize: 15, lineHeight: '24px' }}>{c.text} {hms(c.cite) && <a href="#" className="mono" style={{ fontSize: 12 }} onClick={(e) => { e.preventDefault(); onCite(parseClock(c.cite)); }}>{c.cite}</a>}</p></div>)}
      <div className="row wrap">{['Quem ficou com as tarefas?', 'O que ficou por decidir?'].map((s) => <Chip key={s} onClick={() => ask(t(s))} disabled={busy}>{t(s)}</Chip>)}</div>
      <form className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }} onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label className="sr-only" htmlFor="dt-ask">{t("Pergunta sobre esta reunião")}</label>
        <input id="dt-ask" className="input lg grow" placeholder={t("Pergunta algo sobre esta reunião")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="primary" type="submit" disabled={busy || !q.trim()}>{t("Perguntar")}</Button>
      </form>
      <span className="muted" style={{ fontSize: 12 }}>{t("Só desta reunião. As respostas não usam outras reuniões nem a internet.")}</span>
    </div>
  );
}
