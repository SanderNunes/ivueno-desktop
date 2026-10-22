/** Mix decoded channels down to one and write 16-bit samples (what the local speech engine takes). Pure, so it can be tested. */
export function mixToPcm16(channels) {
  const n = channels.length ? channels[0].length : 0;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][i];
    s /= channels.length;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }
  return out;
}

/** Recorded piece (webm/opus) -> 16 kHz mono 16-bit samples. The browser decodes and resamples it for us. */
export async function webmToPcm16(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  return mixToPcm16(channels).buffer;
}

/** 16-bit mono samples -> the bytes of a WAV file (what the speech service reads for a piece of an imported recording). */
export function pcm16ToWavBytes(samples, rate = 16000) {
  const data = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const out = new Uint8Array(44 + data.length); const v = new DataView(out.buffer);
  const tag = (at, s) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); tag(8, 'WAVE'); tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out.buffer;
}
