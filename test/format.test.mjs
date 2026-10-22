import test from 'node:test';
import assert from 'node:assert/strict';
import { durationStr, dayHeading, groupByDay, eventWhen, statusOf, highlightParts, parseClock, passwordStrength, initialsOf, clockStr } from '../src/renderer/lib/format.mjs';
import { friendly } from '../src/renderer/lib/errors.mjs';

const NOW = new Date(2026, 9, 20, 12, 0, 0);          // Tue 20/10/2026, local time

test('durations read like the design', () => {
  assert.equal(durationStr(13 * 60), '13 min');
  assert.equal(durationStr(108 * 60), '1 h 48 min');
  assert.equal(durationStr(3600), '1 h');
  assert.equal(durationStr(20), 'menos de 1 min');
  assert.equal(durationStr(null), '');
});

test('day headings: today, yesterday, weekday this week, then full date', () => {
  const at = (d, h = 10) => new Date(2026, 9, d, h).toISOString();
  assert.equal(dayHeading(at(20), NOW), 'Hoje · 20/10');
  assert.equal(dayHeading(at(19), NOW), 'Ontem · 19/10');
  assert.equal(dayHeading(at(16), NOW), 'Sexta-feira · 16/10');
  assert.equal(dayHeading(new Date(2026, 6, 3, 10).toISOString(), NOW), '03/07/2026');
});

test('grouping keeps the order and starts a new group per day', () => {
  const m = (d, h) => ({ id: `${d}-${h}`, startedAt: new Date(2026, 9, d, h).toISOString() });
  const g = groupByDay([m(19, 15), m(19, 11), m(16, 9)], NOW);
  assert.deepEqual(g.map((x) => [x.heading, x.items.length]), [['Ontem · 19/10', 2], ['Sexta-feira · 16/10', 1]]);
});

test('upcoming event labels', () => {
  const t = (d, h, mi = 0) => new Date(2026, 9, d, h, mi).getTime();
  assert.equal(eventWhen(t(20, 14), t(20, 14, 45), NOW), 'Hoje · 14:00–14:45');
  assert.equal(eventWhen(t(21, 9), t(21, 9, 30), NOW), 'Amanhã · 09:00–09:30');
});

test('status column follows the notes state', () => {
  assert.deepEqual(statusOf({ status: 'done', notesState: 'ready', keepTranscript: true }), { label: 'Pronta', tone: 'muted' });
  assert.equal(statusOf({ status: 'done', notesState: 'ready', keepTranscript: false }).label, 'Só notas');
  assert.equal(statusOf({ status: 'done', notesState: 'none' }).tone, 'warning');
  assert.equal(statusOf({ status: 'processing', notesState: 'writing' }).label, 'A escrever notas…');
  assert.equal(statusOf({ status: 'recording' }).tone, 'rec');
});

test('highlighting ignores accents and case but keeps the original text', () => {
  assert.deepEqual(highlightParts('A lista de Preços Q4', 'precos'), [
    { text: 'A lista de ', hit: false }, { text: 'Preços', hit: true }, { text: ' Q4', hit: false }]);
  assert.deepEqual(highlightParts('nada', ''), [{ text: 'nada', hit: false }]);
});

test('go-to-time accepts mm:ss and hh:mm:ss and rejects nonsense', () => {
  assert.equal(parseClock('01:24:00'), 5_040_000);
  assert.equal(parseClock('12:38'), 758_000);
  assert.equal(parseClock('abc'), null);
  assert.equal(parseClock('1:2:3:4'), null);
});

test('password hint follows the backend minimum of 10', () => {
  assert.match(passwordStrength('1234567').label, /faltam 3 caracteres/);
  assert.equal(passwordStrength('uma-frase-longa-123').ok, true);
  assert.equal(passwordStrength('').score, 0);
});

test('initials and the clock', () => {
  assert.equal(initialsOf('Ana Silva'), 'AS');
  assert.equal(initialsOf('Orador 2'), 'O2');
  assert.equal(clockStr(758_000), '00:12:38');
});

test('error wording: ours, never the backend\'s English', () => {
  assert.equal(friendly({ code: 'invalid_credentials', message: 'email or password is wrong' }), 'O email ou a palavra-passe não estão certos.');
  assert.match(friendly({ code: 'x', status: 502, message: 'bad gateway' }), /servidor da Ivuenu/);
  assert.equal(friendly({ code: 'x', message: 'some english thing' }), 'Algo correu mal. Tenta outra vez.');
  assert.equal(friendly({ code: 'x', message: 'Não foi possível escrever as notas.' }), 'Não foi possível escrever as notas.');
});
