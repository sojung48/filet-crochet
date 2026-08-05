/**
 * 실행취소/재실행.
 *
 * 스냅샷 방식. 도안이 최대 300×300 = 90,000바이트라 한 스냅샷이 가벼워
 * 델타를 쌓는 것보다 단순하고 안전하다. (크기 변경도 그대로 커버된다.)
 */

const LIMIT = 60;

export class History {
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
