/**
 * 이미지 → 도안 변환.
 *
 * 사진을 격자 크기로 줄인 뒤 칸마다 밝기를 재서 채움/비움을 정한다.
 * 색은 2색만 쓴다 — 필레 크로셰가 원래 채움/비움 기법이고, 다색으로
 * 가려면 renderer·reading·invert까지 함께 고쳐야 한다(PLAN.md 3단계).
 *
 * 원본은 세션 동안만 메모리에 들고 있는다. localStorage에 넣지 않는다 —
 * 사진 한 장이 몇 MB라 자동 저장이 통째로 실패할 수 있다.
 */

import { Pattern, OPEN, FILLED } from './pattern.js';

/**
 * 받아줄 이미지 파일 크기 상한.
 *
 * 폰 사진첩에서 고르면 10MB를 넘는 일이 흔하다. 큰 파일은 디코딩 도중
 * 탭이 멈춘 것처럼 보이므로, 열기 전에 잘라내고 이유를 알려주는 편이 낫다.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * 디코딩한 이미지의 긴 변 상한(픽셀).
 *
 * 어차피 100칸 이하로 줄일 것이라 원본 해상도를 그대로 들고 있을 이유가
 * 없다. 4000×3000 사진을 통째로 메모리에 두면 폰에서 탭이 죽는다.
 */
const MAX_SOURCE_PX = 1600;

export const DEFAULT_OPTIONS = {
  threshold: 128,   // 이 값보다 어두우면 채운다
  invert: false,    // 밝고 어두움을 뒤집는다 (어두운 배경 그림용)
  dither: false,    // 점묘로 중간 밝기를 표현한다
  contain: true,    // 비율 유지(여백 생김) / 끄면 격자에 꽉 채워 늘린다
};

/**
 * 세션 동안 살아 있는 원본 이미지.
 * 도안 크기가 바뀌면 여기서 다시 변환한다 — 이미 격자로 줄인 결과를
 * 또 늘리면 계단이 생기기 때문이다.
 */
export class SourceImage {
  constructor(bitmap, name) {
    this.bitmap = bitmap;
    this.name = name;
    /** 밝기 캐시. 격자 크기가 같으면 다시 계산하지 않는다. */
    this._cache = null;
  }

  get width() { return this.bitmap.width; }
  get height() { return this.bitmap.height; }

  /** 더 이상 안 쓸 때 GPU/메모리 자원을 놓아준다. */
  close() {
    this.bitmap.close?.();
    this.bitmap = null;
    this._cache = null;
  }

  /**
   * 격자 크기로 줄인 뒤 칸마다 밝기(0~255)를 잰다.
   *
   * 캔버스의 이미지 축소는 영역 평균을 내주므로, 칸 하나가 원본 여러
   * 픽셀을 대표하게 된다. 한 점만 찍어 고르면(nearest) 노이즈에 휘둘린다.
   *
   * @returns {{ lum: Float32Array, cols: number, rows: number }}
   */
  luminance(cols, rows, contain) {
    const c = this._cache;
    if (c && c.cols === cols && c.rows === rows && c.contain === contain) return c;

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 여백은 흰색으로 둔다. 임계값 판정에서 "밝음 = 비움"이 되어
    // 그림이 없는 자리가 저절로 빈칸이 된다.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cols, rows);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const box = contain
      ? fitContain(this.width, this.height, cols, rows)
      : { x: 0, y: 0, w: cols, h: rows };
    ctx.drawImage(this.bitmap, box.x, box.y, box.w, box.h);

    const { data } = ctx.getImageData(0, 0, cols, rows);
    const lum = new Float32Array(cols * rows);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      const a = data[p + 3] / 255;
      // 투명한 곳은 흰 종이 위에 놓인 것으로 친다 (PNG 배경 투명 대응)
      const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      lum[i] = g * a + 255 * (1 - a);
    }

    this._cache = { lum, cols, rows, contain };
    return this._cache;
  }
}

/** 비율을 지키며 격자 안에 넣을 때의 위치와 크기. */
function fitContain(sw, sh, cols, rows) {
  const scale = Math.min(cols / sw, rows / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (cols - w) / 2, y: (rows - h) / 2, w, h };
}

/**
 * 파일을 읽어 SourceImage로 만든다.
 * @returns {Promise<SourceImage>}
 */
export async function loadImageFile(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일이 아닙니다.');
  }
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`파일이 너무 큽니다 (${mb}MB). ${MAX_FILE_BYTES / 1024 / 1024}MB 이하만 됩니다.`);
  }

  const bitmap = await decode(file);
  const shrunk = await shrinkIfHuge(bitmap);
  return new SourceImage(shrunk, file.name);
}

async function decode(file) {
  // createImageBitmap이 EXIF 회전까지 처리해준다 — 폰 사진이 눕지 않는다.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* 아래 <img> 방식으로 넘어간다 */ }
  }
  return await decodeWithImgTag(file);
}

/** createImageBitmap이 없거나 실패한 브라우저용 대비책. */
function decodeWithImgTag(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽지 못했습니다. 다른 파일을 골라보세요.'));
    };
    img.src = url;
  });
}

/** 큰 사진은 미리 줄여 둔다. 어차피 100칸 이하로 쓸 것이다. */
async function shrinkIfHuge(bitmap) {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_SOURCE_PX) return bitmap;

  const scale = MAX_SOURCE_PX / longest;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return typeof createImageBitmap === 'function'
    ? await createImageBitmap(canvas)
    : canvas;
}

/**
 * 원본을 격자 크기의 도안으로 바꾼다.
 * @returns {Pattern}
 */
export function toPattern(source, cols, rows, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { lum } = source.luminance(cols, rows, opts.contain);
  const pattern = new Pattern(cols, rows);

  const cells = opts.dither
    ? ditherCells(lum, cols, rows, opts)
    : thresholdCells(lum, opts);

  pattern.cells.set(cells);
  return pattern;
}

function thresholdCells(lum, opts) {
  const out = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    const dark = lum[i] < opts.threshold;
    out[i] = (dark !== opts.invert) ? FILLED : OPEN;
  }
  return out;
}

/**
 * 플로이드-스타인버그 디더링.
 *
 * 2색뿐이라 중간 밝기가 통째로 날아간다. 오차를 옆·아래 칸으로 흘려보내면
 * 점의 밀도로 회색이 표현된다 — 신문 사진과 같은 원리다.
 *
 * 임계값 슬라이더는 여기서도 밝기 기준점으로 쓴다(가운데 128이 기본).
 */
function ditherCells(lum, cols, rows, opts) {
  const buf = Float32Array.from(lum);
  if (opts.invert) {
    for (let i = 0; i < buf.length; i++) buf[i] = 255 - buf[i];
  }

  // 임계값을 옮긴 만큼 전체 밝기를 밀어준다. 그래야 슬라이더가
  // 디더링에서도 "더 진하게 / 더 옅게"로 작동한다.
  const bias = 128 - opts.threshold;
  const out = new Uint8Array(buf.length);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const old = buf[i] + bias;
      const filled = old < 128;
      out[i] = filled ? FILLED : OPEN;

      // 실제로 찍은 값과의 차이를 아직 안 지나간 칸에 나눠준다
      const err = old - (filled ? 0 : 255);
      spread(buf, cols, rows, x + 1, y,     err * 7 / 16);
      spread(buf, cols, rows, x - 1, y + 1, err * 3 / 16);
      spread(buf, cols, rows, x,     y + 1, err * 5 / 16);
      spread(buf, cols, rows, x + 1, y + 1, err * 1 / 16);
    }
  }
  return out;
}

function spread(buf, cols, rows, x, y, amount) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return;
  buf[y * cols + x] += amount;
}
