/* Generates the PWA icons (no dependencies: hand-rolled PNG encoder). */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; /* filter: none */
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   /* bit depth */
  ihdr[9] = 6;   /* colour type RGBA */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- artwork ---------- */
const BARS = [0.26, 0.44, 0.62, 0.82, 0.92, 0.74, 0.58, 0.42, 0.30, 0.21, 0.15];

function make(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? Math.round(size * 0.13) : 0;
  const inner = size - pad * 2;
  const radius = maskable ? 0 : size * 0.2;
  const n = BARS.length;
  const barW = inner / n;

  const inRound = (x, y) => {
    if (radius <= 0) return true;
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 8, g = 8, b = 10, a = 255;

      if (!inRound(x, y)) {
        a = 0; r = g = b = 0;
      } else {
        /* faint grid floor */
        if (y > size - pad - Math.round(size * 0.02) && y < size - pad) { r = 26; g = 26; b = 30; }

        const bx = (x - pad) / barW;
        const i = Math.floor(bx);
        if (i >= 0 && i < n) {
          const frac = bx - i;
          if (frac > 0.14 && frac < 0.88) {
            const h = BARS[i] * inner;
            const top = size - pad - h;
            if (y >= top && y < size - pad) { r = 18; g = 179; b = 18; }
            else if (y >= top - Math.max(1, size * 0.008) && y < top) { r = 90; g = 235; b = 90; }
          }
        }
      }

      const o = (y * size + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
    }
  }
  return encodePNG(size, size, px);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-512-maskable.png', 512, true]
];

for (const [name, size, maskable] of jobs) {
  const buf = make(size, maskable);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log('wrote', name, buf.length, 'bytes');
}
