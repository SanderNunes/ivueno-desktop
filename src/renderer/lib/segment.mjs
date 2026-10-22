import { PauseCutter } from './cutter.mjs';

/** Loudness of one stretch of samples on the same 0..1 scale the live meter uses (-60 dB = 0, 0 dB = 1). */
export function levelOfSamples(samples, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) { const v = samples[i] / 32768; sum += v * v; }
  const rms = Math.sqrt(sum / Math.max(1, to - from));
  if (rms < 1e-5) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

/**
 * Cut a whole recording (16-bit samples) into pieces at the pauses between sentences, the way the live recording does:
 * at least `minMs`, after `pauseMs` of quiet, at most `maxMs`; what counts as quiet adapts to the recording's noise floor (see cutter.mjs).
 * Pieces whose loudest moment is below `audibleLevel` (room hiss, about -51 dB) are left out.
 * Returns [{ startMs, durationMs, from, to }] with sample indexes, in order; together with the silences between them they cover the file.
 */
export function splitAtPauses(samples, rate = 16000, { frameMs = 100, minMs = 4000, pauseMs = 700, maxMs = 25000, speechLevel = 0.3, audibleLevel = 0.15, adaptive = true } = {}) {
  const frame = Math.round(rate * frameMs / 1000);
  const cutter = new PauseCutter({ minMs, pauseMs, maxMs, speechLevel, adaptive });
  const pieces = [];
  let start = 0; let loudest = 0;
  const close = (end) => {
    if (end > start && loudest >= audibleLevel) pieces.push({ startMs: Math.round(start * 1000 / rate), durationMs: Math.round((end - start) * 1000 / rate), from: start, to: end });
    start = end; loudest = 0; cutter.reset(Math.round(end * 1000 / rate));
  };
  cutter.reset(0);
  for (let at = 0; at < samples.length; at += frame) {
    const end = Math.min(samples.length, at + frame);
    const level = levelOfSamples(samples, at, end);
    if (level > loudest) loudest = level;
    if (cutter.push(level, Math.round(end * 1000 / rate))) close(end);
  }
  close(samples.length);
  return pieces;
}

/**
 * Cut a long recording into pieces of at most `maxSec` for uploading, each cut at the quietest second found in the last `searchSec` before the limit
 * (so a word is unlikely to be split). Returns [{ from, to, startMs, durationMs }] covering the whole file with no gaps.
 */
export function splitForUpload(samples, rate = 16000, { maxSec = 600, searchSec = 45 } = {}) {
  const max = Math.round(maxSec * rate); const search = Math.round(searchSec * rate); const sec = rate;
  const pieces = [];
  let from = 0;
  while (samples.length - from > max) {
    let cut = from + max; let quietest = Infinity;
    for (let at = from + max - search; at + sec <= from + max; at += Math.round(sec / 2)) {
      const level = levelOfSamples(samples, at, at + sec);
      if (level < quietest) { quietest = level; cut = at + Math.round(sec / 2); }          // cut in the middle of the quietest second
    }
    pieces.push({ from, to: cut, startMs: Math.round(from * 1000 / rate), durationMs: Math.round((cut - from) * 1000 / rate) });
    from = cut;
  }
  if (samples.length > from) pieces.push({ from, to: samples.length, startMs: Math.round(from * 1000 / rate), durationMs: Math.round((samples.length - from) * 1000 / rate) });
  return pieces;
}
