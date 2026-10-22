const zlib = require('zlib');
const { crc32 } = require('./zip');

// The Ivuenu mark drawn in code (a rounded square with three note lines, the shortest at the bottom) so the app needs
// no image files. Coordinates are on the 28-unit grid used by the design. `recording` adds the red dot.

const GREEN = [0x1e, 0x6a, 0x58];
const GREEN_DARK = [0x63, 0xc3, 0xa6];
const INK = [0xff, 0xfe, 0xfc];
const INK_DARK = [0x0d, 0x1f, 0x1a];
const RED = [0xd9, 0x2d, 0x20];

function inRoundRect(x, y, w, h, r) {
  const dx = Math.max(r - x, 0, x - (w - r));
  const dy = Math.max(r - y, 0, y - (h - r));
  return x >= 0 && y >= 0 && x <= w && y <= h && dx * dx + dy * dy <= r * r;
}

function nearSegment(px, py, x1, y1, x2, y2, half) {
  const vx = x2 - x1; const vy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / (vx * vx + vy * vy)));
  const cx = x1 + t * vx; const cy = y1 + t * vy;
  return (px - cx) ** 2 + (py - cy) ** 2 <= half * half;
}

function rgba(size, { recording = false, dark = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = dark ? GREEN_DARK : GREEN;
  const fg = dark ? INK_DARK : INK;
  const scale = 28 / size;
  const N = 4;                                   // 4x4 samples per pixel
  const dotR = recording ? 5.2 : 0;
  const dotX = 23.6; const dotY = 23.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0; let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const gx = (x + (sx + 0.5) / N) * scale;
          const gy = (y + (sy + 0.5) / N) * scale;
          let color = null;
          if (recording && (gx - dotX) ** 2 + (gy - dotY) ** 2 <= dotR * dotR) {
            color = (gx - dotX) ** 2 + (gy - dotY) ** 2 <= (dotR - 1.5) ** 2 ? RED : (dark ? [0x24, 0x22, 0x1f] : INK);
          } else if (inRoundRect(gx, gy, 28, 28, 8)) {
            const line = nearSegment(gx, gy, 8, 10, 20, 10, 1.3) || nearSegment(gx, gy, 8, 14, 17, 14, 1.3) || nearSegment(gx, gy, 8, 18, 13, 18, 1.3);
            color = line ? fg : bg;
          }
          if (color) { cover++; r += color[0]; g += color[1]; b += color[2]; }
        }
      }
      const i = (y * size + x) * 4;
      if (cover) { buf[i] = r / cover; buf[i + 1] = g / cover; buf[i + 2] = b / cover; buf[i + 3] = Math.round((255 * cover) / (N * N)); }
    }
  }
  return buf;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @returns {Buffer} a PNG file */
function png(size, options) {
  const raw = rgba(size, options);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { rows[y * (size * 4 + 1)] = 0; raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { png, rgba };
