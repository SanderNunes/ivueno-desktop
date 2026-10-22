// Reads a calendar from a secret iCalendar (.ics) address on this computer: titles, times and attendees only.
// Supported: UTC / floating / TZID times, all-day events, and recurring events with FREQ=DAILY|WEEKLY(+BYDAY)|MONTHLY,
// INTERVAL, COUNT, UNTIL and EXDATE. Not supported: YEARLY, BYSETPOS and RDATE (those events appear once).

const WINDOWS_ZONES = {
  'W. Central Africa Standard Time': 'Africa/Luanda', 'South Africa Standard Time': 'Africa/Johannesburg',
  'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest', 'E. South America Standard Time': 'America/Sao_Paulo',
  'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles', UTC: 'UTC',
};

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function unfold(text) { return text.replace(/\r?\n[ \t]/g, ''); }

function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const [name, ...params] = line.slice(0, idx).split(';');
  const p = {};
  for (const x of params) { const [k, v] = x.split('='); p[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params: p, value: line.slice(idx + 1) };
}

function unescapeText(s) { return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1'); }

// Offset (ms) of a time zone at a given UTC instant, via Intl (no tz database needed).
function zoneOffset(zone, utcMs) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function parseDate({ value, params }) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, Y, Mo, D, h = '00', mi = '00', s = '00', z] = m;
  const allDay = !m[4];
  const local = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s);
  if (z || allDay) return { ms: local, allDay };
  const tzid = params.TZID && (WINDOWS_ZONES[params.TZID] || params.TZID);
  if (tzid) {
    try { return { ms: local - zoneOffset(tzid, local - zoneOffset(tzid, local)), allDay }; } catch { /* unknown zone: fall through */ }
  }
  const d = new Date(+Y, +Mo - 1, +D, +h, +mi, +s);   // floating time = this computer's zone
  return { ms: d.getTime(), allDay };
}

function parseRrule(value) {
  const r = {};
  for (const part of value.split(';')) { const [k, v] = part.split('='); r[k.toUpperCase()] = v; }
  return r;
}

/** Turn the text of an .ics file into events [{id, title, start, end, allDay, attendees:[{name,email}]}] (ms times). */
function parseIcs(text) {
  const lines = unfold(text).split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') { cur = { attendees: [], exdates: [] }; continue; }
    if (raw === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === 'UID') cur.id = l.value;
    else if (l.name === 'SUMMARY') cur.title = unescapeText(l.value);
    else if (l.name === 'DTSTART') { const d = parseDate(l); if (d) { cur.start = d.ms; cur.allDay = d.allDay; } }
    else if (l.name === 'DTEND') { const d = parseDate(l); if (d) cur.end = d.ms; }
    else if (l.name === 'RRULE') cur.rrule = parseRrule(l.value);
    else if (l.name === 'EXDATE') for (const v of l.value.split(',')) { const d = parseDate({ value: v, params: l.params }); if (d) cur.exdates.push(d.ms); }
    else if (l.name === 'ATTENDEE') cur.attendees.push({ name: l.params.CN || '', email: l.value.replace(/^mailto:/i, '') });
    else if (l.name === 'STATUS' && l.value.toUpperCase() === 'CANCELLED') cur.cancelled = true;
  }
  return events.filter((e) => !e.cancelled).map((e) => ({ ...e, end: e.end || e.start + 3_600_000 }));
}

/** Occurrences of every event that start between fromMs and toMs, soonest first. */
function expand(events, fromMs, toMs) {
  const out = [];
  const push = (e, start) => {
    if (e.exdates.includes(start)) return;
    const end = start + (e.end - e.start);
    if (end >= fromMs && start <= toMs) out.push({ id: `${e.id || e.title}@${start}`, title: e.title || 'Sem título', start, end, allDay: !!e.allDay, attendees: e.attendees });
  };
  for (const e of events) {
    if (!e.rrule) { push(e, e.start); continue; }
    const r = e.rrule;
    const interval = Math.max(1, Number(r.INTERVAL) || 1);
    const until = r.UNTIL ? (parseDate({ value: r.UNTIL, params: {} }) || {}).ms : Infinity;
    const max = r.COUNT ? Number(r.COUNT) : Infinity;
    let n = 0;
    if (r.FREQ === 'DAILY') {
      for (let t = e.start; t <= Math.min(toMs, until) && n < max; t += interval * 86_400_000, n++) push(e, t);
    } else if (r.FREQ === 'WEEKLY') {
      const days = (r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))) : [new Date(e.start).getUTCDay()]).filter((d) => d >= 0);
      const startDay = new Date(e.start);
      const weekStart = e.start - startDay.getUTCDay() * 86_400_000;
      for (let w = 0; ; w += interval) {
        const base = weekStart + w * 7 * 86_400_000;
        if (base > Math.min(toMs, until)) break;
        for (const d of [...days].sort((a, b) => a - b)) {
          const t = base + d * 86_400_000;
          if (t < e.start || t > until) continue;
          if (n++ >= max) break;
          push(e, t);
        }
        if (n >= max) break;
      }
    } else if (r.FREQ === 'MONTHLY') {
      const s = new Date(e.start);
      for (let k = 0; n < max; k += interval, n++) {
        const t = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds());
        if (t > Math.min(toMs, until)) break;
        push(e, t);
      }
    } else push(e, e.start);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Upcoming events in the next `hours` hours, from the text of an .ics file. */
function upcoming(icsText, { now = Date.now(), hours = 48 } = {}) {
  return expand(parseIcs(icsText), now, now + hours * 3_600_000).filter((e) => !e.allDay && e.end > now);
}

module.exports = { parseIcs, expand, upcoming };
