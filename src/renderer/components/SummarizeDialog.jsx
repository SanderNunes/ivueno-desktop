import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button, Dialog, Seg } from './ui.jsx';
import { call } from '../lib/bridge.js';
import { friendly } from '../lib/errors.mjs';
import { useT } from '../lib/i18n.js';

/**
 * Summarise a meeting ('meeting': the whole conversation, saved as the meeting's summary) or only the person's own notes ('notes':
 * what is in the box, which can be added to the notes). The AI of the Ivuenu server writes it; if that cannot be reached it is an extract. The result says which.
 */
export default function SummarizeDialog({ scope, meetingId, notesText = '', onClose, onSaved, onAppendToNotes }) {
  const t = useT();
  const [style, setStyle] = useState(scope === 'notes' ? 'short' : 'normal');
  const [state, setState] = useState({ busy: true });
  const ticket = useRef(0);

  useEffect(() => {
    const mine = ++ticket.current;                         // a newer request (or closing) makes an older answer irrelevant
    setState({ busy: true });
    const run = scope === 'notes'
      ? call('notes:summarize', { id: meetingId, text: notesText, style })
      : call('meetings:summarize', { id: meetingId, style });
    run.then((out) => { if (ticket.current === mine) setState({ out }); })
      .catch((e) => { if (ticket.current === mine) setState({ error: friendly(e) }); });
    return () => { ticket.current += 1; };
  }, [scope, meetingId, style]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = state.out;
  const how = !out ? '' : out.engine === 'cloud' ? t('Resumido pela IA da Ivuenu. Nada fica guardado no servidor.')
    : t('Extraído do texto, sem IA: não foi possível chegar ao serviço de IA.');

  async function save() {
    try { await call('meetings:patch', { id: meetingId, patch: { summary: out.text.slice(0, 2000) } }); onSaved && onSaved(out.text); onClose(); }
    catch (e) { setState({ ...state, error: friendly(e) }); }
  }
  const copy = () => navigator.clipboard.writeText(out.text).then(() => setState({ ...state, copied: true })).catch(() => {});

  return (
    <Dialog title={scope === 'notes' ? t('Resumir as minhas notas') : t('Resumir a reunião')} onClose={onClose} wide>
      <div className="dialog-body col" style={{ gap: 14 }}>
        <Seg label={t('Tamanho do resumo')} value={style} onChange={setStyle} options={[{ id: 'short', label: t('Curto') }, { id: 'normal', label: t('Normal') }, { id: 'detailed', label: t('Detalhado') }]} />
        {state.busy && <div className="row" style={{ gap: 10 }} role="status"><span className="spinner" aria-hidden="true" /><span>{t('A resumir…')}</span></div>}
        {state.error && <Banner tone="warn" role="alert">{state.error}</Banner>}
        {out && (
          <>
            <div className="card" style={{ padding: 16, maxHeight: 340, overflow: 'auto' }}>
              <p style={{ whiteSpace: 'pre-line', fontSize: 15, lineHeight: '24px' }}>{out.text}</p>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              {how} {scope === 'meeting' && out.basis === 'notes' ? t('Como a transcrição não foi guardada, o resumo parte das notas.') : ''} {t('Revê antes de enviar.')}
            </span>
          </>
        )}
        <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
          {out && <Button icon="copy" onClick={copy}>{state.copied ? t('Copiado') : t('Copiar')}</Button>}
          {out && scope === 'meeting' && <Button variant="primary" onClick={save}>{t('Guardar como resumo da reunião')}</Button>}
          {out && scope === 'notes' && <Button variant="primary" onClick={() => { onAppendToNotes(out.text); onClose(); }}>{t('Acrescentar às minhas notas')}</Button>}
          <Button onClick={onClose}>{t('Fechar')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
