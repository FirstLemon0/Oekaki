/**
 * スナップショット方式の Undo/Redo スタック（ジェネリック）。
 * T は不変値として扱う（ストローク列なら配列を作り直して commit する。中身の Stroke は共有してよい）。
 */
export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;
  private readonly limit: number;

  constructor(initial: T, limit = 200) {
    this.current = initial;
    this.limit = Math.max(1, limit);
  }

  get present(): T {
    return this.current;
  }

  /** 新しい状態を 1 操作として積む。Redo 列は捨てる。 */
  commit(next: T): void {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.current = next;
    this.future = [];
  }

  /** 1 つ戻す。戻せないときは undefined。 */
  undo(): T | undefined {
    if (this.past.length === 0) return undefined;
    const prev = this.past.pop() as T;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  /** 1 つ進める。進めないときは undefined。 */
  redo(): T | undefined {
    if (this.future.length === 0) return undefined;
    const next = this.future.pop() as T;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 履歴を捨てて状態を置き換える（読み込み時）。 */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = state;
  }
}
