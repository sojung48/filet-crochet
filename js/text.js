/**
 * 텍스트 → 도안 변환.
 *
 * 글자 모양은 js/glyphs.js에서 온다 — 갈무리Mono9 폰트에 손으로 찍혀
 * 있는 비트맵을 빌드할 때 미리 꺼내 둔 표다.
 *
 * 왜 브라우저에 안 맡기나: 캔버스에 글자를 찍고 픽셀을 읽는 방식은
 * 기기마다 결과가 달랐다. 글자를 그리는 엔진이 PC(DirectWrite)와
 * 폰(CoreText)에서 다르고, 외곽선 가장자리의 흐린 픽셀을 어디서
 * 자르냐에 따라 칸 하나가 갈렸다. 같은 글자를 넣어도 PC와 폰에서
 * 도안이 어긋났다. 표를 쓰면 어디서든 똑같이 나온다.
 *
 * 크기 (폰트 원본 그대로):
 *   한글  9칸 폭, 영문·숫자 5칸 폭, 한 줄 11칸 높이
 */

import { Pattern, FILLED, MAX_SIDE } from './pattern.js';
import { GLYPH_DATA, GLYPH_HEIGHT_PX } from './glyphs.js';

/** 한 줄이 차지하는 높이(칸). 글리프 표에서 가져온다. */
export const GLYPH_HEIGHT = GLYPH_HEIGHT_PX;

/** 글꼴에 없는 글자를 대신할 폭. 공백도 이 값을 쓴다. */
const SPACE_WIDTH = 5;

/**
 * 이름에 TEXT_를 붙인 이유: 빌드가 모듈들을 한 스코프로 합치므로
 * image.js의 DEFAULT_OPTIONS와 이름이 겹치면 뒤엣것이 앞엣것을 덮어쓴다.
 * ES 모듈로 볼 때는 문제가 없어 눈치채기 어렵다.
 */
export const TEXT_DEFAULTS = {
  letterSpacing: 1,
  lineSpacing: 1,
  align: 'center',        // 'left' | 'center' | 'right'
};

/**
 * 코드포인트 → { w, rows } 표.
 *
 * glyphs.js는 자리를 아끼려고 폭별로 묶고 코드포인트를 차이로 적어 두었다.
 * 처음 쓸 때 한 번만 펴서 Map으로 만든다(1만 자가 넘어 매번 훑을 수 없다).
 */
let table = null;

function glyphTable() {
  if (table) return table;
  table = new Map();
  for (const [wStr, [deltas, hex]] of Object.entries(GLYPH_DATA)) {
    const w = Number(wStr);
    const per = Math.ceil(w / 4);
    const stride = per * GLYPH_HEIGHT_PX;
    let cp = 0;
    deltas.split(',').forEach((d, i) => {
      cp += parseInt(d, 36);
      const at = i * stride;
      const rows = new Uint32Array(GLYPH_HEIGHT_PX);
      for (let y = 0; y < GLYPH_HEIGHT_PX; y++) {
        rows[y] = parseInt(hex.slice(at + y * per, at + (y + 1) * per), 16);
      }
      table.set(cp, { w, rows });
    });
  }
  return table;
}

/** 글자 하나의 모양. 글꼴에 없으면 null. */
function glyphOf(ch) {
  return glyphTable().get(ch.codePointAt(0)) ?? null;
}

/** 글자 하나가 차지하는 가로 칸 수. */
export function widthOf(ch) {
  return glyphOf(ch)?.w ?? SPACE_WIDTH;
}

/** 이 글자를 도안에 넣을 수 있는지. 없는 글자는 안내에 쓴다. */
export function hasGlyph(ch) {
  return ch === ' ' || glyphTable().has(ch.codePointAt(0));
}

/** 글꼴에 없어 빈칸으로 나올 글자들. 중복은 지운다. */
export function missingChars(text) {
  const out = [];
  for (const ch of text) {
    if (ch === '\n' || ch === ' ' || hasGlyph(ch)) continue;
    if (!out.includes(ch)) out.push(ch);
  }
  return out;
}

/**
 * 텍스트가 필요로 하는 격자 크기.
 *
 * 가로는 글자마다 자리폭이 달라 줄마다 더한 뒤 가장 긴 줄을 쓴다.
 * 세로는 글자 높이가 고정이라 줄 수로 곱하면 된다.
 *
 * @returns {{ cols, rows, lines, overflowX, overflowY }}
 */
export function measureText(text, options) {
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
export function renderText(into, text, options) {
  const { letterSpacing, lineSpacing, align } = { ...TEXT_DEFAULTS, ...options };
  const lines = text.split('\n');
  const size = measureText(text, { letterSpacing, lineSpacing });

  // 세로는 늘 가운데. 위아래 정렬까지 두면 고를 것만 늘고,
  // 자리를 옮기고 싶으면 전체 이동(◀▲▼▶)이 이미 있다.
  const originY = Math.floor((into.rows - size.rows) / 2);

  // 여러 줄일 때 정렬은 "가장 긴 줄"이 아니라 도안 전체를 기준으로 잡는다.
  // 그래야 왼쪽 정렬한 줄들의 시작점이 서로 어긋나지 않는다.
  const startX = (w) => {
    if (align === 'left') return 0;
    if (align === 'right') return into.cols - w;
    return Math.floor((into.cols - w) / 2);
  };

  lines.forEach((line, li) => {
    const chars = [...line];
    if (!chars.length) return;

    let lineW = 0;
    for (const ch of chars) lineW += widthOf(ch);
    lineW += letterSpacing * (chars.length - 1);

    let cx = startX(lineW);
    const cy = originY + li * (GLYPH_HEIGHT + lineSpacing);

    for (const ch of chars) {
      const g = glyphOf(ch);
      if (g) {
        for (let y = 0; y < GLYPH_HEIGHT; y++) {
          const bits = g.rows[y];
          if (!bits) continue;
          for (let x = 0; x < g.w; x++) {
            if ((bits >> x) & 1) into.set(cx + x, cy + y, FILLED);
          }
        }
      }
      cx += widthOf(ch) + letterSpacing;
    }
  });
}

/** 텍스트만으로 새 도안을 만든다. */
export function textToPattern(text, cols, rows, options) {
  const p = new Pattern(cols, rows);
  renderText(p, text, options);
  return p;
}

/**
 * 글자 모양이 쓸 준비가 됐는지.
 *
 * 이제 글리프 표가 코드에 함께 들어 있어 늘 준비되어 있다. 웹폰트를
 * 기다리던 시절의 흔적으로 남겨 둔 것 — 부르는 쪽을 고치지 않아도 되게.
 */
export function fontReady() {
  return true;
}
