/** 브라우저 로컬 저장 + JSON 파일 입출력. */

import { Pattern } from './pattern.js';

const KEY = 'filet-crochet:pattern';
const KEY_VIEW = 'filet-crochet:view';

export function savePattern(pattern) {
  const payload = { ...pattern.toJSON(), savedAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload.savedAt;
}

/** @returns {{ pattern: Pattern, savedAt: string|null } | null} */
export function loadPattern() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return { pattern: Pattern.fromJSON(data), savedAt: data.savedAt ?? null };
  } catch {
    return null;
  }
}

export function saveView(view) {
  try {
    localStorage.setItem(KEY_VIEW, JSON.stringify(view));
  } catch { /* 용량 초과 등은 무시 — 보기 설정은 없어도 그만 */ }
}

export function loadView() {
  try {
    const raw = localStorage.getItem(KEY_VIEW);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function downloadJSON(pattern, filename) {
  const blob = new Blob([JSON.stringify(pattern.toJSON(), null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob, filename) {
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
export function readJSONFile(file) {
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

export function timestampName(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `filet-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
