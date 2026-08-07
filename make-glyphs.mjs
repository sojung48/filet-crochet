/**
 * 갈무리Mono9의 비트맵 글리프를 뽑아 js/glyphs.js로 만든다.
 *
 * 왜 이렇게 하나:
 *
 * 캔버스에 글자를 찍고 픽셀을 읽는 방식은 기기마다 결과가 달랐다.
 * 글자를 그리는 엔진이 PC(DirectWrite)와 폰(CoreText)에서 다르고,
 * 가장자리 흐린 픽셀을 어디서 자르느냐에 따라 칸 하나가 달라진다.
 * 같은 글자를 넣어도 PC와 폰의 도안이 어긋났다.
 *
 * 폰트 파일 안에는 손으로 찍은 진짜 비트맵(EBDT 테이블)이 들어 있다.
 * 그걸 빌드할 때 미리 꺼내 두면 기기와 상관없이 늘 같은 결과가 나온다.
 * 외곽선을 늘려 쓰던 것보다 글자도 작아진다(한글 12칸 → 9칸).
 *
 * 실행:  node make-glyphs.mjs <GalmuriMono9Bitmap.ttf>
 *
 * 폰트를 새 버전으로 바꿀 때만 다시 돌리면 된다. 평소 빌드에는
 * 필요 없다(js/glyphs.js가 이미 저장소에 들어 있다).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const ttfPath = process.argv[2];
if (!ttfPath) {
  console.error('사용법: node make-glyphs.mjs <GalmuriMono9Bitmap-Regular-x.y.z.ttf>');
  console.error('폰트는 https://github.com/quiple/galmuri 릴리스에서 받는다.');
  process.exit(1);
}

const b = readFileSync(ttfPath);

// ---- 테이블 목록 ----
const tables = {};
const numTables = b.readUInt16BE(4);
for (let i = 0; i < numTables; i++) {
  const o = 12 + i * 16;
  tables[b.toString('ascii', o, o + 4)] = {
    offset: b.readUInt32BE(o + 8),
    length: b.readUInt32BE(o + 12),
  };
}
for (const need of ['cmap', 'EBLC', 'EBDT']) {
  if (!tables[need]) {
    console.error(`오류: ${need} 테이블이 없습니다. 비트맵이 든 폰트가 맞습니까?`);
    console.error('파일 이름에 "Bitmap"이 들어간 것을 받아야 합니다.');
    process.exit(1);
  }
}

// ---- cmap: 문자 → 글리프 번호 ----
function buildCmap() {
  const c = tables.cmap.offset;
  const n = b.readUInt16BE(c + 2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const o = c + 4 + i * 8;
    const pid = b.readUInt16BE(o);
    const eid = b.readUInt16BE(o + 2);
    const off = c + b.readUInt32BE(o + 4);
    const fmt = b.readUInt16BE(off);
    if (fmt === 12) return { fmt, off };
    if (fmt === 4 && pid === 3 && eid === 1) best = { fmt, off };
  }
  return best;
}
const cm = buildCmap();

function glyphIdOf(cp) {
  if (cm.fmt === 12) {
    const n = b.readUInt32BE(cm.off + 12);
    let lo = 0, hi = n - 1;
    while (lo <= hi) {                       // 이진 탐색 — 그룹이 수천 개다
      const mid = (lo + hi) >> 1;
      const g = cm.off + 16 + mid * 12;
      const s = b.readUInt32BE(g);
      const e = b.readUInt32BE(g + 4);
      if (cp < s) hi = mid - 1;
      else if (cp > e) lo = mid + 1;
      else return b.readUInt32BE(g + 8) + (cp - s);
    }
    return 0;
  }
  const segX2 = b.readUInt16BE(cm.off + 6);
  const endO = cm.off + 14;
  const startO = endO + segX2 + 2;
  const deltaO = startO + segX2;
  const rangeO = deltaO + segX2;
  for (let i = 0; i < segX2 / 2; i++) {
    if (cp <= b.readUInt16BE(endO + i * 2)) {
      const start = b.readUInt16BE(startO + i * 2);
      if (cp < start) return 0;
      const ro = b.readUInt16BE(rangeO + i * 2);
      if (ro === 0) return (cp + b.readInt16BE(deltaO + i * 2)) & 0xffff;
      const gi = b.readUInt16BE(rangeO + i * 2 + ro + (cp - start) * 2);
      return gi ? (gi + b.readInt16BE(deltaO + i * 2)) & 0xffff : 0;
    }
  }
  return 0;
}

// ---- EBLC: 글리프 번호 → EBDT 위치 ----
const eblc = tables.EBLC.offset;
const st = eblc + 8;                          // 첫 bitmapSizeTable
const idxArrayOff = eblc + b.readUInt32BE(st);
const numIdxSub = b.readUInt32BE(st + 8);
const ppemX = b.readUInt8(st + 44);
const ppemY = b.readUInt8(st + 45);

function locate(gid) {
  for (let i = 0; i < numIdxSub; i++) {
    const a = idxArrayOff + i * 8;
    const first = b.readUInt16BE(a);
    const last = b.readUInt16BE(a + 2);
    if (gid < first || gid > last) continue;
    const sub = idxArrayOff + b.readUInt32BE(a + 4);
    const fmt = b.readUInt16BE(sub);
    const imgFmt = b.readUInt16BE(sub + 2);
    const imgOff = b.readUInt32BE(sub + 4);
    if (fmt === 1) {
      const o1 = b.readUInt32BE(sub + 8 + (gid - first) * 4);
      const o2 = b.readUInt32BE(sub + 8 + (gid - first + 1) * 4);
      return { off: tables.EBDT.offset + imgOff + o1, size: o2 - o1, imgFmt };
    }
    if (fmt === 2) {
      // 크기가 같은 글리프들을 한 덩어리로 담는다. 이때 글리프 치수는
      // EBDT가 아니라 여기(bigGlyphMetrics)에 한 번만 적혀 있다.
      const size = b.readUInt32BE(sub + 8);
      const m = sub + 12;
      return {
        off: tables.EBDT.offset + imgOff + (gid - first) * size,
        size,
        imgFmt,
        metrics: {
          h: b.readUInt8(m),
          w: b.readUInt8(m + 1),
          bx: b.readInt8(m + 2),
          by: b.readInt8(m + 3),
        },
      };
    }
  }
  return null;
}

/** 글리프 하나의 비트맵. @returns {{w,h,bx,by,rows:number[]} | null} */
function bitmapOf(cp) {
  const gid = glyphIdOf(cp);
  if (!gid) return null;
  const loc = locate(gid);
  if (!loc || !loc.size) return null;

  // imageFormat 5는 치수가 EBLC에 있고 EBDT에는 픽셀만 들어 있다.
  // 1·2·6·7은 픽셀 앞에 치수(smallGlyphMetrics)가 붙는다.
  let p = loc.off;
  let w, h, bx, by;
  if (loc.imgFmt === 5) {
    ({ w, h, bx, by } = loc.metrics);
  } else {
    h = b.readUInt8(p);
    w = b.readUInt8(p + 1);
    bx = b.readInt8(p + 2);
    by = b.readInt8(p + 3);
    p += 5;
  }
  if (!w || !h || w > 32 || h > 32) return null;

  // 비트가 행 경계 없이 이어진다 (format 1/2/5)
  const rows = [];
  let bit = 0;
  for (let y = 0; y < h; y++) {
    let v = 0;
    for (let x = 0; x < w; x++) {
      if ((b[p + (bit >> 3)] >> (7 - (bit & 7))) & 1) v |= (1 << x);
      bit++;
    }
    rows.push(v);
  }
  return { w, h, bx, by, rows };
}

// ---- 담을 문자 범위 ----
//
// 한글 전체(11172자)를 넣으면 파일이 수백 KB가 된다. 뜨개 도안에
// 실제로 쓸 만한 것만 고른다. 없는 글자는 앱이 알아서 안내한다.
const RANGES = [
  [0x20, 0x7e, 'ASCII (영문·숫자·기호)'],
  [0xac00, 0xd7a3, '한글 음절'],
  [0x3131, 0x318e, '한글 자모 (ㄱ, ㅏ 등)'],
  [0x2010, 0x2027, '문장부호 (—, ‘, “ 등)'],
  [0x2190, 0x2193, '화살표'],
  [0x2660, 0x2667, '카드무늬'],
  [0x3001, 0x3003, '한중일 부호'],
  [0x00b0, 0x00b0, '도(°)'],
  [0x2661, 0x2661, '하트'],
  [0x2605, 0x2606, '별'],
];

const raw = [];
let missing = 0;
const widths = new Map();

for (const [lo, hi] of RANGES) {
  for (let cp = lo; cp <= hi; cp++) {
    const g = bitmapOf(cp);
    if (!g) { missing++; continue; }
    raw.push([cp, g]);
    widths.set(g.w, (widths.get(g.w) ?? 0) + 1);
  }
}

// ---- 모든 글자가 공유하는 빈 위/아래 줄을 걷어낸다 ----
//
// 글리프 상자는 11줄이지만 맨 윗줄·아랫줄은 어느 글자에도 잉크가 없다.
// 그대로 두면 도안에 쓸모없는 빈 줄이 들어가고 파일도 커진다.
let top = 99, bottom = -1;
for (const [, g] of raw) {
  for (let y = 0; y < g.h; y++) {
    if (g.rows[y]) {
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
}
const height = bottom - top + 1;

// ---- 폭별로 묶어 저장한다 ----
//
// 한글 11286자가 전부 9칸이라, 글자마다 폭을 적으면 그것만으로 수십 KB다.
// 폭이 같은 것끼리 모아 한 번만 적는다. 행 비트는 이어붙여 하나의
// 긴 16진수 문자열로 둔다 — JSON 배열보다 훨씬 짧고 파싱도 빠르다.
const byWidth = new Map();
for (const [cp, g] of raw) {
  if (!byWidth.has(g.w)) byWidth.set(g.w, { cps: [], hex: [] });
  const bucket = byWidth.get(g.w);
  const per = Math.ceil(g.w / 4);
  bucket.cps.push(cp);
  for (let y = top; y <= bottom; y++) {
    bucket.hex.push((g.rows[y] ?? 0).toString(16).padStart(per, '0'));
  }
}

// 코드포인트는 이어지는 구간이 많다 — 차이만 적으면 자릿수가 크게 준다.
const packed = {};
for (const [w, { cps, hex }] of byWidth) {
  const deltas = [];
  let prev = 0;
  for (const cp of cps) { deltas.push((cp - prev).toString(36)); prev = cp; }
  packed[w] = [deltas.join(','), hex.join('')];
}
const count = raw.length;

const out = `/* 자동 생성 파일 — 편집하지 말 것.
 * 원본: 갈무리Mono9 (quiple, SIL OFL 1.1) — https://github.com/quiple/galmuri
 * 재생성: node make-glyphs.mjs <GalmuriMono9Bitmap-Regular-x.y.z.ttf>
 *
 * 폰트에 손으로 찍혀 있는 비트맵을 그대로 옮긴 것이다. 브라우저에 글자를
 * 그려달라고 하면 기기마다(PC의 DirectWrite / 폰의 CoreText) 결과가 달라
 * 같은 글자도 도안이 어긋났다. 이 표를 쓰면 어디서든 똑같이 나온다.
 *
 * 형식: { 폭: [코드포인트 차이를 36진수로 이어붙인 것, 행비트 16진수] }
 *       폭이 같은 글자끼리 묶어 폭을 한 번만 적는다(한글 11286자가 모두
 *       9칸이라 글자마다 적으면 그것만으로 수십 KB다).
 *       행 하나가 폭만큼의 비트, 최하위 비트가 왼쪽 칸. 글자마다 ${height}줄.
 */
export const GLYPH_HEIGHT_PX = ${height};
export const GLYPH_DATA = ${JSON.stringify(packed)};
`;

const outPath = join(root, 'js', 'glyphs.js');
writeFileSync(outPath, out, 'utf8');

console.log(`js/glyphs.js 생성 완료`);
console.log(`  스트라이크   : ${ppemX}×${ppemY}px`);
console.log(`  담은 글자    : ${count}자 (범위 안 ${missing}자는 폰트에 없음)`);
console.log(`  폭 분포      : ${[...widths.entries()].sort((a, c) => c[1] - a[1]).map(([w, n]) => `${w}칸×${n}자`).join(', ')}`);
console.log(`  잉크 세로범위: ${top}~${bottom} → 글자 높이 ${height}칸`);
console.log(`  파일 크기    : ${(out.length / 1024).toFixed(1)} KB`);
