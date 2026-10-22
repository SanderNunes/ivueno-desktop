import React, { useState } from 'react';
import { useT } from '../lib/i18n.js';
import { IconButton, Seg, Skeleton } from '../components/ui.jsx';
import { useApp } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { dm, hm } from '../lib/format.mjs';
import { friendly } from '../lib/errors.mjs';

const isMine = (t) => !t.owner || t.owner === 'Tu';

export default function Tasks() {
  const t = useT();
  const { nav, auth, toast } = useApp();
  const [filter, setFilter] = useState('mine');
  const { data, loading } = useQuery('tasks:overview', { includeDone: true }, { kinds: ['tasks', 'meetings', 'notes'] });
  const me = (auth.user && auth.user.name) || 'tu';

  const groups = (data ? data.groups : []).map((g) => ({
    ...g,
    items: g.items.filter((t) => (filter === 'done' ? t.done : !t.done && (filter === 'all' || isMine(t)))),
  })).filter((g) => g.items.length);
  const open = groups.reduce((n, g) => n + (filter === 'done' ? 0 : g.items.length), 0);

  const patch = (id, taskId, p) => call('tasks:patch', { id, taskId, patch: p }).catch((e) => toast(friendly(e)));

  return (
    <div className="page framed" style={{ '--max': '880px' }}>
      <div className="page-inner" style={{ gap: 24 }}>
        <header className="page-head">
          <div className="col" style={{ gap: 4 }}>
            <h1 className="display">{t("Tarefas")}</h1>
            <span className="muted">{filter === 'done' ? t('Tarefas concluídas.') : `${t(groups.length === 1 ? '{n} em aberto, de {m} reunião.' : '{n} em aberto, de {m} reuniões.', { n: open, m: groups.length })}${filter === 'mine' ? ` ${t('Só as que são tuas ou estão sem dono.')}` : ''}`}</span>
          </div>
          <Seg label={t("Mostrar")} value={filter} onChange={setFilter} options={[{ id: 'mine', label: t('Minhas') }, { id: 'all', label: t('Todas') }, { id: 'done', label: t('Concluídas') }]} />
        </header>
        <div className="page-scroll">
        {loading && <div className="col" style={{ gap: 12 }}><Skeleton w="40%" /><Skeleton /><Skeleton w="70%" /></div>}
        {!loading && groups.length === 0 && <div className="empty" style={{ padding: '32px 24px' }}><strong>{t("Nada por fazer aqui.")}</strong><span className="muted">{t("As tarefas aparecem quando uma reunião as tem.")}</span></div>}
        {groups.map((g) => (
          <section key={g.meetingId} className="col" style={{ gap: 8 }}>
            <div className="group-head">
              <a href="#" onClick={(e) => { e.preventDefault(); nav('detail', { id: g.meetingId, tab: 'tasks' }); }}>{g.title}</a>
              <span className="muted" style={{ fontSize: 12 }}>{dm(g.startedAt)} · {hm(g.startedAt)} · {t('abrir reunião')}</span>
            </div>
            {g.items.map((task) => (
              <div className="task" key={task.id}>
                <input type="checkbox" checked={task.done} onChange={() => patch(g.meetingId, task.id, { done: !task.done })} aria-label={`${t('Concluir')}: ${task.text}`} />
                <div className="col" style={{ gap: 4, minWidth: 0 }}>
                  <span className={task.done ? 'done' : ''} style={{ fontSize: 15 }}>{task.text}</span>
                  <span className="row wrap muted" style={{ gap: 12, fontSize: 12 }}><span>{task.owner === 'Tu' ? `${me} ${t('(tu)')}` : task.owner || t('Sem dono')}</span><span>{task.due || t('Sem prazo')}</span></span>
                </div>
                <IconButton icon="eyeOff" size="sm" label={t("Ocultar tarefa")} onClick={() => patch(g.meetingId, task.id, { hidden: true })} />
              </div>
            ))}
          </section>
        ))}
        </div>
      </div>
    </div>
  );
}
