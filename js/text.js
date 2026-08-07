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
 * 글꼴은 여러 개 중에 고를 수 있다. 도안에서 중요한 건 글자가 몇 칸을
 * 차지하느냐이므로, 고를 때 칸 수를 함께 보여준다.
 *   갈무리7      한글 7칸 · 높이 8칸    ← 가장 작다
 *   갈무리Mono7  한글 8칸 · 높이 9칸
 *   갈무리Mono9  한글 9칸 · 높이 11칸   ← 기본
 *   갈무리11     한글 11칸 · 높이 13칸
 */

import { Pattern, FILLED, MAX_SIDE } from './pattern.js';
import { FONTS, DEFAULT_FONT } from './glyphs.js';

/** 고를 수 있는 글꼴들. 화면에 목록을 만들 때 쓴다. */
export function fontList() {
  return Object.entries(FONTS).map(([key, f]) => ({
    key,
    label: f.label,
    hangul: f.hangul,
    latin: f.latin,
    height: f.height,
  }));
}

// DEFAULT_FONT는 glyphs.js에서 가져와 그대로 다시 내보낸다.
// `export { DEFAULT_FONT }` 형태로 쓰면 빌드가 export를 떼지 못해
// 번들에 그대로 남고, 일반 스크립트에서 문법 오류가 난다.
export const TEXT_DEFAULT_FONT = DEFAULT_FONT;

/**
 * 이름에 TEXT_를 붙인 이유: 빌드가 모듈들을 한 스코프로 합치므로
 * image.js의 DEFAULT_OPTIONS와 이름이 겹치면 뒤엣것이 앞엣것을 덮어쓴다.
 * ES 모듈로 볼 때는 문제가 없어 눈치채기 어렵다.
 */
export const TEXT_DEFAULTS = {
  letterSpacing: 1,
  lineSpacing: 1,
  align: 'center',        // 가로: 'left' | 'center' | 'right'
  valign: 'middle',       // 세로: 'top' | 'middle' | 'bottom'
  font: DEFAULT_FONT,
};

/** 이름이 잘못됐을 때 기본 글꼴로 되돌린다 (옛 설정을 읽는 경우). */
function fontOf(key) {
  return FONTS[key] ?? FONTS[DEFAULT_FONT];
}

/** 이 글꼴에서 한 줄이 차지하는 높이(칸). */
export function glyphHeight(fontKey) {
  return fontOf(fontKey).height;
}

/**
 * 코드포인트 → { w, rows } 표.
 *
 * glyphs.js는 자리를 아끼려고 폭별로 묶고 코드포인트를 차이로 적어 두었다.
 * 처음 쓸 때 한 번만 펴서 Map으로 만든다(1만 자가 넘어 매번 훑을 수 없다).
 */
const tables = new Map();

function glyphTable(fontKey) {
  const key = FONTS[fontKey] ? fontKey : DEFAULT_FONT;
  const hit = tables.get(key);
  if (hit) return hit;

  const font = FONTS[key];
  const table = new Map();
  for (const [wStr, [deltas, hex]] of Object.entries(font.data)) {
    const w = Number(wStr);
    const per = Math.ceil(w / 4);
    const stride = per * font.height;
    let cp = 0;
    deltas.split(',').forEach((d, i) => {
      cp += parseInt(d, 36);
      const at = i * stride;
      const rows = new Uint32Array(font.height);
      for (let y = 0; y < font.height; y++) {
        rows[y] = parseInt(hex.slice(at + y * per, at + (y + 1) * per), 16);
      }
      table.set(cp, { w, rows });
    });
  }
  tables.set(key, table);
  return table;
}

/** 글자 하나의 모양. 글꼴에 없으면 null. */
function glyphOf(ch, fontKey) {
  return glyphTable(fontKey).get(ch.codePointAt(0)) ?? null;
}

/** 글자 하나가 차지하는 가로 칸 수. */
export function widthOf(ch, fontKey) {
  // 공백은 글리프가 없다 — 이 글꼴의 영문 폭을 쓴다
  return glyphOf(ch, fontKey)?.w ?? fontOf(fontKey).latin;
}

/** 이 글자를 도안에 넣을 수 있는지. 없는 글자는 안내에 쓴다. */
export function hasGlyph(ch, fontKey) {
  return ch === ' ' || glyphTable(fontKey).has(ch.codePointAt(0));
}

/** 글꼴에 없어 빈칸으로 나올 글자들. 중복은 지운다. */
export function missingChars(text, fontKey) {
  const out = [];
  for (const ch of text) {
    if (ch === '\n' || ch === ' ' || hasGlyph(ch, fontKey)) continue;
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
  const { letterSpacing, lineSpacing, font } = { ...TEXT_DEFAULTS, ...options };
  const lines = text.split('\n');
  const height = glyphHeight(font);

  let cols = 0;
  for (const line of lines) {
    const chars = [...line];
    if (!chars.length) continue;
    let w = 0;
    for (const ch of chars) w += widthOf(ch, font);
    w += letterSpacing * (chars.length - 1);
    cols = Math.max(cols, w);
  }

  const rows = lines.length * height + lineSpacing * (lines.length - 1);

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
  const {
    letterSpacing, lineSpacing, align, valign, font,
  } = { ...TEXT_DEFAULTS, ...options };
  const lines = text.split('\n');
  const size = measureText(text, { letterSpacing, lineSpacing, font });
  const height = glyphHeight(font);

  // 세로 자리. 가로와 같은 규칙으로 잡는다.
  const originY = valign === 'top' ? 0
    : valign === 'bottom' ? into.rows - size.rows
    : Math.floor((into.rows - size.rows) / 2);

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
    for (const ch of chars) lineW += widthOf(ch, font);
    lineW += letterSpacing * (chars.length - 1);

    let cx = startX(lineW);
    const cy = originY + li * (height + lineSpacing);

    for (const ch of chars) {
      const g = glyphOf(ch, font);
      if (g) {
        for (let y = 0; y < height; y++) {
          const bits = g.rows[y];
          if (!bits) continue;
          for (let x = 0; x < g.w; x++) {
            if ((bits >> x) & 1) into.set(cx + x, cy + y, FILLED);
          }
        }
      }
      cx += widthOf(ch, font) + letterSpacing;
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
