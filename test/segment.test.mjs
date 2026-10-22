import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAtPauses, splitForUpload, levelOfSamples } from '../src/renderer/lib/segment.mjs';

const RATE = 16000;
/** Build samples from [[seconds, amplitude], ...] (amplitude 0..1 of full scale, a 200 Hz tone). */
function tone(parts) {
  const out = [];
  for (const [sec, amp] of parts) for (let i = 0; i < sec * RATE; i++) out.push(Math.round(Math.sin(i / RATE * 2 * Math.PI * 200) * amp * 32767));
  return Int16Array.from(out);
}

test('loudness uses the same scale as the live meter', () => {
  assert.equal(levelOfSamples(new Int16Array(1600), 0, 1600), 0);
  const speech = levelOfSamples(tone([[0.1, 0.1]]), 0, 1600);          // about -23 dB
  assert.ok(speech > 0.55 && speech < 0.75, String(speech));
});

test('sentences separated by pauses become separate pieces that cover the audio in order', () => {
  // 6 s speech, 1.5 s pause, 7 s speech, 1.5 s pause, 5 s speech
  const s = tone([[6, 0.1], [1.5, 0], [7, 0.1], [1.5, 0], [5, 0.1]]);
  const pieces = splitAtPauses(s, RATE);
  assert.equal(pieces.length, 3);
  assert.equal(pieces[0].startMs, 0);
  for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i].from, pieces[i - 1].to);          // no gaps, no overlaps
  assert.equal(pieces.at(-1).to, s.length);
  // each cut falls in a pause (after the speech ended, before the next began)
  assert.ok(pieces[0].to / RATE >= 6.0 && pieces[0].to / RATE <= 7.5);
  assert.ok(pieces[1].to / RATE >= 14.5 && pieces[1].to / RATE <= 15.5 + 1);
});

test('no piece is longer than the maximum, even for speech without a pause', () => {
  const s = tone([[70, 0.1]]);
  const pieces = splitAtPauses(s, RATE, { maxMs: 25000 });
  assert.ok(pieces.length >= 3);
  assert.ok(pieces.every((p) => p.durationMs <= 25100));
  assert.equal(pieces.reduce((n, p) => n + (p.to - p.from), 0), s.length);
});

test('silence is left out, and a file with no speech gives no pieces', () => {
  assert.deepEqual(splitAtPauses(new Int16Array(RATE * 40), RATE), []);
  const s = tone([[30, 0], [5, 0.1]]);                                   // 30 s of nothing, then speech
  const pieces = splitAtPauses(s, RATE);
  assert.ok(pieces.length >= 1); assert.ok(pieces.every((p) => p.durationMs > 0));
  assert.ok(pieces.at(-1).to === s.length);
  assert.ok(pieces.every((p) => levelOfSamples(s, p.from, p.to) > 0.15));
});

test('quiet room noise is not mistaken for speech', () => {
  const noise = Int16Array.from({ length: RATE * 12 }, (_, i) => Math.round(Math.sin(i * 0.37) * 0.002 * 32767));     // about -54 dB
  assert.deepEqual(splitAtPauses(noise, RATE), []);
});

test('an empty file gives nothing', () => {
  assert.deepEqual(splitAtPauses(new Int16Array(0), RATE), []);
});

test('a noisy recording that never goes quiet is still cut at its pauses, not at the maximum', () => {
  // speech (a tone at 0.1) over a constant rumble that never drops below -43 dB: a fixed line would see only speech
  const n = (sec, amp) => tone([[sec, amp]]);
  const rumble = (len, amp) => Int16Array.from({ length: len }, (_, i) => Math.round(Math.sin(i * 0.011) * amp * 32767));
  const parts = []; for (let i = 0; i < 8; i++) { parts.push(n(4, 0.1), n(1.2, 0.0)); }
  const speech = (() => { const a = []; for (const p of parts) a.push(...p); return Int16Array.from(a); })();
  const noise = rumble(speech.length, 0.012);                                                 // about -37 dB all the time
  const mixed = Int16Array.from(speech, (v, i) => v + noise[i]);
  const fixed = splitAtPauses(mixed, RATE, { adaptive: false });
  const adaptive = splitAtPauses(mixed, RATE);
  assert.ok(fixed.some((p) => p.durationMs >= 24500), 'the fixed line never found a pause');
  assert.ok(adaptive.length >= 5 && adaptive.every((p) => p.durationMs < 24500), JSON.stringify(adaptive.map((p) => p.durationMs)));
});

test('a long recording is cut for uploading at its quietest moments, with no gaps and no piece over the limit', () => {
  // 25 minutes: speech everywhere except a 2 s pause near the 10 and 20 minute marks
  const total = 25 * 60;
  const x = new Int16Array(total * RATE);
  for (let i = 0; i < x.length; i++) x[i] = Math.round(Math.sin(i / RATE * 2 * Math.PI * 200) * 0.1 * 32767);
  for (const at of [585, 1181]) x.fill(0, at * RATE, (at + 2) * RATE);
  const pieces = splitForUpload(x, RATE, { maxSec: 600, searchSec: 45 });
  assert.equal(pieces.length, 3);
  assert.equal(pieces[0].from, 0); assert.equal(pieces.at(-1).to, x.length);
  for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i].from, pieces[i - 1].to);
  assert.ok(pieces.every((p) => p.durationMs <= 600000));
  assert.ok(Math.abs(pieces[0].to / RATE - 586) < 1.5 && Math.abs(pieces[1].to / RATE - 1182) < 1.5, pieces.map((p) => p.to / RATE).join(' '));      // in the middle of each pause
  assert.deepEqual(splitForUpload(new Int16Array(RATE * 30), RATE).map((p) => p.durationMs), [30000]);                                                  // short: one piece
  assert.deepEqual(splitForUpload(new Int16Array(0), RATE), []);
});
