/**
 * 행별 지시문 생성.
 *
 * 실제 뜨기 순서를 따른다:
 *  - 1행은 맨 아래 (격자 화면상 마지막 행)
 *  - 지그재그(boustrophedon): 홀수행은 오른쪽→왼쪽, 짝수행은 왼쪽→오른쪽
 */

import { FILLED } from './pattern.js';

/**
 * @returns {{ row:number, dir:'→'|'←', text:string, runs:Array }[]} 1행부터 순서대로
 */
export function buildReading(pattern, { boustrophedon = true } = {}) {
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
export function readingToText(lines, { boustrophedon = true } = {}) {
  const head = boustrophedon
    ? '※ 1행은 맨 아래, 홀수행 ←(오른쪽→왼쪽) / 짝수행 →(왼쪽→오른쪽)'
    : '※ 1행은 맨 아래, 모든 행 ←(오른쪽→왼쪽)';
  const body = lines.map((l) => `${l.row}행 ${l.dir}: ${l.text}`).join('\n');
  return `${head}\n\n${body}\n`;
}

/** 패널·인쇄 영역용 HTML. */
export function readingToHTML(lines) {
  if (!lines.length) return '<p class="empty">격자가 비어 있습니다.</p>';
  return lines
    .map((l) => `<div class="row-line"><span class="row-no">${l.row}행 ${l.dir}</span> ${escapeHTML(l.text)}</div>`)
    .join('');
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
