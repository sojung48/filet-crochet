import { Pattern, OPEN, FILLED, MAX_SIDE } from './pattern.js';
import { draw, hitTest, canvasSize } from './renderer.js';
import { buildReading, readingToHTML } from './reading.js';
import { History } from './history.js';
import {
  savePattern, loadPattern, saveView, loadView,
  downloadJSON, downloadBlob, readJSONFile, timestampName,
} from './storage.js';

const $ = (id) => document.getElementById(id);

const MIN_CELL = 4;
const MAX_CELL = 48;

/**
 * 캔버스 한 변의 안전 상한(픽셀).
 * 브라우저마다 다르지만 대체로 16384가 한계라 여유를 두고 잡는다.
 * 넘으면 캔버스가 통째로 비어 아무것도 그려지지 않는다.
 */
const MAX_CANVAS_PX = 15000;

/** 오른쪽 패널의 탭. 순서가 화면 순서다. */
const TABS = ['pattern', 'image', 'text'];

const state = {
  pattern: new Pattern(30, 30),
  history: null,
  tool: 'draw',
  cell: 18,
  view: { guides: true, numbers: true, symbols: false, boustrophedon: true },
  tab: 'pattern',
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
    // 저장된 이름이 지금 없는 탭일 수도 있다(탭 이름을 바꾼 뒤 옛 설정을 읽는 경우)
    if (TABS.includes(savedView.tab)) state.tab = savedView.tab;
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
  for (const name of TABS) {
    const selected = name === state.tab;
    $(`tab-${name}`).setAttribute('aria-selected', String(selected));
    $(`panel-${name}`).hidden = !selected;
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
  bindTabs();
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

function bindTabs() {
  for (const name of TABS) {
    $(`tab-${name}`).addEventListener('click', () => setTab(name));
  }

  // 좌우 방향키로 탭 이동 (탭에 초점이 있을 때만).
  // 캔버스 쪽 방향키는 도안 전체 이동이므로 서로 겹치지 않는다.
  $('panel').addEventListener('keydown', (e) => {
    if (!e.target.classList?.contains('tab')) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(state.tab) + step + TABS.length) % TABS.length];
    setTab(next);
    $(`tab-${next}`).focus();
  });
}

function setTab(name) {
  if (!TABS.includes(name) || name === state.tab) return;
  state.tab = name;
  syncControlsFromState();
  persistView();
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
  saveView({ view: state.view, cell: state.cell, tool: state.tool, tab: state.tab });
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
