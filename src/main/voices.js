const path = require('path');
const { Worker } = require('worker_threads');

/**
 * Telling the voices of a recording apart ("Orador 1, Orador 2…"). The words come from the speech service, which also says where each
 * line starts and ends; this module then listens again, on this computer, to short windows of those lines with a small voice model
 * (NVIDIA TitaNet small, 40 MB, one file), and groups the windows that sound alike. It does not need to find where speech is: the
 * transcript already says. In tests with five known voices it was right 100% of the time, clean or noisy, when the number of voices
 * was right; the threshold below found the right number on both.
 *
 * The heavy part runs in a worker thread (voices-worker.js) so the app never freezes. Only the audio's 16 kHz samples and the line
 * times are used; no text and nothing else leaves the function.
 */
const VOICE_MODEL = {
  name: 'nemo_en_titanet_small.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx',
  sizeBytes: 40257283,
  sha256: 'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e',   // pinned: the file as downloaded from that release over https
};
const WINDOW = 1.5;                   // seconds of voice per sample
const THRESHOLD = 0.78;               // how different two groups of windows must be to stay apart (cosine distance, average linkage)
const MAX_WINDOWS = 4000;             // keeps a very long recording affordable

/** Windows (start seconds) that lie mostly inside lines of speech. A longer recording uses a wider hop so the count stays bounded. */
function speechWindows(segments, totalSec, { window = WINDOW, minCover = 0.75, maxWindows = MAX_WINDOWS } = {}) {
  const segs = segments.map((s) => [s.startMs / 1000, s.endMs / 1000]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const speech = segs.reduce((n, [a, b]) => n + (b - a), 0);
  const hop = Math.max(0.75, speech / maxWindows);
  const out = [];
  let from = 0;
  for (let t = 0; t + window <= totalSec + 1e-9; t += hop) {
    while (from < segs.length && segs[from][1] <= t) from++;
    let cover = 0;
    for (let i = from; i < segs.length && segs[i][0] < t + window; i++) cover += Math.max(0, Math.min(segs[i][1], t + window) - Math.max(segs[i][0], t));
    if (cover >= minCover * window) out.push(t);
  }
  return out;
}

function normalise(e) {
  let n = 0; for (let i = 0; i < e.length; i++) n += e[i] * e[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(e.length); for (let i = 0; i < e.length; i++) out[i] = e[i] / n;
  return out;
}

/**
 * Average-linkage agglomerative clustering on cosine distance (nearest-neighbour chain: O(n²), fine for a few thousand windows).
 * Returns { merges: [{a, b, dist}] } where a and b are leaf indexes of the two groups joined, in the order found.
 */
function dendrogram(embs) {
  const n = embs.length;
  const E = embs.map(normalise);
  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { let d = 0; const a = E[i]; const b = E[j]; for (let k = 0; k < a.length; k++) d += a[k] * b[k]; D[i * n + j] = D[j * n + i] = 1 - d; }
  const size = new Float64Array(n).fill(1); const alive = new Uint8Array(n).fill(1);
  const merges = []; const chain = []; let left = n;
  while (left > 1) {
    if (!chain.length) chain.push(alive.indexOf(1));
    for (;;) {
      const a = chain[chain.length - 1]; const prev = chain.length > 1 ? chain[chain.length - 2] : -1;
      let b = prev; let best = prev >= 0 ? D[a * n + prev] : Infinity;
      for (let j = 0; j < n; j++) if (alive[j] && j !== a && D[a * n + j] < best) { best = D[a * n + j]; b = j; }
      if (b === prev) {                                                   // a and b are each other's nearest: join them
        chain.pop(); chain.pop();
        merges.push({ a, b, dist: best });
        const sa = size[a]; const sb = size[b];
        for (let k = 0; k < n; k++) if (alive[k] && k !== a && k !== b) { const d = (sa * D[a * n + k] + sb * D[b * n + k]) / (sa + sb); D[a * n + k] = D[k * n + a] = d; }
        size[a] = sa + sb; alive[b] = 0; left--;
        break;
      }
      chain.push(b);
    }
  }
  return { merges };
}

/** Cut the dendrogram: by distance (threshold) or into exactly k groups. Returns a group number per window. */
function cut(n, merges, { threshold, k }) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const ordered = [...merges].sort((x, y) => x.dist - y.dist);                    // average linkage never merges "backwards", so sorted order is a valid order
  const take = k !== undefined ? Math.max(0, n - k) : ordered.filter((m) => m.dist <= threshold).length;
  for (let i = 0; i < take; i++) parent[find(ordered[i].a)] = find(ordered[i].b);
  const ids = new Map(); return Array.from({ length: n }, (_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); });
}

/** Groups too small to be a person (a cough, a few odd windows) join the group they sound most like. */
function mergeSmall(labels, embs, { minShare = 0.01, minWindows = 4 } = {}) {
  const n = labels.length; const count = new Map();
  for (const l of labels) count.set(l, (count.get(l) || 0) + 1);
  const big = [...count].filter(([, c]) => c >= Math.max(minWindows, minShare * n)).map(([l]) => l);
  if (!big.length || big.length === count.size) return labels;
  const dim = embs[0].length; const centre = new Map();
  for (const l of big) centre.set(l, new Float32Array(dim));
  labels.forEach((l, i) => { if (centre.has(l)) { const e = normalise(embs[i]); const c = centre.get(l); for (let k = 0; k < dim; k++) c[k] += e[k]; } });
  const cn = new Map([...centre].map(([l, c]) => [l, normalise(c)]));
  return labels.map((l, i) => {
    if (cn.has(l)) return l;
    const e = normalise(embs[i]); let bestL = big[0]; let best = -Infinity;
    for (const [bl, c] of cn) { let d = 0; for (let k = 0; k < dim; k++) d += e[k] * c[k]; if (d > best) { best = d; bestL = bl; } }
    return bestL;
  });
}

/** Number the groups by how much they speak (0 = the most), so "Orador 1" is the main voice. */
function renumber(labels) {
  const c = new Map(); for (const l of labels) c.set(l, (c.get(l) || 0) + 1);
  const order = [...c].sort((a, b) => b[1] - a[1]).map(([l]) => l); const map = new Map(order.map((l, i) => [l, i]));
  return labels.map((l) => map.get(l));
}

/** Each line goes to the voice most of its windows belong to; a line too short to hold a window takes the voice of its nearest neighbour in time. */
function assignSegments(segments, starts, labels, window = WINDOW) {
  const out = segments.map((s) => {
    const a = s.startMs / 1000; const b = s.endMs / 1000; const tally = new Map(); let any = false;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] >= b) break;
      const o = Math.min(b, starts[i] + window) - Math.max(a, starts[i]);
      if (o > 0) { tally.set(labels[i], (tally.get(labels[i]) || 0) + o); any = true; }
    }
    return any ? [...tally].sort((x, y) => y[1] - x[1])[0][0] : null;
  });
  const known = out.map((v, i) => (v === null ? null : i)).filter((i) => i !== null);
  return out.map((v, i) => {
    if (v !== null) return v;
    if (!known.length) return 0;
    let best = known[0]; let gap = Infinity;
    for (const j of known) { const g = Math.abs(((segments[j].startMs + segments[j].endMs) - (segments[i].startMs + segments[i].endMs)) / 2); if (g < gap) { gap = g; best = j; } }
    return out[best];
  });
}

/**
 * The whole job, given a way to turn a stretch of audio into a voice fingerprint.
 *   segments: [{startMs, endMs}] the lines (in order)    embed(fromSec, toSec) -> Float32Array
 *   voices:   how many people there are, if the person said so (otherwise found automatically)
 * Returns { voices, assignments: [0-based voice per line], shares: [share of speech per voice] }.
 */
function identifyVoices({ segments, totalSec, embed, voices = 0, threshold = THRESHOLD, onProgress = () => {} }) {
  const starts = speechWindows(segments, totalSec);
  if (starts.length < 2) return { voices: 1, assignments: segments.map(() => 0), shares: [1] };
  const embs = starts.map((t, i) => { const e = embed(t, t + WINDOW); if (i % 50 === 0) onProgress(0.9 * i / starts.length); return e; });
  onProgress(0.92);
  const { merges } = dendrogram(embs);
  let labels = cut(embs.length, merges, voices > 0 ? { k: Math.min(voices, embs.length) } : { threshold });
  if (!(voices > 0)) labels = mergeSmall(labels, embs);
  labels = renumber(labels);
  const assignments = assignSegments(segments, starts, labels);
  const count = Math.max(...labels) + 1; const talk = new Array(count).fill(0);
  segments.forEach((s, i) => { talk[assignments[i]] += s.endMs - s.startMs; });
  const total = talk.reduce((a, b) => a + b, 0) || 1;
  onProgress(1);
  return { voices: count, assignments, shares: talk.map((t) => Math.round(1000 * t / total) / 1000) };
}

/** Run the job in a worker thread on a raw 16 kHz mono PCM16 file. Resolves with identifyVoices' answer; reject on any failure. */
function identify({ pcmPath, modelPath, segments, totalSec, voices = 0, threshold = THRESHOLD }, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'voices-worker.js'), { workerData: { pcmPath, modelPath, segments, totalSec, voices, threshold } });
    let settled = false;
    const end = (fn, v) => { if (!settled) { settled = true; worker.terminate(); fn(v); } };
    worker.on('message', (m) => { if (m.type === 'progress') onProgress(m.value); else if (m.type === 'done') end(resolve, m.result); else if (m.type === 'error') end(reject, Object.assign(new Error(m.message), { code: 'voices_failed' })); });
    worker.on('error', (e) => end(reject, Object.assign(new Error(e.message), { code: 'voices_failed' })));
    worker.on('exit', (code) => { if (!settled) end(reject, Object.assign(new Error(`voice worker stopped (${code})`), { code: 'voices_failed' })); });
  });
}

module.exports = { VOICE_MODEL, WINDOW, THRESHOLD, speechWindows, dendrogram, cut, mergeSmall, renumber, assignSegments, identifyVoices, identify };
