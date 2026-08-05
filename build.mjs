/**
 * js/*.js 모듈들을 하나의 일반 스크립트(js/bundle.js)로 합친다.
 *
 * 왜 필요한가: ES 모듈은 file:// 에서 CORS로 차단되어, index.html을 그냥
 * 더블클릭하면 아무것도 뜨지 않는다. 번들은 <script defer>로 불러오므로
 * 서버 없이 더블클릭만으로 동작한다.
 *
 * 실행:  node build.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// 의존 순서대로. main은 나머지를 모두 쓰므로 마지막.
const FILES = ['pattern.js', 'renderer.js', 'reading.js', 'history.js', 'storage.js', 'main.js'];

const strip = (src) => src
  // import 문 제거 (같은 스코프에 합쳐지므로 불필요)
  .replace(/^\s*import\s+[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
  // export 키워드만 떼고 선언은 남긴다
  .replace(/^\s*export\s+(?=(const|let|var|function|class|async))/gm, '');

const parts = FILES.map((f) => {
  const src = readFileSync(join(root, 'js', f), 'utf8');
  return `// ===== js/${f} =====\n${strip(src).trim()}\n`;
});

const out = `/* 자동 생성 파일 — 편집하지 말 것. 원본은 js/*.js, 재생성은 "node build.mjs" */
(function () {
'use strict';

${parts.join('\n')}
})();
`;

writeFileSync(join(root, 'js', 'bundle.js'), out, 'utf8');
console.log(`js/bundle.js 생성 완료 (${(out.length / 1024).toFixed(1)} KB)`);
