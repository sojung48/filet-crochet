/**
 * icon.svg 와 같은 그림을 180x180 PNG로 그린다.
 * iOS Safari의 apple-touch-icon은 SVG를 못 읽으므로 PNG가 따로 필요하다.
 * 외부 라이브러리 없이 픽셀을 직접 채우고 zlib으로 PNG를 만든다.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const S = 180;            // 아이콘 한 변
const K = S / 64;         // icon.svg의 64 단위 좌표 → 픽셀 배율

const px = new Uint8Array(S * S * 4);

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function fill(x0, y0, x1, y1, hex) {
  const [r, g, b] = rgb(hex);
  const ax = Math.round(x0 * K), ay = Math.round(y0 * K);
  const bx = Math.round(x1 * K), by = Math.round(y1 * K);
  for (let y = Math.max(0, ay); y < Math.min(S, by); y++) {
    for (let x = Math.max(0, ax); x < Math.min(S, bx); x++) {
      const i = (y * S + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
}

// 홈 화면 아이콘은 iOS가 알아서 모서리를 둥글게 깎으므로 배경은 꽉 채운다
fill(0, 0, 64, 64, '#f6f5f2');

// 안내선 (가로/세로 12단위)
const LINE = 1.5;
for (const y of [20, 32, 44]) fill(8, y - LINE / 2, 56, y + LINE / 2, '#b4ada0');
for (const x of [20, 32, 44]) fill(x - LINE / 2, 8, x + LINE / 2, 56, '#b4ada0');

// 채운 칸
for (const [x, y] of [[20, 20], [32, 32], [8, 32], [44, 20]]) {
  fill(x, y, x + 12, y + 12, '#2f2a24');
}

// 바깥 테두리
const W = 2.5;
fill(8, 8, 56, 8 + W, '#7b5e3b');
fill(8, 56 - W, 56, 56, '#7b5e3b');
fill(8, 8, 8 + W, 56, '#7b5e3b');
fill(56 - W, 8, 56, 56, '#7b5e3b');

// ---- PNG 인코딩 ----

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;            // 필터 없음
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;      // bit depth
ihdr[9] = 6;      // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2];
writeFileSync(out, png);
console.log(out, png.length, 'bytes', createHash('sha256').update(png).digest('hex').slice(0, 8));
