import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog, Field, Seg, Switch } from './ui.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';
import { useApp } from '../lib/app-context.js';

/**
 * Draft a follow-up email from the meeting's notes. The AI (or, without one, the notes themselves) writes a first version; the person edits
 * it and opens it in their own email program. Nothing is sent from here.
 */
export default function EmailDialog({ meetingId, onClose }) {
  const t = useT();
  const { toast } = useApp();
  const [tone, setTone] = useState('friendly');
  const [language, setLanguage] = useState('auto');
  const [includeTasks, setIncludeTasks] = useState(true);
  const [state, setState] = useState({ busy: true });           // {busy} | {error} | {ready, engine, model}
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [edited, setEdited] = useState(false);                  // the person changed the text: new options must not overwrite it silently
  const [stale, setStale] = useState(false);
  const ticket = useRef(0);

  async function generate(keepRecipients = true) {
    const mine = ++ticket.current;
    setState({ busy: true }); setStale(false);
    try {
      const out = await call('meetings:draftEmail', { id: meetingId, tone, language, includeTasks });
      if (ticket.current !== mine) return;
      setSubject(out.subject || ''); setBody(out.body || ''); setEdited(false);
      if (!keepRecipients || !to) setTo((out.to || []).join(', '));
      setState({ ready: true, engine: out.engine, model: out.model });
    } catch (e) {
      if (ticket.current === mine) setState({ error: friendly(e) });
    }
  }

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; generate(false); return undefined; }
    if (edited) setStale(true); else generate(true);
    return undefined;
  }, [tone, language, includeTasks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { ticket.current += 1; }, []);

  const how = state.engine === 'cloud' ? t('Escrito pela IA na nuvem. Nada fica guardado no servidor.') : state.engine ? t('Montado a partir das tuas notas, sem IA.') : '';

  async function open() {
    try {
      const r = await call('mail:open', { to, subject, body });
      if (r.truncated) toast(t('O texto era comprido: ficou todo copiado. Cola-o no email.'));
    } catch (e) { toast(friendly(e)); }
  }
  const copy = () => navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => toast(t('Copiado'))).catch(() => {});

  return (
    <Dialog title={t('Escrever email a partir das notas')} onClose={onClose} wide>
      <div className="dialog-body col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ gap: 16 }}>
          <Seg label={t('Tom')} value={tone} onChange={setTone} options={[{ id: 'formal', label: t('Formal') }, { id: 'friendly', label: t('Amigável') }, { id: 'direct', label: t('Direto') }]} />
          <Seg label={t('Idioma do email')} value={language} onChange={setLanguage} options={[{ id: 'auto', label: t('Automático') }, { id: 'pt', label: 'Português' }, { id: 'en', label: 'English' }]} />
          <Switch checked={includeTasks} onChange={setIncludeTasks} label={t('Incluir as tarefas')} />
        </div>
        {state.error && <Banner tone="warn" role="alert">{state.error}</Banner>}
        {stale && <Banner tone="info" action={<Button size="sm" onClick={() => generate(true)}>{t('Escrever de novo')}</Button>}>{t('Mudaste as opções, mas o texto tem edições tuas. Escrever de novo apaga-as.')}</Banner>}
        <Field label={t('Para')} htmlFor="em-to" hint={t('Separa os emails com vírgulas.')}>
          <input id="em-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ana@empresa.pt, rui@empresa.pt" />
        </Field>
        <Field label={t('Assunto')} htmlFor="em-subject">
          <input id="em-subject" className="input" value={subject} disabled={!!state.busy} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} />
        </Field>
        <Field label={t('Mensagem')} htmlFor="em-body">
          {state.busy
            ? <div className="row" style={{ gap: 10, minHeight: 120 }} role="status"><span className="spinner" aria-hidden="true" /><span>{t('A escrever…')}</span></div>
            : <textarea id="em-body" className="input" rows={13} style={{ height: 'auto', padding: 12, lineHeight: '22px', resize: 'vertical' }} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />}
        </Field>
        {how && <span className="muted" style={{ fontSize: 12 }}>{how} {t('Revê antes de enviar. A Ivuenu não envia nada: abre o email no teu programa de email.')}</span>}
        <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => generate(true)} disabled={!!state.busy}>{t('Escrever de novo')}</Button>
          <Button icon="copy" onClick={copy} disabled={!body}>{t('Copiar')}</Button>
          <Button variant="primary" icon="mail" onClick={open} disabled={!body || !!state.busy}>{t('Abrir no email')}</Button>
          <Button onClick={onClose}>{t('Fechar')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
