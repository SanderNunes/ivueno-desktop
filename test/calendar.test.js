const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIcs, upcoming, expand } = require('../src/main/calendar');

const ics = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const T = (s) => Date.parse(s);

test('parses UTC events with attendees and unescapes the title', () => {
  const text = ics(ev(['UID:1', 'SUMMARY:Chamada com cliente\\, Banco Exemplo', 'DTSTART:20261020T130000Z', 'DTEND:20261020T134500Z',
    'ATTENDEE;CN=Domingos Kiala:mailto:domingos@exemplo.ao']));
  const [e] = parseIcs(text);
  assert.equal(e.title, 'Chamada com cliente, Banco Exemplo');
  assert.equal(e.start, T('2026-10-20T13:00:00Z'));
  assert.deepEqual(e.attendees, [{ name: 'Domingos Kiala', email: 'domingos@exemplo.ao' }]);
});

test('converts a Windows time zone name (Outlook) to the right instant', () => {
  const text = ics(ev(['UID:2', 'SUMMARY:X', 'DTSTART;TZID=W. Central Africa Standard Time:20261020T140000', 'DTEND;TZID=W. Central Africa Standard Time:20261020T144500']));
  assert.equal(parseIcs(text)[0].start, T('2026-10-20T13:00:00Z'), 'Luanda is UTC+1');
});

test('unfolds long lines and drops cancelled events', () => {
  const text = ics(`${ev(['UID:3', 'SUMMARY:Reunião muito longa que continua', ' na linha seguinte', 'DTSTART:20261021T080000Z'])}\r\n${ev(['UID:4', 'SUMMARY:Cancelada', 'DTSTART:20261021T090000Z', 'STATUS:CANCELLED'])}`);
  const events = parseIcs(text);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Reunião muito longa que continuana linha seguinte');
});

test('weekly recurring events expand on the right days and honour EXDATE and COUNT', () => {
  const text = ics(ev(['UID:5', 'SUMMARY:Semanal', 'DTSTART:20261019T080000Z', 'DTEND:20261019T083000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=5', 'EXDATE:20261022T080000Z']));
  const list = expand(parseIcs(text), T('2026-10-01T00:00:00Z'), T('2026-12-31T00:00:00Z'));
  assert.deepEqual(list.map((e) => new Date(e.start).toISOString().slice(0, 10)), ['2026-10-19', '2026-10-26', '2026-10-29', '2026-11-02']);
});

test('upcoming shows the next 48 hours, skipping the past and all-day events', () => {
  const now = T('2026-10-20T09:00:00Z');
  const text = ics([
    ev(['UID:a', 'SUMMARY:Passada', 'DTSTART:20261020T070000Z', 'DTEND:20261020T080000Z']),
    ev(['UID:b', 'SUMMARY:Hoje', 'DTSTART:20261020T130000Z', 'DTEND:20261020T134500Z']),
    ev(['UID:c', 'SUMMARY:Daqui a 5 dias', 'DTSTART:20261025T130000Z']),
    ev(['UID:d', 'SUMMARY:Dia inteiro', 'DTSTART;VALUE=DATE:20261020']),
  ].join('\r\n'));
  assert.deepEqual(upcoming(text, { now }).map((e) => e.title), ['Hoje']);
});
