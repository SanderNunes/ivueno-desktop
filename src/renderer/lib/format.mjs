// Small pure helpers for dates, durations, labels and search highlighting. All text is Portuguese (Angola).

const p2 = (n) => String(n).padStart(2, '0');
// Interface language for the words produced here ("Hoje", "min", weekday names). The app sets it when the language changes.
let LANG = 'pt';
export const setFormatLang = (lang) => { LANG = lang === 'en' ? 'en' : 'pt'; };
const locale = () => (LANG === 'en' ? 'en-GB' : 'pt-PT');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Weekday name in the interface language: "Sexta-feira" / "Friday". */
export const weekdayName = (date, style = 'long') => cap(new Intl.DateTimeFormat(locale(), { weekday: style }).format(date));
/** Month name in the interface language: "Novembro" / "November". */
export const monthName = (date) => cap(new Intl.DateTimeFormat(locale(), { month: 'long' }).format(date));
const T = {
  pt: { less: 'menos de 1 min', today: 'Hoje', yesterday: 'Ontem', tomorrow: 'Amanhã', recording: 'A gravar', paused: 'Em pausa', writing: 'A escrever notas…',
    needsNotes: 'Precisa de notas', failed: 'Notas por escrever', notesOnly: 'Só notas', ready: 'Pronta', task: 'tarefa', tasks: 'tarefas',
    weak: (n) => `Fraca · faltam ${n} caracteres para o mínimo de 10`, good: 'Boa', strong: 'Forte' },
  en: { less: 'less than 1 min', today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow', recording: 'Recording', paused: 'Paused', writing: 'Writing notes…',
    needsNotes: 'Needs notes', failed: 'Notes not written', notesOnly: 'Notes only', ready: 'Ready', task: 'task', tasks: 'tasks',
    weak: (n) => `Weak · ${n} more characters to reach the minimum of 10`, good: 'Good', strong: 'Strong' },
};
const w = () => T[LANG];

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function clockStr(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}

/** "52 min", "1 h 48 min", "menos de 1 min" */
export function durationStr(seconds) {
  if (seconds == null) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return w().less;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const hm = (iso) => { const d = new Date(iso); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const dm = (iso) => { const d = new Date(iso); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };
export const dmy = (iso) => { const d = new Date(iso); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Days from `now` to `iso` (negative = past) by calendar day. */
export function dayDiff(iso, now = new Date()) {
  return Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000);
}

/** Group heading for the recent list: "Hoje · 20/10", "Ontem · 19/10", "Sexta-feira · 16/10", "03/07/2026". */
export function dayHeading(iso, now = new Date()) {
  const diff = dayDiff(iso, now);
  const d = new Date(iso);
  if (diff === 0) return `${w().today} · ${dm(iso)}`;
  if (diff === -1) return `${w().yesterday} · ${dm(iso)}`;
  if (diff > -7 && diff < 0) return `${weekdayName(d)} · ${dm(iso)}`;
  return dmy(iso);
}

export function groupByDay(meetings, now = new Date()) {
  const groups = [];
  for (const m of meetings) {
    const key = dayHeading(m.startedAt || m.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.heading === key) last.items.push(m); else groups.push({ heading: key, items: [m] });
  }
  return groups;
}

/** "Hoje · 14:00–14:45", "Amanhã · 09:00–09:30", "Quinta · 09:00–09:30" */
export function eventWhen(startMs, endMs, now = new Date()) {
  const iso = new Date(startMs).toISOString();
  const diff = dayDiff(iso, now);
  const day = diff === 0 ? w().today : diff === 1 ? w().tomorrow : `${weekdayName(new Date(startMs), 'short')} ${dm(iso)}`;
  return `${day} · ${hm(iso)}–${hm(new Date(endMs).toISOString())}`;
}

/** What to show in the status column of a meeting row. tone: accent | warning | muted | rec */
export function statusOf(m) {
  if (m.status === 'recording') return { label: w().recording, tone: 'rec' };
  if (m.status === 'paused') return { label: w().paused, tone: 'muted' };
  if (m.status === 'processing' || m.notesState === 'writing') return { label: w().writing, tone: 'accent' };
  if (m.notesState === 'failed') return { label: w().failed, tone: 'warning' };
  if (m.notesState === 'none') return { label: w().needsNotes, tone: 'warning' };
  if (m.keepTranscript === false) return { label: w().notesOnly, tone: 'muted' };
  return { label: w().ready, tone: 'muted' };
}

export function tasksLabel(m) {
  const n = m.totalTasks ?? 0;
  return n ? `${n} ${n === 1 ? w().task : w().tasks}` : '';
}

/** Split text into [{text, hit}] so the matching words can be highlighted (accent-insensitive). */
export function highlightParts(text, query) {
  const q = fold(query).trim();
  if (!q) return [{ text, hit: false }];
  const hay = fold(text);
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const at = hay.indexOf(q, i);
    if (at < 0) { parts.push({ text: text.slice(i), hit: false }); break; }
    if (at > i) parts.push({ text: text.slice(i, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return parts;
}

/** Turn "00:12:38" into milliseconds, for "go to time". Accepts mm:ss and hh:mm:ss. */
export function parseClock(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.length > 3 || parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  while (parts.length < 3) parts.unshift(0);          // "12:38" means 12 minutes 38 seconds
  const [h, m, s] = parts;
  return ((h * 60 + m) * 60 + s) * 1000;
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/** Password strength for the sign-up form: 0..4 and a Portuguese hint. Minimum length is 10 (the backend's rule). */
export function passwordStrength(pw) {
  const len = String(pw || '').length;
  if (len === 0) return { score: 0, label: '', ok: false };
  if (len < 10) return { score: Math.min(2, 1 + (len >= 6 ? 1 : 0)), label: w().weak(10 - len), ok: false };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (len >= 14 || kinds >= 3) return { score: 4, label: w().strong, ok: true };
  return { score: 3, label: w().good, ok: true };
}
