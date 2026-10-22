// Runs voices.identifyVoices off the main thread: reads the raw PCM16 file, fingerprints windows with the voice model, clusters.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { identifyVoices } = require('./voices');

try {
  const sherpa = require('sherpa-onnx-node');
  const raw = fs.readFileSync(workerData.pcmPath);
  const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 2)));
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: workerData.modelPath, numThreads: 2, debug: 0, provider: 'cpu' });
  const embed = (from, to) => {
    const stream = extractor.createStream();
    stream.acceptWaveform({ samples: Float32Array.from(pcm.subarray(Math.floor(from * 16000), Math.floor(to * 16000)), (v) => v / 32768), sampleRate: 16000 });
    stream.inputFinished();
    return extractor.compute(stream, false);       // false: copy the result. Electron does not allow the library's shared (external) buffers, plain Node does
  };
  const result = identifyVoices({
    segments: workerData.segments, totalSec: Math.min(workerData.totalSec, pcm.length / 16000), embed, voices: workerData.voices, threshold: workerData.threshold,
    onProgress: (value) => parentPort.postMessage({ type: 'progress', value }),
  });
  parentPort.postMessage({ type: 'done', result });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: String(e && e.message || e) });
}
