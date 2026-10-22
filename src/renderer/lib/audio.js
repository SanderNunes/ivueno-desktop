import { webmToPcm16 } from './pcm.mjs';
import { PauseCutter } from './cutter.mjs';

// Real audio levels from the microphone and from the computer's own sound (Windows "loopback", taken through the
// screen-capture API with the picture thrown away; the main process allows it for our own pages only).
// Levels always. Pieces of AUDIO leave this file only when the engine needs them (the cloud engine): then each source is cut
// into pieces of 8 to 25 seconds (cut at a pause), silent pieces are dropped, and every piece goes to the main process, which sends it on and keeps nothing.
// Separately, when the audio of the meeting is kept on this computer, each source is also recorded as long blocks (8 to 10 minutes) for the accurate pass afterwards.

const listeners = new Set();
export const audioBus = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(levels) { for (const fn of listeners) fn(levels); },
};

export async function listMics() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Microfone' }));
  } catch { return []; }
}

// Root-mean-square of the signal, mapped from -60 dB..0 dB onto 0..1 (what a level meter shows).
function levelOf(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  if (rms < 1e-5) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

/** Cuts one stream into self-contained pieces (a new recorder per piece, so each file opens on its own). */
function chunker(stream, source, { chunkMs, peaks, current, onChunk, format = 'webm', pauseCut = true }) {
  const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm';
  let stopped = false; let rec = null; let timer = null; let watch = null; let pending = Promise.resolve();
  // cut at a pause between sentences (at least 4 s in, after 0.7 s of quiet); chunkMs is the longest a piece may get
  const cutter = pauseCut ? new PauseCutter({ minMs: 8000, maxMs: chunkMs, adaptive: true }) : null;       // longer pieces: Whisper needs the sentence around a word to get it right
  const cycle = () => {
    if (stopped) return;
    const parts = []; const t0 = performance.now(); peaks[source] = 0;
    rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    const mine = rec;
    if (cutter) {
      cutter.reset(performance.now());
      clearInterval(watch);
      watch = setInterval(() => { if (mine.state === 'recording' && cutter.push(current[source], performance.now())) mine.stop(); }, 100);
    }
    mine.onstop = () => {
      clearInterval(watch);
      const seconds = (performance.now() - t0) / 1000;
      const loud = peaks[source] > 0.04;                            // silence is not worth sending (or paying for)
      if (parts.length && loud && seconds > 0.6) {
        pending = pending.then(async () => {
          const raw = await new Blob(parts, { type: 'audio/webm' }).arrayBuffer();
          if (format === 'pcm16') onChunk({ source, mime: 'audio/pcm16;rate=16000', seconds, data: await webmToPcm16(raw) });
          else onChunk({ source, mime: 'audio/webm', seconds, data: raw });
        }).catch(() => {});
      }
      if (!stopped) cycle();
    };
    mine.start();
    timer = setTimeout(() => { if (mine.state === 'recording') mine.stop(); }, chunkMs);
  };
  cycle();
  return {
    /** End the current piece now (it is sent) and start a fresh one. Resolves when everything is handed over. */
    async flush() { clearTimeout(timer); if (rec && rec.state === 'recording') rec.stop(); await new Promise((r2) => setTimeout(r2, 50)); await pending; },
    async stop() { stopped = true; clearTimeout(timer); if (rec && rec.state === 'recording') rec.stop(); await new Promise((r2) => setTimeout(r2, 50)); await pending; },
  };
}

/**
 * The whole meeting kept as long blocks (about 8 to 10 minutes, cut at a pause when there is one), each a file that opens on its own, handed to `onBlock` with where it
 * starts in the meeting. Independent of the short live pieces above. A computer-sound block with nothing in it is not kept (a silent track is not worth the disk).
 */
function archiver(stream, source, { t0, offsetMs, peaks, current, onBlock }) {
  const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm';
  let stopped = false; let rec = null; let watch = null; let pending = Promise.resolve();
  const cutter = new PauseCutter({ minMs: 8 * 60 * 1000, maxMs: 10 * 60 * 1000, adaptive: true });
  const cycle = () => {
    if (stopped) return;
    const parts = []; const startedAt = performance.now(); peaks[source] = 0;
    rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    const mine = rec;
    cutter.reset(startedAt);
    clearInterval(watch);
    watch = setInterval(() => { if (mine.state === 'recording' && cutter.push(current[source], performance.now())) mine.stop(); }, 100);
    mine.onstop = () => {
      clearInterval(watch);
      const seconds = (performance.now() - startedAt) / 1000;
      const worth = source === 'mic' || peaks[source] > 0.04;
      if (parts.length && seconds > 1 && worth) {
        const startMs = Math.max(0, Math.round(offsetMs + (startedAt - t0)));
        pending = pending.then(async () => onBlock({ source, startMs, seconds, data: await new Blob(parts, { type: 'audio/webm' }).arrayBuffer() })).catch(() => {});
      }
      if (!stopped) cycle();
    };
    mine.start();
  };
  cycle();
  return {
    async flush() { if (rec && rec.state === 'recording') rec.stop(); await new Promise((r2) => setTimeout(r2, 50)); await pending; },
    async stop() { stopped = true; clearInterval(watch); if (rec && rec.state === 'recording') rec.stop(); await new Promise((r2) => setTimeout(r2, 50)); await pending; },
  };
}

/**
 * Start measuring. Returns { stop, flush, errors } where errors lists 'mic' and/or 'system' when that source is missing.
 * onLevels({mic, sys}) is called every 100 ms. With onChunk, pieces of audio are produced too: onChunk({source, mime, seconds, data}).
 */
export async function startMeter({ micId = '', captureSystem = true, onLevels, onChunk = null, format = 'webm', chunkMs = 25000, pauseCut = true, onBlock = null, offsetMs = 0, expectSystem = false, onWarn = null }) {
  const ctx = new AudioContext();
  const t0 = performance.now();
  const streams = [];
  const errors = [];
  const make = (stream) => {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    return { analyser, buf: new Float32Array(analyser.fftSize) };
  };

  let mic = null; let sys = null; let micStream = null; let sysStream = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true, video: false });
    streams.push(stream); micStream = stream; mic = make(stream);
  } catch { errors.push('mic'); }

  if (captureSystem) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());          // we only want the sound
      if (stream.getAudioTracks().length) { streams.push(stream); sysStream = new MediaStream(stream.getAudioTracks()); sys = make(sysStream); } else errors.push('system');
    } catch { errors.push('system'); }
  }

  const peaks = { mic: 0, system: 0 };
  const kept = { mic: 0, system: 0 };                      // the loudest moment of the block being kept (the live pieces reset `peaks` more often)
  const current = { mic: 0, system: 0 };                   // the level right now, for finding the pauses
  let micHeard = false; let sysHeard = false; let warned = false;
  const timer = setInterval(() => {
    const levels = { mic: mic ? levelOf(mic.analyser, mic.buf) : 0, sys: sys ? levelOf(sys.analyser, sys.buf) : 0 };
    peaks.mic = Math.max(peaks.mic, levels.mic); peaks.system = Math.max(peaks.system, levels.sys);
    kept.mic = Math.max(kept.mic, levels.mic); kept.system = Math.max(kept.system, levels.sys);
    current.mic = levels.mic; current.system = levels.sys;
    onLevels(levels);
    // A call where the computer's sound never makes a sound while the person talks: the other people are probably not being heard (wrong output device).
    if (expectSystem && onWarn && sys && !warned) {
      if (levels.mic > 0.1) micHeard = true;
      if (levels.sys > 0.04) sysHeard = true;
      if (micHeard && !sysHeard && performance.now() - t0 > 60000) { warned = true; onWarn('system_silent'); }
    }
  }, 100);

  const cutters = [];
  if (onChunk) {
    if (micStream) cutters.push(chunker(micStream, 'mic', { chunkMs, peaks, current, onChunk, format, pauseCut }));
    if (sysStream) cutters.push(chunker(sysStream, 'system', { chunkMs, peaks, current, onChunk, format, pauseCut }));
  }
  if (onBlock) {
    if (micStream) cutters.push(archiver(micStream, 'mic', { t0, offsetMs, peaks: kept, current, onBlock }));
    if (sysStream) cutters.push(archiver(sysStream, 'system', { t0, offsetMs, peaks: kept, current, onBlock }));
  }

  return {
    errors,
    flush() { return Promise.all(cutters.map((c) => c.flush())); },
    async stop() {
      clearInterval(timer);
      await Promise.all(cutters.map((c) => c.stop()));            // the last piece is handed over before the sound is switched off
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      ctx.close().catch(() => {});
    },
  };
}
