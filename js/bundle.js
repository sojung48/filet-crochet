/* 자동 생성 파일 — 편집하지 말 것. 원본은 js/*.js, 재생성은 "node build.mjs" */
(function () {
'use strict';

// ===== js/pattern.js =====
/**
 * 도안 데이터 모델.
 *
 * 칸 값은 boolean이 아니라 팔레트 인덱스(0 = 비움, 1 = 채움)로 둔다.
 * 2단계에서 다색 그래프 도안으로 확장할 때 저장 포맷을 그대로 쓰기 위함.
 */const OPEN = 0;const FILLED = 1;

/** 팔레트. 인덱스 순서가 곧 칸 값이다. */const DEFAULT_PALETTE = [
  { name: '비움', css: 'transparent' },
  { name: '채움', css: 'var(--cell-filled)' },
];

/**
 * 격자 한 변의 최대 칸 수.
 *
 * 300까지 열어두면 최대 배율·고해상도 화면과 겹칠 때 캔버스가 브라우저
 * 한계를 넘어 화면이 통째로 비어버린다. 실행취소 스냅샷 메모리도 함께
 * 커진다. 실제 뜨개 도안은 100칸이면 충분히 크다.
 */const MAX_SIDE = 100;

/**
 * 이미 만들어 둔 도안을 열 때만 허용하는 상한.
 * 상한을 낮추기 전에 저장한 파일이 갑자기 안 열리면 안 되므로,
 * 새로 만들 때(MAX_SIDE)보다 넉넉하게 받아준다.
 */const MAX_SIDE_IMPORT = 300;class Pattern {
  constructor(cols = 30, rows = 30, palette = DEFAULT_PALETTE) {
    this.cols = cols;
    this.rows = rows;
    this.palette = palette.map((p) => ({ ...p }));
    this.cells = new Uint8Array(cols * rows);
  }

  index(x, y) {
    return y * this.cols + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  get(x, y) {
    return this.inBounds(x, y) ? this.cells[this.index(x, y)] : OPEN;
  }

  /** @returns {boolean} 값이 실제로 바뀌었는지 */
  set(x, y, value) {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    if (this.cells[i] === value) return false;
    this.cells[i] = value;
    return true;
  }

  countOf(value) {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === value) n++;
    return n;
  }

  clone() {
    const p = new Pattern(this.cols, this.rows, this.palette);
    p.cells.set(this.cells);
    return p;
  }

  /** 크기 변경. 겹치는 영역은 좌상단 기준으로 유지하고 나머지는 잘라낸다. */
  resized(cols, rows) {
    const p = new Pattern(cols, rows, this.palette);
    const w = Math.min(cols, this.cols);
    const h = Math.min(rows, this.rows);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        p.cells[p.index(x, y)] = this.cells[this.index(x, y)];
      }
    }
    return p;
  }

  /**
   * 도안 전체를 dx, dy 칸만큼 옮긴다.
   *
   * 격자 밖으로 나간 칸은 사라지지 않고 반대편 끝으로 돌아 들어온다.
   * 잘라내면 반대로 밀어도 복구되지 않아 실행취소에 기대야 하는데,
   * 감싸기는 항상 되돌릴 수 있고 규칙도 하나뿐이라 예측하기 쉽다.
   *
   * @returns {boolean} 실제로 바뀐 칸이 있었는지 (없으면 실행취소에 쌓지 않는다)
   */
  shift(dx, dy) {
    if (!dx && !dy) return false;

    // 음수 이동에서도 양수 나머지가 나오도록 한 번 더 더한다
    const sx = ((dx % this.cols) + this.cols) % this.cols;
    const sy = ((dy % this.rows) + this.rows) % this.rows;

    const next = new Uint8Array(this.cells.length);
    for (let y = 0; y < this.rows; y++) {
      const ny = (y + sy) % this.rows;
      for (let x = 0; x < this.cols; x++) {
        const nx = (x + sx) % this.cols;
        next[ny * this.cols + nx] = this.cells[this.index(x, y)];
      }
    }

    // 전부 비어 있거나 결과가 같으면 변경으로 치지 않는다
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== this.cells[i]) { changed = true; break; }
    }
    if (!changed) return false;

    this.cells.set(next);
    return true;
  }

  /** 4방향 flood fill. @returns {boolean} 바뀐 칸이 있었는지 */
  floodFill(sx, sy, value) {
    if (!this.inBounds(sx, sy)) return false;
    const target = this.get(sx, sy);
    if (target === value) return false;

    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      if (!this.inBounds(x, y)) continue;
      const i = this.index(x, y);
      if (this.cells[i] !== target) continue;
      this.cells[i] = value;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    return true;
  }

  /** 채움 ↔ 비움 반전. 팔레트가 2색일 때만 의미가 있다. */
  invert() {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = this.cells[i] === OPEN ? FILLED : OPEN;
    }
  }

  clear() {
    this.cells.fill(OPEN);
  }

  /** 한 행을 [{ value, count }] 런렝스로 압축. */
  runsOfRow(y) {
    const runs = [];
    for (let x = 0; x < this.cols; x++) {
      const v = this.get(x, y);
      const last = runs[runs.length - 1];
      if (last && last.value === v) last.count++;
      else runs.push({ value: v, count: 1 });
    }
    return runs;
  }

  // ---- 직렬화 ----

  toJSON() {
    return {
      format: 'filet-crochet-pattern',
      version: 1,
      cols: this.cols,
      rows: this.rows,
      palette: this.palette,
      // 런렝스: [값, 개수, 값, 개수, ...] — 행 순서대로 이어붙인 1차원
      cells: encodeRLE(this.cells),
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') throw new Error('도안 파일이 아닙니다.');
    const cols = Number(data.cols);
    const rows = Number(data.rows);
    if (!isValidSide(cols) || !isValidSide(rows)) {
      throw new Error('격자 크기가 올바르지 않습니다.');
    }

    const palette = Array.isArray(data.palette) && data.palette.length >= 2
      ? data.palette
      : DEFAULT_PALETTE;
    const p = new Pattern(cols, rows, palette);

    const cells = decodeCells(data.cells, cols * rows, p.palette.length);
    if (!cells) throw new Error('칸 데이터가 손상되었습니다.');
    p.cells.set(cells);
    return p;
  }
}

function isValidSide(n) {
  return Number.isInteger(n) && n >= 1 && n <= MAX_SIDE_IMPORT;
}

function encodeRLE(cells) {
  const out = [];
  let value = cells[0] ?? 0;
  let count = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === value) {
      count++;
    } else {
      out.push(value, count);
      value = cells[i];
      count = 1;
    }
  }
  if (count) out.push(value, count);
  return out;
}

/** RLE 배열, 또는 평면 배열도 받아준다. */
function decodeCells(raw, expected, paletteSize) {
  if (!Array.isArray(raw)) return null;

  // RLE를 먼저 시도하되, 칸 수가 정확히 맞아떨어질 때만 인정한다.
  // (짝수 길이 평면 배열이 RLE로 잘못 해석되는 것을 막기 위함)
  const rle = decodeRLE(raw, expected, paletteSize);
  if (rle) return rle;

  if (raw.length === expected) return flatten(raw, paletteSize);
  return null;
}

function decodeRLE(raw, expected, paletteSize) {
  if (raw.length % 2 !== 0) return null;

  const out = new Uint8Array(expected);
  let at = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const count = Number(raw[i + 1]);
    if (!Number.isInteger(count) || count < 0) return null;
    if (at + count > expected) return null;      // 넘치면 RLE가 아니다
    out.fill(clampValue(raw[i], paletteSize), at, at + count);
    at += count;
  }
  return at === expected ? out : null;
}

function flatten(raw, paletteSize) {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = clampValue(raw[i], paletteSize);
  return out;
}

function clampValue(v, paletteSize) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n >= paletteSize) return OPEN;
  return n;
}

// ===== js/renderer.js =====
/** 격자를 캔버스에 그린다. 화면용과 내보내기용 모두 여기를 쓴다. */
const GUIDE_EVERY = 10;

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
function draw(ctx, pattern, opts) {
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
function hitTest(pattern, px, py, cell, numbers) {
  const pad = numbers ? gutter(cell, pattern) : 0;
  const x = Math.floor((px - pad) / cell);
  const y = Math.floor((py - pad) / cell);
  return pattern.inBounds(x, y) ? { x, y } : null;
}

/** 주어진 옵션에서 캔버스가 필요로 하는 CSS 픽셀 크기. */
function canvasSize(pattern, cell, numbers) {
  const pad = numbers ? gutter(cell, pattern) : 0;
  return { width: pad + pattern.cols * cell, height: pad + pattern.rows * cell };
}

// ===== js/reading.js =====
/**
 * 행별 지시문 생성.
 *
 * 실제 뜨기 순서를 따른다:
 *  - 1행은 맨 아래 (격자 화면상 마지막 행)
 *  - 지그재그(boustrophedon): 홀수행은 오른쪽→왼쪽, 짝수행은 왼쪽→오른쪽
 */

/**
 * @returns {{ row:number, dir:'→'|'←', text:string, runs:Array }[]} 1행부터 순서대로
 */
function buildReading(pattern, { boustrophedon = true } = {}) {
  const lines = [];

  for (let row = 1; row <= pattern.rows; row++) {
    const y = pattern.rows - row;           // 1행 = 맨 아래
    const rightToLeft = !boustrophedon || row % 2 === 1;

    let runs = pattern.runsOfRow(y);
    if (rightToLeft) runs = runs.slice().reverse();

    lines.push({
      row,
      dir: rightToLeft ? '←' : '→',
      runs,
      text: runs.map((r) => `${r.count} ${label(r.value)}`).join(', '),
    });
  }

  return lines;
}

function label(value) {
  return value === FILLED ? 'filled' : 'open';
}

/** 클립보드/인쇄용 평문. */
function readingToText(lines, { boustrophedon = true } = {}) {
  const head = boustrophedon
    ? '※ 1행은 맨 아래, 홀수행 ←(오른쪽→왼쪽) / 짝수행 →(왼쪽→오른쪽)'
    : '※ 1행은 맨 아래, 모든 행 ←(오른쪽→왼쪽)';
  const body = lines.map((l) => `${l.row}행 ${l.dir}: ${l.text}`).join('\n');
  return `${head}\n\n${body}\n`;
}

/** 패널·인쇄 영역용 HTML. */
function readingToHTML(lines) {
  if (!lines.length) return '<p class="empty">격자가 비어 있습니다.</p>';
  return lines
    .map((l) => `<div class="row-line"><span class="row-no">${l.row}행 ${l.dir}</span> ${escapeHTML(l.text)}</div>`)
    .join('');
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ===== js/history.js =====
/**
 * 실행취소/재실행.
 *
 * 스냅샷 방식. 도안이 최대 300×300 = 90,000바이트라 한 스냅샷이 가벼워
 * 델타를 쌓는 것보다 단순하고 안전하다. (크기 변경도 그대로 커버된다.)
 */

const LIMIT = 60;
class History {
  constructor(pattern) {
    this.stack = [pattern.clone()];
    this.at = 0;
  }

  /** 현재 상태를 새 스냅샷으로 밀어넣는다. */
  push(pattern) {
    this.stack.length = this.at + 1;      // 재실행 가지 버리기
    this.stack.push(pattern.clone());
    if (this.stack.length > LIMIT) this.stack.shift();
    this.at = this.stack.length - 1;
  }

  /** 현재 상태를 되돌리지 않고 교체 (불러오기 직후 기준점 재설정). */
  reset(pattern) {
    this.stack = [pattern.clone()];
    this.at = 0;
  }

  /** 마지막으로 확정된 상태의 사본. 진행 중이던 편집을 취소할 때 쓴다. */
  current() {
    return this.stack[this.at]?.clone() ?? null;
  }

  get canUndo() { return this.at > 0; }
  get canRedo() { return this.at < this.stack.length - 1; }

  undo() {
    if (!this.canUndo) return null;
    this.at--;
    return this.stack[this.at].clone();
  }

  redo() {
    if (!this.canRedo) return null;
    this.at++;
    return this.stack[this.at].clone();
  }
}

// ===== js/storage.js =====
/** 브라우저 로컬 저장 + JSON 파일 입출력. */

const KEY = 'filet-crochet:pattern';
const KEY_VIEW = 'filet-crochet:view';
function savePattern(pattern) {
  const payload = { ...pattern.toJSON(), savedAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload.savedAt;
}

/** @returns {{ pattern: Pattern, savedAt: string|null } | null} */
function loadPattern() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return { pattern: Pattern.fromJSON(data), savedAt: data.savedAt ?? null };
  } catch {
    return null;
  }
}
function saveView(view) {
  try {
    localStorage.setItem(KEY_VIEW, JSON.stringify(view));
  } catch { /* 용량 초과 등은 무시 — 보기 설정은 없어도 그만 */ }
}
function loadView() {
  try {
    const raw = localStorage.getItem(KEY_VIEW);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function downloadJSON(pattern, filename) {
  const blob = new Blob([JSON.stringify(pattern.toJSON(), null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, filename);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @returns {Promise<Pattern>} */
function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.onload = () => {
      try {
        resolve(Pattern.fromJSON(JSON.parse(reader.result)));
      } catch (err) {
        reject(new Error(`가져오기 실패: ${err.message}`));
      }
    };
    reader.readAsText(file);
  });
}
function timestampName(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `filet-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

// ===== js/main.js =====
const $ = (id) => document.getElementById(id);

const MIN_CELL = 4;
const MAX_CELL = 48;

/**
 * 캔버스 한 변의 안전 상한(픽셀).
 * 브라우저마다 다르지만 대체로 16384가 한계라 여유를 두고 잡는다.
 * 넘으면 캔버스가 통째로 비어 아무것도 그려지지 않는다.
 */
const MAX_CANVAS_PX = 15000;

const state = {
  pattern: new Pattern(30, 30),
  history: null,
  tool: 'draw',
  cell: 18,
  view: { guides: true, numbers: true, symbols: false, boustrophedon: true },
  // 진행 중인 스트로크
  stroke: null,
  dirty: false,
};

const canvas = $('grid');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- 초기화

function init() {
  const savedView = loadView();
  if (savedView) {
    Object.assign(state.view, savedView.view ?? {});
    if (Number.isFinite(savedView.cell)) state.cell = clamp(savedView.cell, MIN_CELL, MAX_CELL);
    if (savedView.tool) state.tool = savedView.tool;
  }

  const saved = loadPattern();
  if (saved) {
    state.pattern = saved.pattern;
    setSaveHint(saved.savedAt);
  }
  state.history = new History(state.pattern);
  // 배율을 도안보다 먼저 읽으므로, 도안 크기를 안 뒤 다시 상한에 맞춘다.
  state.cell = clamp(state.cell, MIN_CELL, maxCellForPattern());

  syncControlsFromState();
  bindTools();
  bindCanvas();
  bindPanel();
  bindKeyboard();

  render();
  window.addEventListener('resize', () => render());
}

function syncControlsFromState() {
  $('in-cols').value = state.pattern.cols;
  $('in-rows').value = state.pattern.rows;
  $('opt-guides').checked = state.view.guides;
  $('opt-numbers').checked = state.view.numbers;
  $('opt-symbols').checked = state.view.symbols;
  for (const btn of document.querySelectorAll('.tool')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === state.tool));
  }
}

// ---------------------------------------------------------------- 렌더링

function themeColors() {
  const cs = getComputedStyle(document.body);
  const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    bg: pick('--surface', '#ffffff'),
    line: pick('--line', '#d9d5cc'),
    lineStrong: pick('--line-strong', '#b4ada0'),
    filled: pick('--cell-filled', '#2f2a24'),
    text: pick('--muted', '#6f6a60'),
  };
}

function render() {
  const { cell, view } = state;
  const size = canvasSize(state.pattern, cell, view.numbers);

  // 캔버스가 브라우저 한계를 넘으면 그리기가 통째로 실패한다 — 오류도 없이
  // 화면이 하얗게 비어 원인조차 알 수 없다. 큰 격자를 최대 배율로 확대하고
  // 고해상도 화면까지 겹치면 실제로 닿는다(예: 300칸 × 48px × DPR 3).
  // 그때는 선명도를 조금 포기하더라도 그려지는 쪽이 낫다.
  const dpr = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    MAX_CANVAS_PX / Math.max(size.width, size.height),
  ));

  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(ctx, state.pattern, {
    cell,
    guides: view.guides,
    numbers: view.numbers,
    symbols: view.symbols,
    colors: themeColors(),
  });

  $('zoom-label').textContent = `${Math.round((cell / 18) * 100)}%`;
  $('btn-undo').disabled = !state.history.canUndo;
  $('btn-redo').disabled = !state.history.canRedo;
  updateStatus();
}

function updateStatus() {
  const p = state.pattern;
  $('status-size').textContent = `${p.cols} × ${p.rows}칸`;
  const filled = p.countOf(FILLED);
  $('status-count').textContent = `채움 ${filled} / ${p.cells.length}`;
}

/**
 * 행별 지시문. 화면에는 띄우지 않고 인쇄·복사할 때만 만든다.
 * (인쇄물에 이미 들어가므로 패널에 상시 표시할 필요가 없다.)
 */
function currentReading() {
  return buildReading(state.pattern, { boustrophedon: state.view.boustrophedon });
}

// ---------------------------------------------------------------- 도구

function bindTools() {
  for (const btn of document.querySelectorAll('.tool')) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  }
  $('btn-zoom-in').addEventListener('click', () => setCell(state.cell + 2));
  $('btn-zoom-out').addEventListener('click', () => setCell(state.cell - 2));
  $('btn-zoom-fit').addEventListener('click', zoomToFit);
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-panel').addEventListener('click', () => $('panel').classList.toggle('open'));

  $('btn-move-up').addEventListener('click', () => movePattern(0, -1));
  $('btn-move-down').addEventListener('click', () => movePattern(0, 1));
  $('btn-move-left').addEventListener('click', () => movePattern(-1, 0));
  $('btn-move-right').addEventListener('click', () => movePattern(1, 0));
}

/**
 * 도안 전체를 한 칸 옮긴다.
 * 밖으로 나간 칸은 반대편으로 돌아 들어오므로 반대로 밀면 그대로 복구된다.
 */
function movePattern(dx, dy) {
  if (state.pattern.shift(dx, dy)) commit();
}

function setTool(tool) {
  state.tool = tool;
  syncControlsFromState();
  persistView();
}

/**
 * 이 격자에서 허용할 최대 칸 크기.
 * 칸이 커질수록 캔버스도 커지므로, 큰 격자에서는 확대 상한을 낮춰야 한다.
 */
function maxCellForPattern() {
  const p = state.pattern;
  const longest = Math.max(p.cols, p.rows);
  return clamp(Math.floor(MAX_CANVAS_PX / longest), MIN_CELL, MAX_CELL);
}

function setCell(next) {
  state.cell = clamp(Math.round(next), MIN_CELL, maxCellForPattern());
  persistView();
  render();
}

function zoomToFit() {
  const wrap = $('canvas-wrap');
  const padding = 32;
  const gut = state.view.numbers ? 1.2 : 0;   // 여백을 대략 한 칸 반으로 잡는다
  const availW = wrap.clientWidth - padding;
  const availH = wrap.clientHeight - padding;
  const cell = Math.min(
    availW / (state.pattern.cols + gut),
    availH / (state.pattern.rows + gut),
  );
  setCell(clamp(Math.floor(cell), MIN_CELL, MAX_CELL));
}

/** 현재 도구가 칠할 값. draw는 채움, erase는 비움. */
function toolValue() {
  return state.tool === 'erase' ? OPEN : FILLED;
}

// ---------------------------------------------------------------- 캔버스 입력

function bindCanvas() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    if (!state.stroke) $('status-pos').textContent = '–';
  });
  // 모바일 길게 누르기 메뉴 방지
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 마우스 휠 / 트랙패드 핀치 확대축소 (Ctrl+휠은 브라우저 확대라 가로챈다)
  $('canvas-wrap').addEventListener('wheel', onWheel, { passive: false });
}

/** 화면에 닿아 있는 손가락들. 핀치 판정에 쓴다. */
const pointers = new Map();

/** 두 손가락 사이 거리. */
function pinchDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 두 손가락의 중점 (캔버스 기준). */
function pinchCenter() {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

let pinch = null;

function onWheel(e) {
  // 확대축소 의도(Ctrl+휠 = 트랙패드 핀치)일 때만 가로채고,
  // 그냥 휠은 스크롤로 남겨둔다.
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomAround(state.cell * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
}

function cellAt(e) {
  const rect = canvas.getBoundingClientRect();
  return hitTest(
    state.pattern,
    e.clientX - rect.left,
    e.clientY - rect.top,
    state.cell,
    state.view.numbers,
  );
}

function onPointerDown(e) {
  // 마우스 보조 버튼은 무시한다. 터치·펜은 button이 0이라 그대로 통과.
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  if (e.pointerType === 'touch') {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 두 번째 손가락이 닿으면 핀치로 전환한다.
    // 첫 손가락이 이미 칠하고 있었다면 그 획을 취소해 실수로 그려지지 않게 한다.
    if (pointers.size === 2) {
      cancelStroke();
      pinch = { dist: pinchDistance(), cell: state.cell };
      return;
    }
    if (pointers.size > 2) return;
  }

  const at = cellAt(e);
  if (!at) return;

  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();

  const tool = state.tool;

  if (tool === 'fill') {
    if (state.pattern.floodFill(at.x, at.y, FILLED)) commit();
    return;
  }

  // 칠하기/지우기.
  //
  // 한 칸만 톡 누르면(탭) 그 칸을 토글하고, 끌면(드래그) 버튼 상태대로 칠한다.
  // 탭인지 드래그인지는 손을 뗄 때 정해지므로, 판정에 필요한 정보를 들고 간다.
  // 이렇게 하면 한 칸씩 고칠 때는 도구를 바꿀 필요가 없고, 길게 칠할 때는
  // 시작 칸이 어떤 상태든 획 전체가 뒤집히지 않는다.
  state.stroke = {
    tool,
    value: toolValue(),
    start: at,
    startValue: state.pattern.get(at.x, at.y),
    last: at,
    moved: false,
    changed: false,
    pointerId: e.pointerId,
  };
  paintCell(at.x, at.y);
}

function onPointerMove(e) {
  if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      e.preventDefault();
      const c = pinchCenter();
      zoomAround(pinch.cell * (pinchDistance() / pinch.dist), c.x, c.y);
      return;
    }
  }

  const at = cellAt(e);
  $('status-pos').textContent = at
    ? `열 ${state.pattern.cols - at.x}, 행 ${state.pattern.rows - at.y}`
    : '–';

  const s = state.stroke;
  if (!s || s.pointerId !== e.pointerId || !at) return;
  e.preventDefault();

  // 시작 칸을 벗어나면 드래그로 간주한다 (손을 뗄 때 탭 토글을 적용하지 않는다).
  if (at.x !== s.start.x || at.y !== s.start.y) s.moved = true;

  // 빠르게 움직이면 포인터 이벤트가 칸을 건너뛴다 — 직선으로 이어 칠한다.
  lineCells(s.last, at, (x, y) => paintCell(x, y));
  s.last = at;
}

function onPointerUp(e) {
  if (e.pointerType === 'touch') {
    pointers.delete(e.pointerId);
    // 손가락이 하나 이하로 줄면 핀치 종료. 남은 손가락으로 이어 그리지는 않는다.
    if (pointers.size < 2 && pinch) {
      pinch = null;
      return;
    }
  }

  const s = state.stroke;
  if (!s || s.pointerId !== e.pointerId) return;
  state.stroke = null;

  // 한 칸에서 손을 뗐으면(탭) 그 칸을 토글한다.
  // 이미 버튼 값대로 칠해져 있으므로, 원래 값이 같았을 때만 반대로 뒤집으면 된다.
  if (!s.moved && s.startValue === s.value) {
    const flipped = s.value === FILLED ? OPEN : FILLED;
    if (state.pattern.set(s.start.x, s.start.y, flipped)) s.changed = true;
  }

  s.changed ? commit() : render();
}

/** 진행 중이던 획을 되돌린다 (핀치로 전환될 때). */
function cancelStroke() {
  const s = state.stroke;
  state.stroke = null;
  if (!s) return;
  // draw/erase는 이미 칸을 바꿔놨으므로 마지막 확정 상태로 되돌린다.
  if (s.changed) {
    const restored = state.history.current();
    if (restored) state.pattern = restored;
  }
  render();
}

/**
 * 화면상의 한 점(clientX/Y)을 고정한 채 배율을 바꾼다.
 * 그래야 핀치할 때 손가락 아래 지점이 제자리에 머문다.
 */
function zoomAround(nextCell, clientX, clientY) {
  const wrap = $('canvas-wrap');
  const before = canvas.getBoundingClientRect();
  // 캔버스 내 상대 위치 (0~1)
  const rx = (clientX - before.left) / before.width;
  const ry = (clientY - before.top) / before.height;

  const prev = state.cell;
  state.cell = clamp(Math.round(nextCell), MIN_CELL, maxCellForPattern());
  if (state.cell === prev) return;
  persistView();
  render();

  // 배율이 바뀐 뒤, 같은 지점이 같은 화면 좌표에 오도록 스크롤 보정
  const after = canvas.getBoundingClientRect();
  wrap.scrollLeft += (after.left + rx * after.width) - clientX;
  wrap.scrollTop += (after.top + ry * after.height) - clientY;
}

function paintCell(x, y) {
  const s = state.stroke;
  if (state.pattern.set(x, y, s.value)) {
    s.changed = true;
    render();
  }
}

/** 브레젠험 직선 — 두 칸 사이를 빈틈없이 잇는다. */
function lineCells(a, b, fn) {
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    fn(x, y);
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// ---------------------------------------------------------------- 변경 확정

/** 편집 한 건이 끝났을 때: 히스토리에 쌓고, 자동 저장하고, 다시 그린다. */
function commit() {
  state.history.push(state.pattern);
  render();
  autosave();
}

let autosaveTimer = null;

function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      setSaveHint(savePattern(state.pattern));
    } catch {
      toast('자동 저장 실패 (저장 공간 부족)');
    }
  }, 600);
}

function undo() {
  const p = state.history.undo();
  if (!p) return;
  state.pattern = p;
  syncControlsFromState();
  render();
  autosave();
}

function redo() {
  const p = state.history.redo();
  if (!p) return;
  state.pattern = p;
  syncControlsFromState();
  render();
  autosave();
}

// ---------------------------------------------------------------- 패널

function bindPanel() {
  $('btn-resize').addEventListener('click', applyResize);
  for (const id of ['in-cols', 'in-rows']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') applyResize(); });
  }

  bindCheckbox('opt-guides', 'guides');
  bindCheckbox('opt-numbers', 'numbers');
  bindCheckbox('opt-symbols', 'symbols');

  $('btn-export-json').addEventListener('click', () => {
    downloadJSON(state.pattern, timestampName('json'));
  });

  $('btn-import-json').addEventListener('click', () => $('file-json').click());
  $('file-json').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                      // 같은 파일 다시 고를 수 있게
    if (!file) return;
    try {
      state.pattern = await readJSONFile(file);
      state.history.reset(state.pattern);
      state.cell = clamp(state.cell, MIN_CELL, maxCellForPattern());
      syncControlsFromState();
      render();
      autosave();
      toast('가져왔습니다.');
    } catch (err) {
      toast(err.message);
    }
  });

  $('btn-png').addEventListener('click', exportPNG);
  $('btn-print').addEventListener('click', printPattern);

  // 비우기·반전은 상단바에 있다. 확인 창 없이 바로 실행하고,
  // 실수하면 실행취소(↶)로 되돌린다 — 매번 묻는 쪽이 더 번거롭다.
  $('btn-clear-top').addEventListener('click', () => {
    if (!state.pattern.countOf(FILLED)) return toast('이미 비어 있습니다.');
    state.pattern.clear();
    commit();
    toast('전체 비웠습니다. 되돌리려면 ↶');
  });

  $('btn-invert-top').addEventListener('click', () => {
    state.pattern.invert();
    commit();
    toast('반전했습니다. 되돌리려면 ↶');
  });
}

function bindCheckbox(id, key) {
  $(id).addEventListener('change', (e) => {
    state.view[key] = e.target.checked;
    persistView();
    render();
  });
}

function applyResize() {
  const cols = clamp(parseInt($('in-cols').value, 10) || state.pattern.cols, 1, MAX_SIDE);
  const rows = clamp(parseInt($('in-rows').value, 10) || state.pattern.rows, 1, MAX_SIDE);
  if (cols === state.pattern.cols && rows === state.pattern.rows) {
    syncControlsFromState();
    return;
  }

  const shrinks = cols < state.pattern.cols || rows < state.pattern.rows;
  if (shrinks && losesFilledCells(state.pattern, cols, rows) &&
      !confirm('크기를 줄이면 바깥쪽 채운 칸이 사라집니다. 계속할까요?')) {
    syncControlsFromState();
    return;
  }

  state.pattern = state.pattern.resized(cols, rows);
  // 격자가 커지면 지금 배율이 캔버스 한계를 넘길 수 있다 — 상한에 맞춰 낮춘다.
  state.cell = clamp(state.cell, MIN_CELL, maxCellForPattern());
  syncControlsFromState();
  commit();
}

function losesFilledCells(p, cols, rows) {
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if ((x >= cols || y >= rows) && p.get(x, y) !== OPEN) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- 내보내기

/** 화면 배율과 무관하게 인쇄에 쓸 만한 해상도로 다시 그린다. */
function renderForExport(cellPx = 22) {
  const p = state.pattern;
  const size = canvasSize(p, cellPx, state.view.numbers);
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  const octx = out.getContext('2d');
  draw(octx, p, {
    cell: cellPx,
    guides: state.view.guides,
    numbers: state.view.numbers,
    symbols: state.view.symbols,
    // 종이·이미지에서는 항상 흑백으로 — 다크 모드 색이 새어나가지 않게 한다
    colors: {
      bg: '#ffffff',
      line: '#c9c9c9',
      lineStrong: '#333333',
      filled: '#1a1a1a',
      text: '#555555',
    },
  });
  return out;
}

function exportPNG() {
  renderForExport().toBlob((blob) => {
    if (!blob) return toast('PNG 생성에 실패했습니다.');
    downloadBlob(blob, timestampName('png'));
    toast('PNG를 저장했습니다.');
  }, 'image/png');
}

function printPattern() {
  const p = state.pattern;
  $('print-title').textContent = `방안 뜨기 도안 — ${p.cols} × ${p.rows}칸`;
  $('print-img').src = renderForExport().toDataURL('image/png');
  $('print-reading').innerHTML = readingToHTML(currentReading());

  const img = $('print-img');
  if (img.complete) window.print();
  else img.onload = () => window.print();
}

// ---------------------------------------------------------------- 키보드

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case 'b': setTool('draw'); break;
      case 'e': setTool('erase'); break;
      case 'g': setTool('fill'); break;
      case '+': case '=': setCell(state.cell + 2); break;
      case '-': case '_': setCell(state.cell - 2); break;
      case '0': zoomToFit(); break;
      // 방향키로도 도안 전체를 옮긴다 (버튼과 같은 동작)
      case 'arrowup': movePattern(0, -1); break;
      case 'arrowdown': movePattern(0, 1); break;
      case 'arrowleft': movePattern(-1, 0); break;
      case 'arrowright': movePattern(1, 0); break;
      default: return;
    }
    e.preventDefault();
  });
}

// ---------------------------------------------------------------- 잡다

function persistView() {
  saveView({ view: state.view, cell: state.cell, tool: state.tool });
}

function setSaveHint(iso) {
  if (!iso) return;
  const d = new Date(iso);
  $('save-hint').textContent = `자동 저장됨: ${d.toLocaleString('ko-KR')}`;
}

let toastTimer = null;

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

init();

})();
