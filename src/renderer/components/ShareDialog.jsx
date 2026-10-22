import React, { useEffect, useState } from 'react';
import { Banner, Button, Chip, Dialog, Field, Seg } from './ui.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

const PARTS = [['summary', 'Resumo'], ['mine', 'As tuas notas'], ['ai', 'Notas da Ivuenu'], ['tasks', 'Tarefas'], ['transcript', 'Transcrição']];

/**
 * Share a meeting's notes as a file (PDF, Word or Markdown) with the people the person picks (the meeting's, their team's, or any address).
 * The Ivuenu never sends anything itself: it saves the file, opens the person's email program with the message ready, and shows the file
 * so it can be dragged into the email. The person chooses what goes in; the transcript is off unless they switch it on.
 */
export default function ShareDialog({ meetingId, title, onClose }) {
  const t = useT();
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [others, setOthers] = useState('');
  const [include, setInclude] = useState({ summary: true, mine: true, ai: true, tasks: true, transcript: false });
  const [format, setFormat] = useState('pdf');
  const [paper, setPaper] = useState('A4');
  const [brand, setBrand] = useState(false);
  const [subject, setSubject] = useState(title || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => { call('share:suggest', { id: meetingId }).then(setPeople).catch(() => {}); }, [meetingId]);

  const toggle = (email) => setPicked((s) => { const n = new Set(s); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  const nothing = !Object.values(include).some(Boolean);
  const team = people.filter((p) => p.source === 'team');
  const meeting = people.filter((p) => p.source === 'meeting');

  async function send(openMail) {
    setBusy(true); setError(''); setResult(null);
    try {
      const to = [...picked, others].filter(Boolean).join(', ');
      const r = await call('share:send', { id: meetingId, format, include, paper, brand, to, subject, message, openMail });
      if (r.saved) setResult(r);
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }

  const group = (label, list) => list.length > 0 && (
    <div className="col" style={{ gap: 6 }}>
      <span className="h-sub">{label}</span>
      <div className="row wrap">{list.map((p) => <Chip key={p.email} pressed={picked.has(p.email)} title={p.email} onClick={() => toggle(p.email)}>{p.name}</Chip>)}</div>
    </div>
  );

  return (
    <Dialog title={t('Partilhar notas')} onClose={onClose} wide>
      <div className="dialog-body col" style={{ gap: 16 }}>
        <div className="col" style={{ gap: 10 }}>
          {group(t('Pessoas desta reunião'), meeting)}
          {group(t('A tua equipa'), team)}
          <Field label={t('Outros emails')} htmlFor="sh-others" hint={t('Qualquer pessoa: separa os emails com vírgulas.')}>
            <input id="sh-others" className="input" value={others} onChange={(e) => setOthers(e.target.value)} placeholder="cliente@empresa.pt" />
          </Field>
        </div>

        <div className="col" style={{ gap: 8 }} role="group" aria-label={t('O que partilhar')}>
          <span className="h-sub">{t('O que partilhar')}</span>
          <div className="row wrap" style={{ gap: '8px 18px' }}>
            {PARTS.map(([k, label]) => (
              <label key={k} className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={include[k]} onChange={(e) => setInclude({ ...include, [k]: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
          {include.transcript && <span className="muted" style={{ fontSize: 12 }}>{t('A transcrição mostra tudo o que foi dito, palavra a palavra. Confirma que podes partilhá-la.')}</span>}
        </div>

        <div className="row wrap" style={{ gap: 16 }}>
          <Seg label={t('Formato')} value={format} onChange={setFormat} options={[{ id: 'pdf', label: 'PDF' }, { id: 'docx', label: 'Word' }, { id: 'md', label: 'Markdown' }]} />
          {format === 'pdf' && <Seg label={t('Papel')} value={paper} onChange={setPaper} options={[{ id: 'A4', label: 'A4' }, { id: 'Letter', label: t('Carta') }]} />}
          {format === 'pdf' && (
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={brand} onChange={(e) => setBrand(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
              <span>{t('Linha «Notas criadas com a Ivuenu» no fim')}</span>
            </label>
          )}
        </div>

        <Field label={t('Assunto do email')} htmlFor="sh-subject"><input id="sh-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label={t('Mensagem (opcional)')} htmlFor="sh-message">
          <textarea id="sh-message" className="input" rows={3} style={{ height: 'auto', padding: 12, resize: 'vertical' }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('Olá, segue o resumo da reunião.')} />
        </Field>

        {error && <Banner tone="warn" role="alert">{error}</Banner>}
        {result && (
          <Banner tone="info" role="status">
            <span className="col" style={{ gap: 4 }}>
              <span><strong>{t('Ficheiro guardado: {name}.', { name: result.name })}</strong></span>
              {result.mailOpened && <span>{t('O teu programa de email abriu com a mensagem pronta. Arrasta o ficheiro (está à vista na pasta) para o email e envia.')}</span>}
              {result.truncated && <span>{t('A mensagem era comprida e foi encurtada no email; o ficheiro está completo.')}</span>}
              {result.invalid && result.invalid.length > 0 && <span>{t('Estes endereços não são válidos e ficaram de fora: {list}.', { list: result.invalid.join(', ') })}</span>}
            </span>
          </Banner>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{t('A Ivuenu não envia nada: guarda o ficheiro e abre o email no teu programa de email, para tu o enviares.')}</span>
        <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
          <Button disabled={busy || nothing} onClick={() => send(false)}>{t('Só guardar o ficheiro')}</Button>
          <Button variant="primary" icon="mail" disabled={busy || nothing} onClick={() => send(true)}>{t('Guardar e abrir o email')}</Button>
          <Button onClick={onClose}>{t('Fechar')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
