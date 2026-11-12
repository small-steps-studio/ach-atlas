'use strict';
// Draws media/icon.png (128 x 128): a rounded navy tile with fixed-width record rows, the last one
// highlighted as a control row, and a column ruler on the right. Drawn with 4x4 supersampling and
// written as a PNG with only IHDR, IDAT and IEND chunks.
//   node scripts/make-icon.js [output.png]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 128;
const SS = 4;

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, function (_, n) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

const BG = hex('#16324f');
const ROW = hex('#cfe0f2');
const ROW_DIM = hex('#7f9fbf');
const ACCENT = hex('#3fbf8f');
const RULER = hex('#f2b134');
const MARK = hex('#16324f');

// Each row: [y, segments as [x0, x1, colour]] to suggest fields of different widths.
const ROWS = [
  [26, [[22, 30, ROW_DIM], [34, 62, ROW], [66, 90, ROW]]],
  [44, [[22, 30, ROW_DIM], [34, 50, ROW], [54, 84, ROW], [88, 94, ROW]]],
  [62, [[22, 30, ROW_DIM], [34, 58, ROW], [62, 78, ROW], [82, 94, ROW]]],
  [80, [[22, 30, ROW_DIM], [34, 46, ROW], [50, 72, ROW], [76, 94, ROW]]],
  [98, [[22, 30, ACCENT], [34, 94, ACCENT]]]
];

function shade(x, y) {
  if (!inRoundRect(x, y, 4, 4, 124, 124, 22)) return null;
  // Column ruler: dashed vertical line at the record end.
  if (x >= 101 && x <= 105 && y >= 20 && y <= 110 && Math.floor((y - 20) / 7) % 2 === 0) return RULER;
  for (const row of ROWS) {
    const y0 = row[0];
    if (y < y0 || y > y0 + 9) continue;
    for (const seg of row[1]) {
      if (inRoundRect(x, y, seg[0], y0, seg[1], y0 + 9, 3)) {
        // A small check mark on the control row.
        if (seg[2] === ACCENT && seg[0] === 34) {
          const onMark = (Math.abs((x - 80) - (y - (y0 + 6))) <= 1.1 && x >= 78 && x <= 81) || (Math.abs((x - 81) + (y - (y0 + 7))) <= 1.1 && x >= 81 && x <= 87);
          if (onMark) return MARK;
        }
        return seg[2];
      }
    }
  }
  return BG;
}

function render() {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    row[0] = 0;
    for (let x = 0; x < SIZE; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const o = 1 + x * 4;
      if (a) { row[o] = Math.round(r / a); row[o + 1] = Math.round(g / a); row[o + 2] = Math.round(b / a); }
      row[o + 3] = Math.round(255 * a / (SS * SS));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'media', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render());
  process.stdout.write('icon written: ' + out + '\n');
}

module.exports = { render: render };
