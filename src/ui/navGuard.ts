/**
 * 「描いた線が消える」離脱のガード（実機フィードバック: 戻るで 3 回データが消えた）。
 *
 * キャンバスに保存していない線があるあいだ、CanvasScreen が `armLeaveGuard(ask)` で登録する。
 * - 画面の「戻る」「✕」: `requestLeave(proceed)` を通すと、ガード中は ask(proceed) で確認を出す
 * - 端末の戻る（popstate）: 同じ URL の履歴を 1 段積んでおき、戻られたら積み直して ask(既定の戻り先) を出す
 * - ブラウザを閉じる（beforeunload）: ガード中はブラウザ標準の確認を出す
 *
 * アプリ内の移動（router.navigate）は、積んだ 1 段を先に戻してから行う（`navigateAfterGuard`）。
 * そうしないと、移動のあとに同じ URL の履歴が残り、端末の戻るで描き終えた画面へ戻ってしまう。
 */

const KEY = 'seichotsuLeaveGuard';

type Ask = (proceed: () => void) => void;

interface Active {
  ask: Ask;
  /** 端末の戻るで「戻る」を選んだときの行き先（画面の戻るボタンと同じ） */
  fallback: () => void;
}

let active: Active | null = null;
/** 積んだ 1 段を自分で戻している最中 */
let popping = false;
/** 戻し終えたら行う移動 */
let pending: (() => void) | null = null;
let installed = false;

function hasHistory(): boolean {
  return typeof history !== 'undefined' && typeof location !== 'undefined' && typeof window !== 'undefined';
}

function onTop(): boolean {
  const st = history.state as Record<string, unknown> | null;
  return Boolean(st && typeof st === 'object' && st[KEY] === true);
}

function push(): void {
  history.pushState({ [KEY]: true }, '', location.href);
}

function onPopState(): void {
  if (popping) {
    popping = false;
    const run = pending;
    pending = null;
    if (run) run();
    // 戻している間にまた描き始めた: 積み直す
    else if (active && !onTop()) push();
    return;
  }
  if (!active || onTop()) return;
  // 端末の戻る: 積んだ 1 段が消えた（URL は同じなのでルートは変わらない）。積み直して確かめる
  push();
  const a = active;
  a.ask(a.fallback);
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!active) return;
  e.preventDefault();
  // 古いブラウザ向け（文言はブラウザ標準のものが出る）
  e.returnValue = '';
}

function install(): void {
  if (installed || !hasHistory()) return;
  installed = true;
  window.addEventListener('popstate', onPopState);
  window.addEventListener('beforeunload', onBeforeUnload);
}

/**
 * ガードを張る（保存していない線があるあいだ）。戻り値で外す。
 * ask: 確認を出す（「戻る」を選んだら proceed を呼ぶ）。fallback: 端末の戻るで「戻る」を選んだときの行き先。
 */
export function armLeaveGuard(ask: Ask, fallback: () => void): () => void {
  if (!hasHistory()) return () => undefined;
  install();
  const me: Active = { ask, fallback };
  active = me;
  if (!onTop() && !popping) push();
  return () => {
    if (active !== me) return;
    active = null;
    dropGuardEntry();
  };
}

/** 積んだ 1 段を戻す（無ければ何もしない）。戻し終えたら then を呼ぶ */
function dropGuardEntry(then?: () => void): void {
  if (popping) {
    if (then) pending = then;
    return;
  }
  if (!onTop()) {
    then?.();
    return;
  }
  popping = true;
  pending = then ?? null;
  history.back();
}

/** ガード中か（保存していない線がある） */
export function isLeaveGuarded(): boolean {
  return active !== null;
}

/**
 * 画面の「戻る」「✕」から呼ぶ。ガード中なら確認を出し、「戻る」を選んだら proceed。ガードが無ければすぐ proceed。
 */
export function requestLeave(proceed: () => void): void {
  if (active) active.ask(proceed);
  else proceed();
}

/**
 * アプリ内の移動（router.navigate から呼ぶ）。積んだ 1 段があれば先に戻してから go を行う。
 * 移動するのでガードは外す（確認は requestLeave で済んでいる前提。保存して進むときは確認しない）。
 */
export function navigateAfterGuard(go: () => void): void {
  if (!hasHistory()) {
    go();
    return;
  }
  active = null;
  if (onTop() || popping) dropGuardEntry(go);
  else go();
}

/** テスト用: 状態を初期化する */
export function resetLeaveGuardForTest(): void {
  if (installed && typeof window !== 'undefined') {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('beforeunload', onBeforeUnload);
  }
  active = null;
  popping = false;
  pending = null;
  installed = false;
}
