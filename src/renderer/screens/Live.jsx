import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, IconButton, LevelBars, Chip, Avatar } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { useMeeting, useDebounced } from '../lib/hooks.js';
import { audioBus } from '../lib/audio.js';
import { call, send } from '../lib/bridge.js';
import { clockStr } from '../lib/format.mjs';
import { friendly } from '../lib/errors.mjs';

const LIVE_HELPS = [
  { id: 'suggest-reply', label: 'Sugere o que dizer' }, { id: 'catch-up', label: 'Põe-me a par' },
  { id: 'explain', label: 'Explica isso' }, { id: 'good-questions', label: 'Perguntas a fazer' },
];

/** The live meeting: transcript on the left, the person's own notes on the right, helps along the bottom. */
export default function Live() {
  const t = useT();
  const { rec, nav, toast, audioErrors, settings } = useApp();
  const id = rec && rec.meetingId;
  const meeting = useMeeting(id);
  const m = meeting.data;
  const active = rec && (rec.phase === 'recording' || rec.phase === 'paused');

  // --- notes (autosave 1 s after the last key; text from the island is merged in when you are not typing) ---
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState('saved');                 // saving | saved
  const dirty = useRef(false);
  const lastLoaded = useRef(null);
  const area = useRef(null);
  const save = useDebounced(async (text) => {
    try { await call('notes:setMine', { id, text }); dirty.current = false; setSaved('saved'); } catch (e) { toast(friendly(e)); }
  }, 1000);
  useEffect(() => {
    if (!m) return;
    if (!dirty.current && m.myNotes !== lastLoaded.current) { setNotes(m.myNotes); lastLoaded.current = m.myNotes; }
  }, [m && m.myNotes, m && m.id]);
  useEffect(() => () => { if (dirty.current) save.flush(area.current ? area.current.value : ''); }, []);// eslint-disable-line

  function edit(text) { setNotes(text); dirty.current = true; setSaved('saving'); save.run(text); }
  function prefixLine(prefix) {
    const el = area.current; if (!el) return;
    const start = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    edit(el.value.slice(0, start) + prefix + el.value.slice(start));
  }
  function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = e.target; const pos = el.selectionStart;
    const start = el.value.lastIndexOf('\n', pos - 1) + 1;
    const line = el.value.slice(start, pos);
    const mk = line.match(/^(• |☐ )/);
    if (!mk) return;
    e.preventDefault();
    if (line === mk[1]) { edit(el.value.slice(0, start) + el.value.slice(pos)); return; }   // empty bullet: end the list
    edit(`${el.value.slice(0, pos)}\n${mk[1]}${el.value.slice(pos)}`);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = pos + 1 + mk[1].length; });
  }

  // --- title ---
  const [title, setTitle] = useState('');
  useEffect(() => { if (m) setTitle(m.title); }, [m && m.id]);// eslint-disable-line
  const saveTitle = () => { if (m && title !== m.title) call('meetings:patch', { id, patch: { title } }).catch(() => {}); };

  // --- levels (10 per second, straight from the audio) ---
  const [levels, setLevels] = useState({ mic: 0, sys: 0 });
  useEffect(() => audioBus.subscribe(setLevels), []);

  // --- transcript with follow-the-latest ---
  const logRef = useRef(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = m ? m.segments.length : 0;
  const seen = useRef(0);
  useEffect(() => {
    const el = logRef.current; if (!el) return;
    if (pinned && !paused) { el.scrollTop = el.scrollHeight; seen.current = count; setUnseen(0); } else setUnseen(count - seen.current);
  }, [count, pinned, paused, rec && rec.partial]);
  function onScroll() {
    const el = logRef.current;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }

  // --- speakers ---
  const [renaming, setRenaming] = useState(null);
  async function rename(key, name) {
    setRenaming(null);
    try { await call('speakers:rename', { id, key, name }); } catch (e) { toast(friendly(e)); }
  }

  // --- helps ---
  const [help, setHelp] = useState(null);
  const [helpBusy, setHelpBusy] = useState(false);
  async function runHelp(h) {
    if (help && help.id === h.id) { setHelp(null); return; }
    setHelp({ id: h.id, label: t(h.label), text: '…' }); setHelpBusy(true);
    try { const r = await call('recipes:run', { id, recipeId: h.id, live: true }); setHelp({ id: h.id, label: t(h.label), text: r.text }); }
    catch (e) { setHelp({ id: h.id, label: t(h.label), text: friendly(e) }); }
    setHelpBusy(false);
  }

  const [stopping, setStopping] = useState(false);
  async function stop() {
    setStopping(true);
    try { const done = await call('rec:stop'); nav('detail', { id: done.id }); } catch (e) { toast(friendly(e)); setStopping(false); }
  }

  if (!active) {
    return (
      <div className="page"><div className="page-inner" style={{ alignItems: 'flex-start' }}>
        <h1 className="display">{t("Sem gravação em curso")}</h1>
        <p className="muted">{t("Começa uma reunião para veres aqui a transcrição e as tuas notas.")}</p>
        <Button onClick={() => nav('home')}>{t("Voltar ao início")}</Button>
      </div></div>
    );
  }

  const consentTag = m && m.consent.status === 'confirmed'
    ? <span className="tag ok"><Icon name="shieldCheck" size={16} stroke={1.8} />{t("Participantes avisados")}</span>
    : <span className="tag"><Icon name="shield" size={16} stroke={1.8} />{t("Só notas pessoais")}</span>;
  const demo = rec.engine && !rec.engine.realTranscription;

  return (
    <div className="live">
      <header className="live-head">
        <div className="rec-pill" role="status" aria-label={t(rec.phase === 'paused' ? 'Em pausa, {time}' : 'A gravar, {time}', { time: clockStr(rec.elapsedMs) })}>
          {rec.phase === 'paused' ? <span className="dot-sq" style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--text-3)' }} /> : <span className="rec-dot" />}
          <b>{rec.phase === 'paused' ? t('Em pausa') : t('A gravar')}</b><span className="mono" style={{ fontSize: 15 }}>{clockStr(rec.elapsedMs)}</span>
        </div>
        <label className="sr-only" htmlFor="lv-title">{t("Título da reunião")}</label>
        <input id="lv-title" className="title-input" value={title} placeholder={t("Reunião sem título")} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} />
        {consentTag}
        <div className="row" style={{ gap: 14, padding: '0 4px' }}>
          <span className="row" style={{ gap: 6 }}><Icon name="mic" size={18} /><LevelBars level={levels.mic} label={t("Nível do microfone")} /></span>
          {settings.captureSystem && <span className="row" style={{ gap: 6 }}><Icon name="speaker" size={18} /><LevelBars level={levels.sys} label={t("Nível do som do computador")} /></span>}
        </div>
        <span className="row muted" role="status" style={{ fontSize: 12, gap: 6 }}><Icon name="check" size={14} stroke={2} />{saved === 'saving' ? 'A guardar…' : 'Guardado'}</span>
        <IconButton icon="miniWindow" label={t("Abrir o mini gravador")} bordered onClick={() => send('island:toggle')} />
        <IconButton icon={rec.phase === 'paused' ? 'play' : 'pause'} label={rec.phase === 'paused' ? 'Retomar' : 'Pausar'} bordered
          onClick={() => call(rec.phase === 'paused' ? 'rec:resume' : 'rec:pause')} />
        <Button variant="dark" onClick={stop} disabled={stopping}><Icon name="stop" size={14} stroke={0} style={{ fill: 'currentColor' }} />{stopping ? 'A parar…' : 'Parar'}</Button>
      </header>

      {(audioErrors.includes('mic') || audioErrors.includes('system') || audioErrors.includes('system_silent') || rec.quiet) && (
        <div style={{ padding: '10px 20px 0' }}>
          <Banner tone="warn" action={<Button size="sm" onClick={() => nav('settings', { section: 'grav' })}>{t("Escolher")}</Button>}>
            {audioErrors.includes('mic') ? t('Microfone não encontrado. Liga o auricular ou escolhe outro.')
              : audioErrors.includes('system') ? t('Não foi possível captar o som do computador. Só estamos a ouvir o teu microfone.')
                : audioErrors.includes('system_silent') ? t('Não estamos a ouvir o som da chamada. Confirma que a chamada toca no dispositivo de saída do Windows (colunas ou auscultadores). Se estão todos na sala, escolhe “Na mesma sala” ao começar.')
                  : t('Sem som há mais de 30 segundos. Verifica o microfone.')}
          </Banner>
        </div>
      )}

      <div className="live-body">
        <section className="pane-tr" aria-labelledby="lv-tr">
          <div className="pane-head" style={{ padding: '14px 24px 10px' }}>
            <h2 id="lv-tr" style={{ fontSize: 14, fontWeight: 700 }}>{t("Transcrição ao vivo")}</h2>
            <div className="row">
              {demo && <span className="demo-note" title={t("Modo de desenvolvimento: a conversa abaixo é simulada.")}>{t("Modo de demonstração: conversa simulada")}</span>}
              {rec.error && <span className="demo-note" role="alert">{rec.error}</span>}
              <Button size="sm" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Retomar leitura' : 'Pausar leitura'}</Button>
            </div>
          </div>
          <div className="tr-log" role="log" aria-live={paused ? 'off' : 'polite'} aria-label={t("Transcrição")} ref={logRef} onScroll={onScroll}>
            {m && m.segments.length === 0 && !rec.partial && <p className="muted">{t("À espera de ouvir alguém falar…")}</p>}
            {m && m.segments.map((s) => {
              const sp = m.speakers.find((x) => x.key === s.speakerKey);
              return (
                <div className="line" key={s.id}>
                  <span className="bar" style={{ background: `var(--spk-${(sp ? sp.color : 0) % 8})` }} />
                  <div className="col" style={{ gap: 2 }}>
                    <div className="who"><strong>{s.who}</strong><span className="mono faint" style={{ fontSize: 12 }}>{clockStr(s.startMs)}</span></div>
                    <p>{s.text}</p>
                    {s.translation && <p className="tr">{s.translation}</p>}
                  </div>
                </div>
              );
            })}
            {rec.partial && (
              <div className="line partial"><span className="bar" style={{ background: 'var(--border-strong)' }} />
                <div className="col" style={{ gap: 2 }}><div className="who"><strong>{rec.partial.who}</strong><span className="faint" style={{ fontSize: 12 }}>{t("a falar…")}</span></div><p>{rec.partial.text}</p></div></div>
            )}
          </div>
          {!pinned && unseen > 0 && (
            <button type="button" className="jump" onClick={() => { setPinned(true); const el = logRef.current; el.scrollTop = el.scrollHeight; }}>
              <Icon name="arrowDown" size={14} stroke={2} />Ir para o mais recente · {unseen} {unseen === 1 ? 'nova' : 'novas'}
            </button>
          )}
        </section>

        <section className="pane-notes" aria-labelledby="lv-notes">
          <div className="pane-head" style={{ padding: '14px 32px 10px' }}>
            <h2 id="lv-notes" style={{ fontSize: 20, lineHeight: '28px', fontWeight: 700 }}>{t("As tuas notas")}</h2>
            <div className="row" style={{ gap: 2 }} role="toolbar" aria-label={t("Formatação")}>
              <IconButton icon="tasks" label={t("Lista")} size="sm" onClick={() => prefixLine('• ')} />
              <IconButton icon="check" label={t("Caixa de verificação")} size="sm" onClick={() => prefixLine('☐ ')} />
            </div>
          </div>
          <label className="sr-only" htmlFor="lv-notes-area">{t("As tuas notas")}</label>
          <textarea id="lv-notes-area" ref={area} className="notes-area" value={notes} onChange={(e) => edit(e.target.value)} onKeyDown={onKey}
            placeholder={t("Escreve aqui o que for importante. O resto, deixa connosco.")} />
          <div className="row wrap" style={{ justifyContent: 'space-between', padding: '10px 32px', fontSize: 12, color: 'var(--text-2)', borderTop: '1px solid var(--border)' }}>
            <span className="row" style={{ gap: 6 }}><Icon name="laptop" size={14} stroke={1.8} />{t("Guardada neste computador.")}</span>
            <span>{t("A Ivuenu completa as tuas notas quando parares. O que escreves nunca é substituído.")}</span>
          </div>
        </section>
      </div>

      <footer className="live-foot">
        <div className="row wrap" aria-label={t("Oradores")}>
          <span className="h-sub" style={{ marginRight: 4 }}>{t("Oradores")}</span>
          {m && m.speakers.map((s) => renaming === s.key ? (
            <form key={s.key} onSubmit={(e) => { e.preventDefault(); rename(s.key, e.target.elements.n.value); }}>
              <input name="n" className="input" style={{ height: 30, width: 150 }} autoFocus defaultValue={s.name} placeholder={s.display}
                aria-label={`Nome de ${s.display}`} onBlur={(e) => rename(s.key, e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
            </form>
          ) : (
            <button key={s.key} type="button" className="spk-chip" title={t("Clica para mudar o nome")} onClick={() => setRenaming(s.key)}>
              <Avatar color={s.color} size="sm" initials={s.initials} />{s.display}{s.isMe ? ` ${t('(tu)')}` : ''}
            </button>
          ))}
        </div>
        <div className="row wrap" role="group" aria-label={t("Ajudas ao vivo")}>
          {LIVE_HELPS.map((h) => <Chip key={h.id} pressed={help && help.id === h.id} onClick={() => runHelp(h)}>{t(h.label)}</Chip>)}
        </div>
        {help && (
          <div className="help-panel" role="dialog" aria-label={help.label}>
            <div className="row" style={{ justifyContent: 'space-between' }}><strong style={{ fontSize: 15 }}>{help.label}</strong><IconButton icon="close" size="sm" label={t("Fechar")} onClick={() => setHelp(null)} /></div>
            <p aria-busy={helpBusy}>{help.text}</p>
            <div className="row" style={{ justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <span className="muted row" style={{ fontSize: 12, gap: 6 }}><Icon name="lock" size={14} stroke={1.8} />{t('Só tu vês isto')}{demo ? ` · ${t('extraído da conversa, sem IA')}` : ` · ${t('escrito pela Ivuenu')}`}</span>
              <Button size="sm" icon="copy" onClick={() => { navigator.clipboard.writeText(help.text).then(() => toast(t('Copiado'))); }}>{t("Copiar")}</Button>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
