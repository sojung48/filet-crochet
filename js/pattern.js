/**
 * 도안 데이터 모델.
 *
 * 칸 값은 boolean이 아니라 팔레트 인덱스(0 = 비움, 1 = 채움)로 둔다.
 * 2단계에서 다색 그래프 도안으로 확장할 때 저장 포맷을 그대로 쓰기 위함.
 */

export const OPEN = 0;
export const FILLED = 1;

/** 팔레트. 인덱스 순서가 곧 칸 값이다. */
export const DEFAULT_PALETTE = [
  { name: '비움', css: 'transparent' },
  { name: '채움', css: 'var(--cell-filled)' },
];

/**
 * 격자 한 변의 최대 칸 수.
 *
 * 300까지 열어두면 최대 배율·고해상도 화면과 겹칠 때 캔버스가 브라우저
 * 한계를 넘어 화면이 통째로 비어버린다. 실행취소 스냅샷 메모리도 함께
 * 커진다. 실제 뜨개 도안은 100칸이면 충분히 크다.
 */
export const MAX_SIDE = 100;

/**
 * 이미 만들어 둔 도안을 열 때만 허용하는 상한.
 * 상한을 낮추기 전에 저장한 파일이 갑자기 안 열리면 안 되므로,
 * 새로 만들 때(MAX_SIDE)보다 넉넉하게 받아준다.
 */
export const MAX_SIDE_IMPORT = 300;

export class Pattern {
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
