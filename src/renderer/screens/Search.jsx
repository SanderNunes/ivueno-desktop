import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Chip } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { call } from '../lib/bridge.js';
import { dm, durationStr, highlightParts, parseClock } from '../lib/format.mjs';

const SCOPES = [['all', 'Tudo'], ['Título', 'Títulos'], ['Resumo', 'Resumos'], ['Notas', 'Notas'], ['Transcrição', 'Transcrição']];

function Marked({ text, q }) {
  const t = useT();
  return highlightParts(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));
}

export default function Search() {
  const t = useT();
  const { route, nav, settings } = useApp();
  const [q, setQ] = useState(route.q || '');
  const [scope, setScope] = useState('all');
  const [res, setRes] = useState({ total: 0, results: [] });
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes({ total: 0, results: [] }); setSearched(false); return undefined; }
    const t = setTimeout(async () => { setRes(await call('search:run', term)); setSearched(true); }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const results = res.results.map((r) => ({ ...r, hits: r.hits.filter((h) => scope === 'all' || h.kind === scope) })).filter((r) => r.hits.length);
  const total = results.reduce((n, r) => n + r.hits.length, 0);

  return (
    <div className="page framed" style={{ '--max': '880px' }}>
      <div className="page-inner" style={{ gap: 20 }}>
        <h1 className="display">{t("Pesquisar")}</h1>
        <div className="search-wrap">
          <label className="sr-only" htmlFor="sr-q">{t("Pesquisar em todas as reuniões")}</label>
          <Icon name="search" size={20} style={{ position: 'absolute', left: 14, top: 14 }} />
          <input id="sr-q" className="input search" autoFocus style={{ height: 48, fontSize: 16, paddingLeft: 44, border: '1.5px solid var(--accent)' }} value={q}
            placeholder={t("Pesquisar títulos, notas e transcrições")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="page-scroll">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row wrap" role="radiogroup" aria-label={t("Onde procurar")} style={{ gap: 6 }}>
            {SCOPES.map(([id, label]) => <Chip key={id} pressed={scope === id} role="radio" aria-checked={scope === id} onClick={() => setScope(id)}>{t(label)}</Chip>)}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{t("Pesquisa por palavras. Por significado: em breve.")}</span>
        </div>

        {!q.trim() && (
          <div className="col" style={{ gap: 10, padding: '24px 0' }}>
            <strong>{t("Pesquisas recentes")}</strong>
            <div className="row wrap">{settings.recentSearches.map((s) => <Chip key={s} onClick={() => setQ(s)}>{s}</Chip>)}</div>
            <span className="muted" style={{ fontSize: 13 }}>{t("Procura em títulos, resumos, notas e transcrições de todas as reuniões neste computador.")}</span>
          </div>
        )}
        {q.trim() && searched && total === 0 && (
          <div className="empty" role="status" style={{ padding: '40px 24px', gap: 10 }}>
            <strong style={{ fontSize: 16 }}>Nada encontrado para “{q.trim()}”.</strong>
            <span className="muted" style={{ maxWidth: 380 }}>{t("Tenta outra palavra ou procura em inglês: as transcrições guardam o que foi dito, na língua em que foi dito.")}</span>
          </div>
        )}
        {total > 0 && (
          <div className="col" style={{ gap: 16 }}>
            <span role="status" className="muted" style={{ fontSize: 13 }}>{t(total === 1 ? '{n} resultado' : '{n} resultados', { n: total })} {t(results.length === 1 ? 'em {n} reunião' : 'em {n} reuniões', { n: results.length })}</span>
            {results.map((r) => (
              <section key={r.meetingId} className="card" style={{ overflow: 'hidden' }}>
                <div className="row" style={{ padding: '14px 16px', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
                  <a href="#" style={{ fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); nav('detail', { id: r.meetingId }); }}><Marked text={r.title} q={q} /></a>
                  <span className="muted" style={{ fontSize: 12 }}>{dm(r.startedAt)}{r.durationSeconds != null ? ` · ${durationStr(r.durationSeconds)}` : ''}{r.folderName ? ` · ${r.folderName}` : ''}</span>
                </div>
                {r.hits.map((h, i) => (
                  <button key={i} type="button" className="res" onClick={() => nav('detail', { id: r.meetingId, tab: h.kind === 'Transcrição' ? 'transcript' : 'notes', atMs: h.t ? parseClock(h.t) : null })}>
                    <span className="col muted" style={{ fontSize: 12, fontWeight: 600 }}>{t(h.kind)}{h.t && <span className="mono" style={{ fontWeight: 500 }}>{h.t}</span>}</span>
                    <span>{h.speaker && <strong>{h.speaker}: </strong>}<Marked text={h.text} q={q} /></span>
                  </button>
                ))}
                {r.more > 0 && <div className="muted" style={{ padding: '8px 16px', fontSize: 12 }}>{t('+{n} mais nesta reunião', { n: r.more })}</div>}
              </section>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
