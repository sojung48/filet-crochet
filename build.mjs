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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// 의존 순서대로. main은 나머지를 모두 쓰므로 마지막.
const FILES = ['pattern.js', 'renderer.js', 'reading.js', 'history.js', 'storage.js', 'image.js', 'text.js', 'main.js'];

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

// 이름 충돌 검사.
//
// 모듈들이 한 스코프로 합쳐지므로, 두 파일이 같은 이름을 최상위에 선언하면
// 뒤엣것이 앞엣것을 조용히 덮어쓴다. ES 모듈로 열어볼 때는 멀쩡해서
// 눈치채기 어렵다(실제로 image.js와 text.js가 toPattern으로 겹쳤다).
const seen = new Map();
const dupes = [];
FILES.forEach((f, i) => {
  const decl = /^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of parts[i].matchAll(decl)) {
    const name = m[1];
    if (seen.has(name)) dupes.push(`${name}  (js/${seen.get(name)} ↔ js/${f})`);
    else seen.set(name, f);
  }
});
if (dupes.length) {
  console.error('오류: 최상위 이름이 겹칩니다 — 뒤엣것이 앞엣것을 덮어씁니다.');
  for (const d of dupes) console.error('  ' + d);
  process.exit(1);
}

const out = `/* 자동 생성 파일 — 편집하지 말 것. 원본은 js/*.js, 재생성은 "node build.mjs" */
(function () {
'use strict';

${parts.join('\n')}
})();
`;

writeFileSync(join(root, 'js', 'bundle.js'), out, 'utf8');

// 캐시 무력화.
//
// GitHub Pages는 파일을 10분간 캐시하라고 알려준다(max-age=600). 그래서
// 새로 배포해도 폰이 옛 bundle.js를 계속 쓸 수 있고, HTML만 새것이 되면
// 둘이 어긋나 이상하게 동작한다. 파일 내용의 해시를 주소 뒤에 붙이면
// 내용이 바뀔 때마다 주소가 달라져 캐시가 끼어들 자리가 없다.
const hash = createHash('sha256').update(out).digest('hex').slice(0, 8);
const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const patched = html.replace(
  /(<script defer src="js\/bundle\.js)(\?v=[a-f0-9]+)?(">)/,
  `$1?v=${hash}$3`,
);
if (patched === html && !html.includes(`bundle.js?v=${hash}`)) {
  console.warn('경고: index.html의 스크립트 태그를 찾지 못해 버전을 붙이지 못했습니다.');
} else if (patched !== html) {
  writeFileSync(htmlPath, patched, 'utf8');
}

console.log(`js/bundle.js 생성 완료 (${(out.length / 1024).toFixed(1)} KB, v=${hash})`);
