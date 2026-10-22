import React from 'react';
import isotipo from '../assets/isotipo.svg';

// The icon set from the design: outline 1.6 px on a 24 grid, round caps and joins. Colour comes from the text colour.
const P = (d) => <path d={d} />;
const ICONS = {
  home: <>{P('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z')}</>,
  tasks: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" />{P('m8 12 3 3 5-6')}</>,
  search: <><circle cx="11" cy="11" r="6.5" />{P('m20 20-4.2-4.2')}</>,
  folder: <>{P('M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z')}</>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" />{P('M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21')}</>,
  speaker: <><rect x="3" y="4" width="18" height="12" rx="2" />{P('M8 20h8M12 16v4')}</>,
  shield: <>{P('M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z')}</>,
  shieldCheck: <>{P('M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z')}{P('m9 12 2.2 2.2L15.5 10')}</>,
  laptop: <>{P('M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5z')}{P('M3 18.5h18')}</>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" />{P('M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5')}</>,
  export: <>{P('M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13')}</>,
  thumb: <>{P('M7 10v10H4.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM7 10l4-6.5a2 2 0 0 1 3 1.9L13.5 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7')}</>,
  trash: <>{P('M4.5 7h15M10 4h4M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5')}</>,
  offline: <>{P('M3 3l18 18M8.5 8.5A5 5 0 0 0 6.5 18H17M10.5 5.6A6 6 0 0 1 18 11a3.5 3.5 0 0 1 2.5 5.5')}</>,
  language: <><circle cx="12" cy="12" r="8.5" />{P('M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5')}</>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" />{P('M8 10.5V8a4 4 0 0 1 8 0v2.5')}</>,
  chat: <>{P('M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z')}</>,
  plus: <>{P('M12 5v14M5 12h14')}</>,
  close: <>{P('M6 6l12 12M18 6 6 18')}</>,
  chevronDown: <>{P('m6 9 6 6 6-6')}</>,
  chevronUp: <>{P('m6 15 6-6 6 6')}</>,
  back: <>{P('m15 6-6 6 6 6')}</>,
  check: <>{P('m5 12.5 4.5 4.5L19 7.5')}</>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
  play: <>{P('M7 5v14l12-7z')}</>,
  stop: <><rect x="4" y="4" width="16" height="16" rx="3" /></>,
  miniWindow: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="12" width="6" height="4" rx="1" /></>,
  edit: <>{P('M4 20h4L19 9l-4-4L4 16z')}</>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" />{P('m4.5 7.5 7.5 6 7.5-6')}</>,
  share: <><circle cx="6.5" cy="12" r="2.3" /><circle cx="17.5" cy="6.5" r="2.3" /><circle cx="17.5" cy="17.5" r="2.3" />{P('m8.5 10.9 7-3.3M8.5 13.1l7 3.3')}</>,
  eyeOff: <>{P('M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.5 9 6-.3.8-1.2 2.3-2.6 3.6M6.5 7.6C4.5 9 3.3 11 3 12c.5 1.5 4 6 9 6 1.6 0 3-.4 4.2-1.1')}</>,
  openOut: <>{P('M14 4h6v6M20 4l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10')}</>,
  sliders: <>{P('M4 7h10M18 7h2M4 17h4M12 17h8')}<circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  info: <><circle cx="12" cy="12" r="8.5" />{P('M12 11v5M12 7.8v.3')}</>,
  alert: <><circle cx="12" cy="12" r="8.5" />{P('M12 7.5v5.5M12 16.2v.3')}</>,
  arrowDown: <>{P('M12 5v14M6 13l6 6 6-6')}</>,
  org: <><rect x="4" y="3.5" width="16" height="17" rx="2" />{P('M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2')}</>,
};

export default function Icon({ name, size = 20, stroke = 1.6, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style} className={className}>
      {ICONS[name]}
    </svg>
  );
}

/** The mark (isotipo from the designer). The red dot is added only while recording. */
export function Logo({ size = 28, recording = false }) {
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-block', flex: 'none' }}>
      <img src={isotipo} width={size} height={size} alt="" aria-hidden="true" draggable="false" />
      {recording && <span style={{ position: 'absolute', right: -3, bottom: -3, width: 9, height: 9, borderRadius: 999, background: 'var(--rec)', border: '1.5px solid var(--surface)' }} />}
    </span>
  );
}
