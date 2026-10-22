// Telling voices apart: the clustering and assignment logic with synthetic fingerprints of known speakers (no model needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/main/voices');

/** A fingerprint near one of a few fixed directions: speaker k, with a little noise. */
function print(k, seed, noise = 0.15, dim = 16) {
  let s = seed * 9301 + 49297; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  return Float32Array.from({ length: dim }, (_, i) => (i % 4 === k ? 1 : 0) + noise * rnd());
}
const seg = (a, b) => ({ startMs: a * 1000, endMs: b * 1000 });

test('windows lie inside speech, and a long recording gets a wider hop so the count stays bounded', () => {
  const w = V.speechWindows([seg(0, 6), seg(20, 24)], 30);
  assert.ok(w.every((t) => (t >= 0 && t + 1.5 <= 6.0001) || (t >= 20 && t + 1.5 <= 24.0001)), JSON.stringify(w));
  assert.ok(w.length >= 6 && w.length <= 12);
  assert.deepEqual(V.speechWindows([seg(0, 1)], 30), []);                                  // too short for one window
  const long = Array.from({ length: 600 }, (_, i) => seg(i * 20, i * 20 + 18));           // 3 hours of talk
  assert.ok(V.speechWindows(long, 12000).length <= 4100);
});

test('three speakers are found by distance, and told the number the groups are exactly that many', () => {
  const embs = []; const truth = [];
  for (let i = 0; i < 60; i++) { const k = i % 3; embs.push(print(k, i)); truth.push(k); }
  const { merges } = V.dendrogram(embs);
  assert.equal(merges.length, 59);
  const auto = V.cut(60, merges, { threshold: 0.5 });
  assert.equal(new Set(auto).size, 3);
  for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) assert.equal(auto[i] === auto[j], truth[i] === truth[j]);
  assert.equal(new Set(V.cut(60, merges, { k: 2 })).size, 2);
  assert.equal(new Set(V.cut(60, merges, { k: 1 })).size, 1);
  assert.equal(new Set(V.cut(60, merges, { k: 99 })).size, 60);
  assert.equal(new Set(V.cut(60, merges, { threshold: 0 })).size, 60);                     // nothing is that close
  assert.equal(new Set(V.cut(60, merges, { threshold: 2 })).size, 1);
});

test('a group too small to be a person joins the voice it sounds most like', () => {
  const embs = []; const labels = [];
  for (let i = 0; i < 40; i++) { embs.push(print(i % 2, i)); labels.push(i % 2); }
  embs.push(print(1, 100, 0.3), print(1, 101, 0.3), print(1, 102, 0.3)); labels.push(2, 2, 2);          // three stray windows that sound like voice 1
  const merged = V.mergeSmall(labels, embs);
  assert.deepEqual(new Set(merged), new Set([0, 1]));
  assert.deepEqual(merged.slice(-3), [1, 1, 1]);
  assert.deepEqual(V.mergeSmall([0, 0, 1, 1], [print(0, 1), print(0, 2), print(1, 3), print(1, 4)]), [0, 0, 1, 1]);   // nothing small: unchanged
});

test('voices are numbered by how much they speak', () => {
  assert.deepEqual(V.renumber([5, 5, 7, 7, 7, 2]), [1, 1, 0, 0, 0, 2]);
});

test('each line goes to the voice most of its windows belong to; a short line follows its nearest neighbour', () => {
  const segments = [seg(0, 6), seg(6.2, 6.9), seg(8, 14)];
  const starts = [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 8, 8.75, 9.5, 10.25, 11, 11.75, 12.5];
  const labels = starts.map((t) => (t < 7 ? 0 : 1));
  assert.deepEqual(V.assignSegments(segments, starts, labels), [0, 0, 1]);                 // the 0.7 s line has no window: nearest in time is voice 0
  assert.deepEqual(V.assignSegments([seg(0, 1)], [], []), [0]);
});

test('end to end with a stand-in fingerprint: lines are given to the right speakers in order, main voice first', () => {
  const turns = [[0, 10, 1], [10, 16, 0], [16, 30, 1], [30, 38, 2], [38, 50, 1], [50, 56, 0]];
  const who = (t) => (turns.find(([a, b]) => t >= a && t < b) || [0, 0, 0])[2];
  const segments = []; for (const [a, b] of turns) for (let t = a; t + 3 <= b; t += 3.2) segments.push(seg(t, t + 3));
  const seen = []; const out = V.identifyVoices({ segments, totalSec: 56, embed: (a) => print(who(a + 0.75), Math.floor(a * 10)), onProgress: (v) => seen.push(v) });
  assert.equal(out.voices, 3);
  const speaker = segments.map((s) => who(s.startMs / 1000 + 1));
  for (let i = 0; i < segments.length; i++) for (let j = 0; j < segments.length; j++) assert.equal(out.assignments[i] === out.assignments[j], speaker[i] === speaker[j], `${i},${j}`);
  assert.equal(out.assignments[0], 0);                                                      // the voice that talks most is number 0
  assert.ok(Math.abs(out.shares.reduce((a, b) => a + b, 0) - 1) < 0.01 && out.shares[0] > out.shares[1] && out.shares[1] >= out.shares[2]);
  assert.equal(seen.at(-1), 1); assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]));
  const two = V.identifyVoices({ segments, totalSec: 56, embed: (a) => print(who(a + 0.75), Math.floor(a * 10)), voices: 2 });
  assert.equal(two.voices, 2);                                                              // told two people: two groups
});

test('too little speech to compare is one voice', () => {
  const out = V.identifyVoices({ segments: [seg(0, 1.2)], totalSec: 5, embed: () => { throw new Error('should not be asked'); } });
  assert.deepEqual(out, { voices: 1, assignments: [0], shares: [1] });
});

test('the worker reports a failure as an error with a code instead of hanging or crashing the app', async () => {
  await assert.rejects(() => V.identify({ pcmPath: 'C:\\no\\such\\file.raw', modelPath: 'C:\\no\\such\\model.onnx', segments: [seg(0, 5), seg(5, 10)], totalSec: 10 }), (e) => e.code === 'voices_failed');
});
