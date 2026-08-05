/** 격자를 캔버스에 그린다. 화면용과 내보내기용 모두 여기를 쓴다. */

import { OPEN } from './pattern.js';

export const GUIDE_EVERY = 10;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 번호 여백(눈금자) 두께.
 * 칸 크기뿐 아니라 가장 긴 번호(예: 300)의 자릿수도 고려해야
 * 세 자리 행 번호가 격자를 침범하지 않는다.
 */
function gutter(cell, pattern) {
  const digits = pattern ? String(Math.max(pattern.cols, pattern.rows)).length : 2;
  return Math.max(18, Math.round(cell * 1.1), digits * 9 + 6);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./pattern.js').Pattern} pattern
 * @param {object} opts
 *   cell        칸 한 변 픽셀
 *   guides      10칸마다 굵은 선
 *   numbers     행/열 번호
 *   symbols     채운 칸에 × 기호
 *   colors      { bg, line, lineStrong, filled, text }
 *   preview     { x0, y0, x1, y1, value } | null — 사각형 도구 미리보기
 */
export function draw(ctx, pattern, opts) {
  const {
    cell, guides, numbers, symbols, colors,
    preview = null,
  } = opts;

  const pad = numbers ? gutter(cell, pattern) : 0;
  const w = pattern.cols * cell;
  const h = pattern.rows * cell;

  ctx.save();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, pad + w, pad + h);
  ctx.translate(pad, pad);

  // 채운 칸
  ctx.fillStyle = colors.filled;
  for (let y = 0; y < pattern.rows; y++) {
    for (let x = 0; x < pattern.cols; x++) {
      if (valueAt(pattern, x, y, preview) !== OPEN) {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  // 기호 (× — 채운 칸을 흑백 인쇄에서 구분하기 좋게)
  if (symbols) {
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = Math.max(1, cell * 0.09);
    const inset = cell * 0.28;
    for (let y = 0; y < pattern.rows; y++) {
      for (let x = 0; x < pattern.cols; x++) {
        if (valueAt(pattern, x, y, preview) === OPEN) continue;
        const px = x * cell;
        const py = y * cell;
        ctx.beginPath();
        ctx.moveTo(px + inset, py + inset);
        ctx.lineTo(px + cell - inset, py + cell - inset);
        ctx.moveTo(px + cell - inset, py + inset);
        ctx.lineTo(px + inset, py + cell - inset);
        ctx.stroke();
      }
    }
  }

  // 격자선. 0.5 오프셋으로 1px 선이 흐려지지 않게 한다.
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.line;
  ctx.beginPath();
  for (let x = 0; x <= pattern.cols; x++) {
    if (guides && x % GUIDE_EVERY === 0) continue;
    const px = Math.round(x * cell) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  for (let y = 0; y <= pattern.rows; y++) {
    if (guides && y % GUIDE_EVERY === 0) continue;
    const py = Math.round(y * cell) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
  }
  ctx.stroke();

  // 굵은 안내선 + 테두리
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.lineStrong;
  ctx.beginPath();
  for (let x = 0; x <= pattern.cols; x++) {
    if (!(guides && x % GUIDE_EVERY === 0) && x !== 0 && x !== pattern.cols) continue;
    const px = Math.round(x * cell) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  for (let y = 0; y <= pattern.rows; y++) {
    if (!(guides && y % GUIDE_EVERY === 0) && y !== 0 && y !== pattern.rows) continue;
    const py = Math.round(y * cell) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
  }
  ctx.stroke();

  // 번호 — 칸마다 하나씩. 글자가 물리적으로 안 들어갈 때만 건너뛴다.
  if (numbers) {
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxDigits = String(Math.max(pattern.cols, pattern.rows)).length;
    // 칸 안에 maxDigits 자리가 들어가도록 글자 크기를 잡는다 (숫자 폭 ≈ 높이의 0.6배)
    const fontSize = clamp(Math.floor(cell / (maxDigits * 0.62)), 7, Math.round(cell * 0.62));
    ctx.font = `${fontSize}px system-ui, sans-serif`;

    // 이 글자 크기로도 못 들어가면 그때만 5칸/10칸 간격으로 솎아낸다
    const needed = fontSize * 0.62 * maxDigits + 2;
    const step = needed <= cell ? 1 : (needed <= cell * 5 ? 5 : GUIDE_EVERY);
    const show = (label) => label === 1 || label % step === 0;

    // 열 번호: 오른쪽 → 왼쪽 (코바늘은 오른쪽에서 시작)
    for (let x = 0; x < pattern.cols; x++) {
      const label = pattern.cols - x;
      if (!show(label) && label !== pattern.cols) continue;
      ctx.fillText(String(label), x * cell + cell / 2, -pad / 2);
    }

    // 행 번호: 아래 → 위 (1행이 맨 아래)
    for (let y = 0; y < pattern.rows; y++) {
      const label = pattern.rows - y;
      if (!show(label) && label !== pattern.rows) continue;
      ctx.fillText(String(label), -pad / 2, y * cell + cell / 2);
    }
  }

  ctx.restore();
}

/** 사각형 미리보기를 얹은 실효 칸 값. */
function valueAt(pattern, x, y, preview) {
  if (preview) {
    const { x0, y0, x1, y1, value } = preview;
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) &&
        y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) {
      return value;
    }
  }
  return pattern.get(x, y);
}

/** 캔버스 픽셀 좌표 → 칸 좌표. 범위 밖이면 null. */
export function hitTest(pattern, px, py, cell, numbers) {
  const pad = numbers ? gutter(cell, pattern) : 0;
  const x = Math.floor((px - pad) / cell);
  const y = Math.floor((py - pad) / cell);
  return pattern.inBounds(x, y) ? { x, y } : null;
}

/** 주어진 옵션에서 캔버스가 필요로 하는 CSS 픽셀 크기. */
export function canvasSize(pattern, cell, numbers) {
  const pad = numbers ? gutter(cell, pattern) : 0;
  return { width: pad + pattern.cols * cell, height: pad + pattern.rows * cell };
}
