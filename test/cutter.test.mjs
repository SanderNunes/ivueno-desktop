import test from 'node:test';
import assert from 'node:assert/strict';
import { PauseCutter } from '../src/renderer/lib/cutter.mjs';

/** Feed one level every 100 ms from `from` to `to` (ms); returns the time of the first cut, or null. */
function run(c, level, from, to) { for (let t = from; t <= to; t += 100) if (c.push(level(t), t)) return t; return null; }

test('it cuts at the pause after a sentence, not in the middle of it', () => {
  const c = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000 });
  c.reset(0);
  // speech until 6.0 s, then quiet
  const cut = run(c, (t) => (t <= 6000 ? 0.6 : 0.02), 0, 20000);
  assert.ok(cut >= 6700 && cut <= 6800, `cut at ${cut}`);
});

test('a short pause inside a sentence does not cut, and nothing is cut before the minimum length', () => {
  const c = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000 });
  c.reset(0);
  assert.equal(run(c, (t) => ((t > 2000 && t < 2500) ? 0.02 : 0.6), 0, 3900), null);         // a 0.5 s breath
  const early = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000 }); early.reset(0);
  assert.equal(run(early, (t) => (t <= 1000 ? 0.6 : 0.02), 0, 3900), null);                   // quiet already, but too early
});

test('continuous speech is cut at the maximum; pure silence is cut at it too', () => {
  const c = new PauseCutter({ maxMs: 12000 }); c.reset(0);
  assert.equal(run(c, () => 0.7, 0, 20000), 12000);
  const s = new PauseCutter({ maxMs: 12000 }); s.reset(0);
  assert.equal(run(s, () => 0, 0, 20000), 12000);
});

test('silence from the start never cuts early (nothing was said)', () => {
  const c = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000 }); c.reset(0);
  assert.equal(run(c, () => 0.01, 0, 24900), null);
});

test('reset starts a fresh piece', () => {
  const c = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000 }); c.reset(0);
  c.push(0.6, 5000); assert.equal(c.push(0.02, 5800), true);
  c.reset(5800);
  assert.equal(c.push(0.02, 9900), false);
});

test('in a noisy room the line between speech and pause follows the noise floor, so pauses are still found', () => {
  // the quiet moments sit at 0.40 (a loud room) and speech at 0.60: a fixed line at 0.3 would call everything speech and never cut before the maximum
  const level = (t) => ((t % 5000) < 3500 ? 0.6 : 0.4);
  const fixed = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000 }); fixed.reset(0);
  const learned = new PauseCutter({ minMs: 4000, pauseMs: 700, maxMs: 25000, adaptive: true }); learned.reset(0);
  const first = (c) => { for (let t = 0; t <= 30000; t += 100) if (c.push(level(t), t)) return t; return null; };
  assert.equal(first(fixed), 25000);
  const at = first(learned);
  assert.ok(at >= 4000 && at <= 5000, `cut at ${at}`);                                  // at the first pause after the minimum length (quiet from 3.5 s, 0.7 s of it counted)
  assert.ok(learned.threshold() > 0.4 && learned.threshold() < 0.6, String(learned.threshold()));
});

test('the adaptive line stays within its limits and starts from the fixed one until it has learned', () => {
  const c = new PauseCutter({ adaptive: true, speechLevel: 0.3, minSpeech: 0.2, maxSpeech: 0.55 });
  assert.equal(c.threshold(), 0.3);                                                      // nothing learned yet
  for (let i = 0; i < 100; i++) c.push(0.02, i * 100);
  assert.equal(c.threshold(), 0.2);                                                      // a silent room: not lower than the minimum
  const loud = new PauseCutter({ adaptive: true });
  for (let i = 0; i < 100; i++) loud.push(0.9, i * 100);
  assert.equal(loud.threshold(), 0.55);                                                  // a roaring room: not higher than the maximum
});
