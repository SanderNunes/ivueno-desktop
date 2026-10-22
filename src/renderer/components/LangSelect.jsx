import React from 'react';
import Icon from './Icon.jsx';
import { useApp } from '../lib/app-context.js';
import { LANGUAGES, useT } from '../lib/i18n.js';

/** Language picker (Português is the default). Changing it applies at once and is remembered. */
export default function LangSelect({ id = 'lang-select', compact = false }) {
  const { settings, patchSettings } = useApp();
  const t = useT();
  return (
    <div className="row lang-select" style={{ gap: 8 }}>
      <Icon name="language" size={16} stroke={1.8} style={{ color: 'var(--text-2)' }} />
      <label className="sr-only" htmlFor={id}>{t('lang.label')}</label>
      <select id={id} className="select" style={{ height: compact ? 30 : 36, fontSize: 13 }} value={settings.appLanguage || 'pt'}
        onChange={(e) => patchSettings({ appLanguage: e.target.value })}>
        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </div>
  );
}
