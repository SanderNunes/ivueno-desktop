import test from 'node:test';
import assert from 'node:assert/strict';
import { mixToPcm16, pcm16ToWavBytes } from '../src/renderer/lib/pcm.mjs';

test('mono samples become 16-bit and are clipped, not wrapped', () => {
  const out = mixToPcm16([Float32Array.from([0, 0.5, -0.5, 1.5, -2])]);
  assert.deepEqual([...out], [0, 16384, -16383, 32767, -32768]);
});

test('stereo is averaged into one channel', () => {
  const out = mixToPcm16([Float32Array.from([1, 0]), Float32Array.from([0, 0])]);
  assert.deepEqual([...out], [16384, 0]);
});

test('no channels, no samples', () => {
  assert.equal(mixToPcm16([]).length, 0);
});

test('samples become a WAV file the speech service can read', () => {
  const wav = new DataView(pcm16ToWavBytes(Int16Array.from([1000, -2000, 32767])));
  const text = (at, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(at + i)));
  assert.equal(wav.byteLength, 50);
  assert.deepEqual([text(0, 4), wav.getUint32(4, true), text(8, 8), text(36, 4), wav.getUint32(40, true)], ['RIFF', 42, 'WAVEfmt ', 'data', 6]);
  assert.deepEqual([wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint32(28, true), wav.getUint16(34, true)], [1, 1, 16000, 32000, 16]);
  assert.deepEqual([wav.getInt16(44, true), wav.getInt16(46, true), wav.getInt16(48, true)], [1000, -2000, 32767]);
  assert.equal(new DataView(pcm16ToWavBytes(new Int16Array(4).subarray(1, 3))).getUint32(40, true), 4);        // a view into a bigger buffer is handled
});
