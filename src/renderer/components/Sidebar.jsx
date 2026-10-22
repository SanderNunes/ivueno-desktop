import React, { useState } from 'react';
import Icon, { Logo } from './Icon.jsx';
import { Avatar, RecDot } from './ui.jsx';
import { useApp, PLAN_NAMES } from '../lib/app-context.js';
import { useQuery, useDismiss } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { clockStr, initialsOf } from '../lib/format.mjs';
import { useT } from '../lib/i18n.js';

export default function Sidebar() {
  const { route, nav, rec, auth, openStart, toast, logout } = useApp();
  const t = useT();
  const folders = useQuery('folders:list', null, { kinds: ['folders', 'meetings'] });
  const overview = useQuery('tasks:overview', { includeDone: false }, { kinds: ['tasks', 'meetings', 'notes'] });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState(false);
  const menuRef = useDismiss(menu, () => setMenu(false));

  const recording = rec && (rec.phase === 'recording' || rec.phase === 'paused');
  const user = auth.user || {};
  const planName = PLAN_NAMES[auth.licence.plan] || 'Gratuito';

  async function addFolder(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) { setAdding(false); return; }
    try { await call('folders:create', clean); setName(''); setAdding(false); } catch (err) { toast(err.message); }
  }

  const isHome = route.name === 'home' && !route.folderId;

  return (
    <aside className="sidebar" aria-label="Barra lateral">
      <div className="brand"><Logo recording={recording} />ivuenu</div>

      {recording ? (
        <button type="button" className="rec-card" onClick={() => nav('live')}>
          <span className="row" style={{ fontSize: 12, fontWeight: 600, color: 'var(--rec-text)' }}>
            <RecDot small />{rec.phase === 'paused' ? t('nav.paused') : t('nav.recording')} · <span className="mono">{clockStr(rec.elapsedMs)}</span>
          </span>
          <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.title || t('Reunião sem título')}</strong>
          <span style={{ fontSize: 12, color: 'var(--accent-hover)', fontWeight: 600 }}>{t('nav.back')}</span>
        </button>
      ) : (
        <button type="button" className="btn primary" style={{ height: 40 }} onClick={() => openStart()} disabled={rec && rec.phase === 'writing'}>
          <Icon name="plus" size={18} stroke={2} />{t('nav.new')}
        </button>
      )}

      <nav className="nav" aria-label="Principal">
        <button type="button" className="nav-item" aria-current={isHome ? 'page' : undefined} onClick={() => nav('home')}><Icon name="home" />{t('nav.home')}</button>
        <button type="button" className="nav-item" aria-current={route.name === 'tasks' ? 'page' : undefined} onClick={() => nav('tasks')}>
          <Icon name="tasks" /><span className="grow">{t('nav.tasks')}</span>
          {overview.data && overview.data.open > 0 && <span className="badge" aria-label={`${overview.data.open} em aberto`}>{overview.data.open}</span>}
        </button>
        <button type="button" className="nav-item" aria-current={route.name === 'search' ? 'page' : undefined} onClick={() => nav('search')}><Icon name="search" />{t('nav.search')}</button>
      </nav>

      <div className="side-section">
        <div className="side-title">
          <span>{t('nav.folders')}</span>
          <button type="button" className="icon-btn sm" style={{ width: 24, height: 24 }} aria-label={t('nav.newFolder')} onClick={() => setAdding(true)}><Icon name="plus" size={16} stroke={2} /></button>
        </div>
        {(folders.data || []).map((f) => (
          <button key={f.id} type="button" className="nav-item folder" aria-current={route.name === 'home' && route.folderId === f.id ? 'true' : undefined} onClick={() => nav('home', { folderId: f.id })}>
            <Icon name="folder" size={18} /><span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span><span className="count">{f.count}</span>
          </button>
        ))}
        {adding && (
          <form onSubmit={addFolder} style={{ padding: '2px 4px' }}>
            <label className="sr-only" htmlFor="new-folder">Nome da pasta</label>
            <input id="new-folder" className="input" style={{ height: 32, width: '100%' }} autoFocus value={name} placeholder="Nome da pasta"
              onChange={(e) => setName(e.target.value)} onBlur={addFolder} onKeyDown={(e) => { if (e.key === 'Escape') { setName(''); setAdding(false); } }} />
          </form>
        )}
        {folders.data && folders.data.length === 0 && !adding && <span className="faint" style={{ padding: '0 10px', fontSize: 12 }}>{t('Agrupa reuniões por cliente ou projeto.')}</span>}
      </div>

      <div className="side-foot">
        <button type="button" className="nav-item" aria-current={route.name === 'settings' ? 'page' : undefined} onClick={() => nav('settings')}><Icon name="sliders" />{t('nav.settings')}</button>
        <div className="local-note"><Icon name="laptop" size={16} stroke={1.8} />{t('nav.local')}</div>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button type="button" className="user-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Avatar color={0} size="lg" initials={initialsOf(user.name || user.email)} />
            <span className="col grow"><span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name || user.email}</span><span className="muted" style={{ fontSize: 12 }}>{t('nav.plan')} {t(planName)}</span></span>
            <Icon name="chevronDown" size={16} stroke={2} />
          </button>
          {menu && (
            <div className="menu" role="menu" style={{ bottom: 52, left: 0, right: 0 }}>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); nav('plans'); }}>{t('nav.plans')}</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); nav('settings', { section: 'perfil' }); }}>{t('nav.profile')}</button>
              <hr />
              <button type="button" role="menuitem" onClick={() => { setMenu(false); logout(); }}>{t('nav.logout')}</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
