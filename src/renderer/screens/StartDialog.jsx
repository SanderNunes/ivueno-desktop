import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from '../components/Icon.jsx';
import { Banner, Button, Dialog, Field, Seg, Switch } from '../components/ui.jsx';
import { useApp, TEMPLATE_NAMES } from '../lib/app-context.js';
import { useQuery } from '../lib/hooks.js';
import { call } from '../lib/bridge.js';
import { listMics } from '../lib/audio.js';
import { friendly } from '../lib/errors.mjs';

const LANG_LABEL = { auto: 'Idioma: automático', pt: 'Idioma: português', en: 'Idioma: English' };

/** "Nova reunião": a title, a few optional settings, and the one consent reminder. Both answers start recording. */
export default function StartDialog({ prefill, onClose, onStarted }) {
  const t = useT();
  const { settings, nav, patchSettings } = useApp();
  const folders = useQuery('folders:list', null, { kinds: ['folders'] });
  const [title, setTitle] = useState(prefill.title || '');
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState(prefill.folderId || '');
  const [template, setTemplate] = useState(settings.template);
  const [language, setLanguage] = useState(settings.language);
  const [place, setPlace] = useState(settings.meetingPlace || 'both');       // room | online | both
  const [translateTo, setTranslateTo] = useState('');
  const [keep, setKeep] = useState(settings.keepTranscript);
  const [hide, setHide] = useState(settings.redact);
  const [attendees, setAttendees] = useState(prefill.attendees || []);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [micLabel, setMicLabel] = useState('Microfone predefinido');

  useEffect(() => {
    listMics().then((mics) => { const m = mics.find((x) => x.id === settings.micId); if (m) setMicLabel(m.label); });
  }, [settings.micId]);

  function addAttendee() {
    const v = typed.trim();
    if (!v) return;
    setAttendees([...attendees, v.includes('@') ? { name: '', email: v } : { name: v, email: '' }]);
    setTyped('');
  }

  async function begin(consent) {
    setBusy(true); setError(null);
    try {
      if (place !== settings.meetingPlace) patchSettings({ meetingPlace: place }).catch(() => {});       // remembered for next time
      await call('rec:start', {
        consent,
        input: { place, title: title.trim(), folderId: folderId || null, template, language: language === 'auto' ? null : language, translateTo: translateTo || null, keepTranscript: keep, redact: hide, attendees, calendarEventId: prefill.calendarEventId || null },
      });
      onStarted();
    } catch (err) { setError(err); setBusy(false); }
  }

  const blocked = error && (error.code === 'limit_reached' || error.code === 'plan_required');

  return (
    <Dialog title={t("Nova reunião")} onClose={onClose}>
      <div className="dialog-body">
        <Field label={t("Título")} optional htmlFor="sd-name" hint={prefill.subtitle}>
          <input id="sd-name" className="input" style={{ height: 40, fontSize: 15 }} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>

        <Field label={t('Onde estão as pessoas?')} hint={place === 'room' ? t('Só o microfone. No fim separamos as vozes de cada pessoa.') : t('O microfone e o som do computador.')}>
          <Seg label={t('Onde estão as pessoas?')} value={place} onChange={setPlace} options={[{ id: 'room', label: t('Na mesma sala') }, { id: 'online', label: t('Em chamada') }, { id: 'both', label: t('Os dois') }]} />
        </Field>

        <div className="row wrap" style={{ gap: 6 }}>
          <span className="tag">{t(LANG_LABEL[language])}</span>
          <span className="tag">{t('Notas: {style}', { style: t(TEMPLATE_NAMES[template]) })}</span>
          {folderId && folders.data && <span className="tag">{(folders.data.find((f) => f.id === folderId) || {}).name}</span>}
          <span className="tag">{keep ? t('Guardar transcrição') : t('Só notas')}</span>
          <span className="tag">{hide ? t('Ocultar sensíveis') : t('Sem ocultação')}</span>
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="sd-options" onClick={() => setOpen(!open)} style={{ color: 'var(--accent-hover)', height: 28, padding: '0 8px' }}>
            {t("Opções")}<Icon name="chevronDown" size={14} stroke={2.2} style={{ transform: open ? 'rotate(180deg)' : '' }} />
          </Button>
        </div>

        {open && (
          <div id="sd-options" className="options">
            <div className="grid-auto">
              <Field label={t("Pasta")} htmlFor="sd-folder">
                <select id="sd-folder" className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">{t("Sem pasta")}</option>
                  {(folders.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
              <Field label={t("Estilo das notas")} htmlFor="sd-style">
                <select id="sd-style" className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
                  {Object.entries(TEMPLATE_NAMES).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
                </select>
              </Field>
            </div>
            <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
              <Field label={t("Idioma falado")}>
                <Seg label={t("Idioma falado")} value={language} onChange={setLanguage} options={[{ id: 'auto', label: t('Automático') }, { id: 'pt', label: 'Português' }, { id: 'en', label: 'English' }]} />
              </Field>
              <Field label={t("Traduzir para")} htmlFor="sd-tr">
                <select id="sd-tr" className="select" style={{ minWidth: 160 }} value={translateTo} onChange={(e) => setTranslateTo(e.target.value)}>
                  <option value="">{t("Não traduzir")}</option><option value="pt">Português</option><option value="en">English</option>
                </select>
              </Field>
            </div>
            <Field label={t("Participantes")} htmlFor="sd-att">
              <div className="row wrap" style={{ padding: 6, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--surface)', gap: 6 }}>
                {attendees.map((a, i) => (
                  <span key={i} className="tag" style={{ height: 26, paddingRight: 4, fontSize: 13 }}>
                    {a.name || a.email}
                    <button type="button" className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`Remover ${a.name || a.email}`} onClick={() => setAttendees(attendees.filter((_, j) => j !== i))}><Icon name="close" size={12} stroke={2.4} /></button>
                  </span>
                ))}
                <input id="sd-att" placeholder={t("Nome ou email")} value={typed} onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAttendee(); } }} onBlur={addAttendee}
                  style={{ flex: 1, minWidth: 120, height: 26, border: 0, outline: 0, background: 'transparent' }} />
              </div>
            </Field>
            <div className="grid-auto">
              <Switch checked={keep} onChange={setKeep} label={t("Guardar a transcrição depois das notas")} hint={keep ? t('Podes rever o que foi dito mais tarde.') : t('Só notas: a transcrição é apagada depois')} />
              <Switch checked={hide} onChange={setHide} label={t("Ocultar detalhes sensíveis")} hint={t("Números de cartão e palavras-passe ficam ••••")} />
            </div>
          </div>
        )}
      </div>

      <div className="dialog-foot">
        {error && (
          <Banner tone="error" role="alert" action={blocked ? <a href="#" onClick={(e) => { e.preventDefault(); onClose(); nav('plans'); }}>{t("Ver planos")}</a> : null}>
            <span className="body">{friendly(error)}</span>
          </Banner>
        )}
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="shieldCheck" size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <strong style={{ fontSize: 14 }}>{t("Avisa os participantes que estão a ser gravados.")}</strong>
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
          <span className="muted" style={{ fontSize: 12, flex: '1 1 220px' }}>{t("Os dois botões começam a gravar. “Só eu” é para notas pessoais, sem mais ninguém. A tua resposta fica no registo de consentimento.")}</span>
          <span className="row" style={{ gap: 8 }}>
            <Button disabled={busy} onClick={() => begin('solo')}>{t("Só eu")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => begin('confirmed')}>{t("Já avisei")}</Button>
          </span>
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <span className="row" style={{ gap: 6 }}><Icon name="laptop" size={14} stroke={1.8} />{t("Guardada neste computador.")}</span>
          <span className="row" style={{ gap: 8 }}>{micLabel}{settings.captureSystem ? ' · Som do computador' : ''}
            <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); onClose(); nav('settings', { section: 'grav' }); }}>{t("Mudar")}</a></span>
        </div>
      </div>
    </Dialog>
  );
}
