// Генерация PNG-иконок PWA без зависимостей (zlib + ручной PNG-кодер)
// node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const GREEN = [0x00, 0xa8, 0x84, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

const png = (size, px) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px[y].forEach((p, x) => Buffer.from(p).copy(raw, y * (size * 4 + 1) + 1 + x * 4));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
// белый пузырь: круг + треугольный хвостик
const inTail = (x, y, s) => x >= 0.22 * s && x <= 0.42 * s && y >= 0.66 * s && y <= 0.8 * s && y - 0.66 * s >= (0.42 * s - x) * 0.9;
const inRoundedRect = (x, y, s, r) => {
  const rx = Math.min(Math.max(x, r), s - r);
  const ry = Math.min(Math.max(y, r), s - r);
  return (x - rx) ** 2 + (y - ry) ** 2 <= r * r;
};

function icon(size, { rounded = true } = {}) {
  const px = [];
  const r = 0.22 * size;
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      if (rounded && !inRoundedRect(x + 0.5, y + 0.5, size, r)) {
        row.push([0, 0, 0, 0]);
        continue;
      }
      const bubble =
        inCircle(x, y, 0.5 * size, 0.45 * size, 0.3 * size) || inTail(x, y, size);
      if (bubble) {
        // три зелёных 'печатающихся' точки внутри пузыря
        const dots = [0.38, 0.5, 0.62].some((cx) =>
          inCircle(x, y, cx * size, 0.45 * size, 0.05 * size),
        );
        row.push(dots ? GREEN : WHITE);
      } else {
        row.push(GREEN);
      }
    }
    px.push(row);
  }
  return png(size, px);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192));
writeFileSync('public/icons/icon-512.png', icon(512));
writeFileSync('public/icons/icon-512-maskable.png', icon(512, { rounded: false }));
writeFileSync('public/icons/apple-touch-icon.png', icon(180));
console.log('icons generated');
