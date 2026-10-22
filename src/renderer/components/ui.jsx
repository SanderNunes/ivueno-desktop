import React, { useEffect, useId, useRef } from 'react';
import { useT } from '../lib/i18n.js';
import Icon from './Icon.jsx';

export function Button({ variant = '', size = '', icon, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant} ${size} ${className}`.trim()} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} stroke={variant === 'primary' ? 2 : 1.8} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, size = '', bordered = false, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${size} ${bordered ? 'bordered' : ''}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}

export function Chip({ pressed, locked, icon, children, ...rest }) {
  return (
    <button type="button" className={`chip ${locked ? 'locked' : ''}`} aria-pressed={pressed === undefined ? undefined : !!pressed} {...rest}>
      {icon && <Icon name={icon} size={13} stroke={1.8} />}
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="switch-row">
      <span className="t"><span style={{ fontWeight: 600 }}>{label}</span>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

/** Segmented control (radio group). options: [{id, label}] */
export function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, hint, optional, children, htmlFor }) {
  const t = useT();
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}{optional && <span className="faint" style={{ fontWeight: 400 }}> {t("(opcional)")}</span>}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Banner({ tone = 'info', icon, role = 'status', children, action }) {
  const defaults = { info: 'info', warn: 'offline', error: 'alert', ok: 'check' };
  return (
    <div className={`banner ${tone}`} role={role}>
      <Icon name={icon || defaults[tone]} size={18} stroke={1.8} style={{ flex: 'none', marginTop: tone === 'error' ? 1 : 0 }} />
      <span className="grow">{children}</span>
      {action}
    </div>
  );
}

export function Avatar({ color = 0, initials, size = '', stack = false, title }) {
  return <span className={`avatar spk-${color % 8} ${size} ${stack ? 'stack' : ''}`} title={title} aria-hidden="true">{initials}</span>;
}

export function RecDot({ small }) { return <span className={`rec-dot ${small ? 'sm' : ''}`} aria-hidden="true" />; }

/** A modal dialog: focus moves in, Escape closes, focus returns to what opened it. */
export function Dialog({ title, onClose, children, wide, labelledBy }) {
  const t = useT();
  const ref = useRef(null);
  const id = useId();
  // The close handler is usually an inline arrow, a new function on every render. Depending on it would run this effect again at every key
  // typed in a field and pull the focus back to the dialog frame, so only the latest handler is remembered and the effect runs once.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();       // not when a field inside already took the focus (autoFocus)
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous && previous.focus && previous.focus(); };
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog dialog-in ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy || id} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={labelledBy || id}>{title}</h2>
          <IconButton icon="close" label={t("Fechar")} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14 }) { return <div className="skel" style={{ width: w, height: h }} aria-hidden="true" />; }

export function Toast({ message }) {
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none' }}>
      {message && (
        <div className="slide-in" style={{ background: 'var(--text)', color: 'var(--surface)', borderRadius: 999, padding: '10px 18px', fontWeight: 600, boxShadow: 'var(--shadow-2)', animation: 'ivSlide 160ms var(--ease)' }}>
          {message}
        </div>
      )}
    </div>
  );
}

/** Level meter with 5 bars (microphone or computer sound). level 0..1 */
export function LevelBars({ level, label }) {
  const heights = [5, 8, 11, 14, 16];
  const on = Math.round(level * 5);
  return (
    <span className="levels" role="img" aria-label={label}>
      {heights.map((h, i) => <i key={i} className={i < on ? 'on' : ''} style={{ height: h }} />)}
    </span>
  );
}
