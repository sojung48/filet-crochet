/**
 * 텍스트 → 도안 변환.
 *
 * GalmuriMono9 비트맵 글꼴을 캔버스에 찍고 픽셀을 그대로 칸으로 옮긴다.
 * 폰트 파일을 직접 파싱하지 않는 이유: 캔버스는 이미 쓰고 있는 도구고,
 * cmap·EBLC·EBDT를 손수 읽으면 코드가 몇 배로 커진다.
 *
 * ---- 실측으로 확정한 값 (스텝 3) ----
 *
 * 이름은 "9"지만 실제로는 12px 비트맵 글꼴이다. 폰트에 박힌 XLFD 이름이
 * `-GalmuriMono9-Regular-R-Regular--12-12-75-75-c-80-iso10646-1`이고,
 * 비트맵 스트라이크도 12×12px 하나뿐이다.
 *
 * 글리프를 실제로 뜯어 재보니:
 *   - 한글  9×11 (위아래 한 줄씩은 항상 비어 있음 → 실제 잉크는 9칸)
 *   - 영문  5×9
 *   - 전각 10×11
 *
 * 그래서 세로는 9칸으로 잘라 쓰고, 가로는 글자마다 실제 폭을 쓴다.
 * 가로를 9로 고정하면 영문 양옆에 빈 칸이 2칸씩 붙어 띄엄띄엄 보인다.
 */

import { Pattern, FILLED, MAX_SIDE } from './pattern.js';

/** 글자 한 줄의 높이(칸). 위아래 빈 줄을 걷어낸 실제 잉크 높이. */
export const GLYPH_HEIGHT = 9;

/**
 * 캔버스에 찍을 때 쓸 글자 크기(px).
 * 비트맵 글꼴은 설계된 크기에서만 또렷하다 — 어긋나면 뭉개진다.
 */
const FONT_PX = 12;

/** 글자 하나를 찍을 임시 캔버스의 여유 공간. */
const PAD = 8;

/**
 * 이름에 TEXT_를 붙인 이유: 빌드가 모듈들을 한 스코프로 합치므로
 * image.js의 DEFAULT_OPTIONS와 이름이 겹치면 뒤엣것이 앞엣것을 덮어쓴다.
 * ES 모듈로 볼 때는 문제가 없어 눈치채기 어렵다.
 */
export const TEXT_DEFAULTS = {
  letterSpacing: 1,
  lineSpacing: 1,
};

let scratch = null;

function scratchCtx() {
  if (!scratch) {
    const c = document.createElement('canvas');
    c.width = FONT_PX + PAD * 2;
    c.height = FONT_PX + PAD * 2;
    scratch = c.getContext('2d', { willReadFrequently: true });
  }
  return scratch;
}

/** 글리프 비트맵 캐시. 같은 글자를 여러 번 재지 않는다. */
const glyphCache = new Map();

/**
 * 글자 하나를 찍어 잉크가 닿은 칸만 뽑아낸다.
 * @returns {{ w: number, h: number, bits: Uint8Array } | null} 공백이면 null
 */
export function glyphOf(ch) {
  const hit = glyphCache.get(ch);
  if (hit !== undefined) return hit;

  const ctx = scratchCtx();
  const { width, height } = ctx.canvas;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `${FONT_PX}px GalmuriMono9, monospace`;
  // 베이스라인을 아래쪽에 두어 받침·아랫부분이 잘리지 않게 한다
  ctx.fillText(ch, PAD, PAD + FONT_PX);

  const { data } = ctx.getImageData(0, 0, width, height);

  // 잉크가 닿은 범위를 찾는다. 안티에일리어싱이 섞여도 비트맵 글꼴은
  // 거의 순수한 흑백이라 중간값(128)으로 자르면 원래 픽셀이 나온다.
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] < 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 < 0) {                       // 공백 등 잉크가 없는 글자
    glyphCache.set(ch, null);
    return null;
  }

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      bits[y * w + x] = data[((y + y0) * width + (x + x0)) * 4] < 128 ? 1 : 0;
    }
  }

  const glyph = { w, h, bits };
  glyphCache.set(ch, glyph);
  return glyph;
}

/** 공백 한 칸의 폭. 실제로 찍어봐야 알 수 있는 값이 아니라 규칙으로 둔다. */
const SPACE_WIDTH = 4;

/** 글자 하나가 차지하는 가로 칸 수. */
function widthOf(ch) {
  if (ch === ' ') return SPACE_WIDTH;
  return glyphOf(ch)?.w ?? SPACE_WIDTH;
}

/**
 * 텍스트가 필요로 하는 격자 크기.
 *
 * 가로는 글자마다 폭이 다르므로 줄마다 더해서 가장 긴 줄을 쓴다.
 * 세로는 글자 높이가 고정(9칸)이라 줄 수로 곱하면 된다.
 *
 * @returns {{ cols, rows, lines, overflowX, overflowY }}
 */
export function measure(text, options) {
  const { letterSpacing, lineSpacing } = { ...TEXT_DEFAULTS, ...options };
  const lines = text.split('\n');

  let cols = 0;
  for (const line of lines) {
    const chars = [...line];
    if (!chars.length) continue;
    let w = 0;
    for (const ch of chars) w += widthOf(ch);
    w += letterSpacing * (chars.length - 1);
    cols = Math.max(cols, w);
  }

  const rows = lines.length * GLYPH_HEIGHT + lineSpacing * (lines.length - 1);

  return {
    cols,
    rows,
    lines: lines.length,
    overflowX: cols > MAX_SIDE,
    overflowY: rows > MAX_SIDE,
  };
}

/**
 * 텍스트를 도안으로 찍는다.
 *
 * 격자보다 글자가 크면 넘치는 부분은 잘린다 — 부르는 쪽에서 measure()로
 * 미리 확인하고 크기를 맞춰 두는 것을 전제한다.
 *
 * @param {Pattern} into 찍어 넣을 도안 (그대로 바뀐다)
 */
export function renderTextInto(into, text, options) {
  const { letterSpacing, lineSpacing } = { ...TEXT_DEFAULTS, ...options };
  const lines = text.split('\n');
  const size = measure(text, { letterSpacing, lineSpacing });

  // 가운데 정렬. 도안을 만들고 나서 위치를 다듬는 것보다,
  // 처음부터 가운데 있는 편이 손이 덜 간다(전체 이동 기능도 있다).
  const originY = Math.floor((into.rows - size.rows) / 2);

  lines.forEach((line, li) => {
    const chars = [...line];
    let lineW = 0;
    for (const ch of chars) lineW += widthOf(ch);
    lineW += letterSpacing * Math.max(0, chars.length - 1);

    let cx = Math.floor((into.cols - lineW) / 2);
    const cy = originY + li * (GLYPH_HEIGHT + lineSpacing);

    for (const ch of chars) {
      const g = ch === ' ' ? null : glyphOf(ch);
      if (g) {
        // 글리프가 9칸보다 낮으면(영문 등) 아래를 맞춰 베이스라인을 정렬한다
        const dy = GLYPH_HEIGHT - g.h;
        for (let y = 0; y < g.h; y++) {
          for (let x = 0; x < g.w; x++) {
            if (g.bits[y * g.w + x]) into.set(cx + x, cy + y + dy, FILLED);
          }
        }
      }
      cx += widthOf(ch) + letterSpacing;
    }
  });
}

/** 텍스트만으로 새 도안을 만든다 (필요한 크기에 딱 맞춰서). */
export function textToPattern(text, cols, rows, options) {
  const p = new Pattern(cols, rows);
  renderTextInto(p, text, options);
  return p;
}

/** 글꼴이 실제로 준비됐는지. 준비 전에 찍으면 대체 글꼴이 나온다. */
export async function ensureFontLoaded() {
  if (!document.fonts?.load) return true;
  try {
    await document.fonts.load(`${FONT_PX}px GalmuriMono9`, '안녕A');
    return document.fonts.check(`${FONT_PX}px GalmuriMono9`);
  } catch {
    return false;
  }
}

/** 글꼴이 바뀌면 캐시가 헛것이 된다 — 다시 재게 한다. */
export function clearGlyphCache() {
  glyphCache.clear();
}
