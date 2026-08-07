/**
 * 텍스트 → 도안 변환.
 *
 * GalmuriMono9을 캔버스에 찍고 픽셀을 그대로 칸으로 옮긴다.
 *
 * ---- 실측으로 확정한 것 (스텝 3, headless Chrome으로 확인) ----
 *
 * 이름은 "9"지만 실제로는 12px 글꼴이다. 폰트에 박힌 XLFD 이름이
 * `-GalmuriMono9-Regular-R-Regular--12-12-75-75-c-80-iso10646-1`이다.
 *
 * 중요 — 브라우저는 폰트에 든 비트맵이 아니라 외곽선을 그린다.
 * 그래서 글리프의 "잉크가 닿은 크기"는 글자마다 들쭉날쭉하다
 * (안 11×11, 녕 10×11, A 5×10, 1 3×10). 이걸 폭으로 쓰면 글자
 * 사이가 제멋대로 벌어진다.
 *
 * 대신 폰트가 정한 **자리폭(advance width)**을 쓴다. 이건 정확히
 * 고르다: 한글 = 글자 크기, 영문·숫자 = 글자 크기의 절반. 12px에서
 * 한글 12칸, 영문 6칸이다. 이 값으로 자리를 잡고, 글자는 줄 단위로
 * 한 번에 찍은 뒤 이진화한다.
 */

import { Pattern, FILLED, MAX_SIDE } from './pattern.js';

/**
 * 캔버스에 찍을 글자 크기(px). 그대로 칸 수가 된다
 * (한글 12칸 폭, 영문 6칸 폭).
 */
const FONT_PX = 12;

/** 글자 한 줄이 차지하는 높이(칸). 12px에서 잉크는 11칸까지 닿는다. */
export const GLYPH_HEIGHT = 11;

/**
 * 이진화 기준. 외곽선을 그리며 생긴 흐린 가장자리를 어디까지 칸으로
 * 칠지 정한다. 190은 획이 끊기지 않으면서 번지지도 않는 값이다.
 */
const INK_THRESHOLD = 190;

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
    scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  return scratch;
}

/** 자리폭 캐시. 같은 글자를 여러 번 재지 않는다. */
const widthCache = new Map();

/**
 * 글자 하나가 차지하는 가로 칸 수 (폰트가 정한 자리폭).
 *
 * 잉크가 닿은 폭이 아니라는 점이 중요하다. 잉크 폭은 글자마다 달라
 * ('1'은 3칸, '안'은 11칸) 그대로 쓰면 글자 사이가 들쭉날쭉해진다.
 * 자리폭은 한글 12 / 영문 6으로 고르다.
 */
export function widthOf(ch) {
  const hit = widthCache.get(ch);
  if (hit !== undefined) return hit;

  const ctx = scratchCtx();
  ctx.font = `${FONT_PX}px GalmuriMono9, monospace`;
  const w = Math.round(ctx.measureText(ch).width);
  widthCache.set(ch, w);
  return w;
}

/**
 * 한 줄을 통째로 찍어 칸 배열로 만든다.
 *
 * 글자를 하나씩 따로 찍지 않는 이유: 따로 찍으면 글자마다 잉크 위치가
 * 달라 베이스라인을 손으로 맞춰야 하고, 받침 있는 글자가 어긋난다.
 * 줄째로 찍으면 브라우저가 알아서 정렬해 준다.
 *
 * @returns {{ w: number, h: number, bits: Uint8Array }}
 */
function rasterLine(line, letterSpacing) {
  const ctx = scratchCtx();
  ctx.font = `${FONT_PX}px GalmuriMono9, monospace`;

  const chars = [...line];
  let w = 0;
  for (const ch of chars) w += widthOf(ch);
  w += letterSpacing * Math.max(0, chars.length - 1);
  const h = GLYPH_HEIGHT;

  if (!w || !chars.length) return { w: 0, h, bits: new Uint8Array(0) };

  const c = ctx.canvas;
  c.width = w;
  c.height = h + FONT_PX;                  // 아래로 삐져나오는 획까지 담을 여유
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `${FONT_PX}px GalmuriMono9, monospace`;

  // 글자 간격이 있으면 한 자씩 자리를 잡아 찍는다.
  // 간격이 0이면 줄째로 찍어 브라우저의 자간 처리를 그대로 쓴다.
  if (letterSpacing) {
    let x = 0;
    for (const ch of chars) {
      ctx.fillText(ch, x, FONT_PX);
      x += widthOf(ch) + letterSpacing;
    }
  } else {
    ctx.fillText(line, 0, FONT_PX);
  }

  const { data } = ctx.getImageData(0, 0, c.width, c.height);

  // 잉크가 닿은 세로 범위를 찾아 위쪽 빈 줄을 걷어낸다.
  // 그래야 줄마다 높이가 같아지고 줄 간격이 일정해진다.
  let top = -1, bottom = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4] < INK_THRESHOLD) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  if (top < 0) return { w, h, bits: new Uint8Array(w * h) };

  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = top + y;
    if (sy > bottom || sy >= c.height) break;
    for (let x = 0; x < w; x++) {
      bits[y * w + x] = data[(sy * c.width + x) * 4] < INK_THRESHOLD ? 1 : 0;
    }
  }
  return { w, h, bits };
}

/**
 * 텍스트가 필요로 하는 격자 크기.
 *
 * 가로는 글자마다 자리폭이 달라 줄마다 더한 뒤 가장 긴 줄을 쓴다.
 * 세로는 글자 높이가 고정이라 줄 수로 곱하면 된다.
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
 * 텍스트를 도안에 찍는다.
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

  // 가운데 정렬. 처음부터 가운데 있는 편이 손이 덜 간다
  // (자리를 옮기고 싶으면 전체 이동 기능이 있다).
  const originY = Math.floor((into.rows - size.rows) / 2);

  lines.forEach((line, li) => {
    const g = rasterLine(line, letterSpacing);
    if (!g.w) return;

    const cx = Math.floor((into.cols - g.w) / 2);
    const cy = originY + li * (GLYPH_HEIGHT + lineSpacing);

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.bits[y * g.w + x]) into.set(cx + x, cy + y, FILLED);
      }
    }
  });
}

/** 텍스트만으로 새 도안을 만든다. */
export function textToPattern(text, cols, rows, options) {
  const p = new Pattern(cols, rows);
  renderTextInto(p, text, options);
  return p;
}

/**
 * 글꼴이 준비됐는지.
 *
 * 준비 전에 찍으면 아무것도 그려지지 않는다 — `font-display: block`이
 * 글꼴을 기다리는 동안 글자를 투명하게 그리기 때문이다. 그러면 잉크가
 * 하나도 없어 글자 폭이 0이 되고, 미리보기가 통째로 빈 화면이 된다.
 *
 * 그래서 이 값을 그릴 때마다 확인한다. 시작할 때 한 번만 봐서는,
 * 글꼴이 늦게 오는 회선에서 첫 입력이 빈 화면으로 남는다.
 */
export function fontReady() {
  if (!document.fonts?.check) return true;   // 이 기능이 없는 브라우저는 그냥 진행
  try {
    return document.fonts.check(`${FONT_PX}px GalmuriMono9`);
  } catch {
    return true;
  }
}

/** 글꼴을 불러오고 준비될 때까지 기다린다. @returns {Promise<boolean>} 성공 여부 */
export async function ensureFontLoaded() {
  if (!document.fonts?.load) return true;
  try {
    await document.fonts.load(`${FONT_PX}px GalmuriMono9`, '안녕하세요ABC');
    // 캔버스에 찍히기까지 한 박자 더 걸리는 브라우저가 있다
    await document.fonts.ready;
    clearGlyphCache();
    return fontReady();
  } catch {
    return false;
  }
}

/** 글꼴이 바뀌면 캐시가 헛것이 된다 — 다시 재게 한다. */
export function clearGlyphCache() {
  widthCache.clear();
}
