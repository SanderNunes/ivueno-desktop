/**
 * Decides where to cut the recording into pieces: at a pause between sentences, never in the middle of a word.
 * A piece is cut when it is at least `minMs` long and the person has been quiet for `pauseMs` after speaking, or when it reaches `maxMs`.
 * `level` is the 0..1 loudness the meter measures (-60 dB = 0, 0 dB = 1).
 *
 * What counts as "speaking" adapts to the recording: with `adaptive` the line is the room's noise floor (the quieter 15% of the last minute) plus a margin,
 * kept between `minSpeech` and `maxSpeech`. A fixed line (0.3, about -42 dB) is fine in a quiet room but a noisy one (a call recorded next to a speaker,
 * where even the pauses sit at -40 dB) never goes below it, so no pause was ever found and every piece was cut mid-word at the maximum. Pure, so it can be tested.
 */
export class PauseCutter {
  constructor({ minMs = 4000, pauseMs = 700, maxMs = 25000, speechLevel = 0.3, adaptive = false, margin = 0.1, minSpeech = 0.2, maxSpeech = 0.55, memory = 600 } = {}) {
    Object.assign(this, { minMs, pauseMs, maxMs, speechLevel, adaptive, margin, minSpeech, maxSpeech, memory });
    this.recent = []; this.sinceFloor = 0; this.floor = null;
    this.reset(0);
  }

  /** A new piece starts now. (What was learned about the noise floor is kept.) */
  reset(nowMs) { this.start = nowMs; this.lastSpeech = null; }

  /** The loudness above which a frame counts as speech right now. */
  threshold() {
    if (!this.adaptive || this.floor === null) return this.speechLevel;
    return Math.min(this.maxSpeech, Math.max(this.minSpeech, this.floor + this.margin));
  }

  _learn(level) {
    if (!this.adaptive) return;
    this.recent.push(level); if (this.recent.length > this.memory) this.recent.shift();
    if (this.recent.length >= 30 && ++this.sinceFloor >= 10) {            // re-estimate the floor every second or so
      this.sinceFloor = 0;
      const sorted = [...this.recent].sort((a, b) => a - b);
      this.floor = sorted[Math.floor(0.15 * (sorted.length - 1))];
    }
  }

  /** Feed the current level; true means "cut here". */
  push(level, nowMs) {
    this._learn(level);
    if (level >= this.threshold()) this.lastSpeech = nowMs;
    const length = nowMs - this.start;
    if (length >= this.maxMs) return true;
    return length >= this.minMs && this.lastSpeech !== null && nowMs - this.lastSpeech >= this.pauseMs;
  }
}
