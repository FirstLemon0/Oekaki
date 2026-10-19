/**
 * 新しい版（Service Worker）が有効になったときの再読み込みの判断（UR-002 / ADR-0007 D7、受け入れ ilust-update-defer）。
 *
 * registerType 'autoUpdate' の既定は「新しい SW が activated になったら無条件に再読み込み」で、描いている途中の絵が消えうる。
 * ここでは自由お絵描き（#/free）に保存していない線があるあいだ（navGuard のガード中）だけ再読み込みを保留し、
 * 「更新があります（保存後に再読み込み）」と知らせる。保存か破棄でガードが外れたら再読み込みする。ほかの画面は今のまま（すぐ再読み込み）。
 */

export const UPDATE_DEFERRED_MESSAGE = '更新があります（保存後に再読み込み）';

/** ガードが外れてから再読み込みするまでの待ち（保存の後の画面の移動を先に終わらせる） */
export const RELOAD_AFTER_RELEASE_MS = 500;

export interface ReloadDeps {
  /** 今の画面が自由お絵描き（#/free）か */
  isFreeDraw(): boolean;
  /** 保存していない線があるか（navGuard のガード中か） */
  isGuarded(): boolean;
  /** ガードの有無の変化を購読する。戻り値で解除 */
  onGuardChange(cb: (guarded: boolean) => void): () => void;
  reload(): void;
  notify(message: string): void;
  setTimer?(fn: () => void, ms: number): unknown;
}

export interface ReloadController {
  /** registerSW の onNeedReload から呼ぶ。すぐ再読み込みしたら 'reloaded'、保留したら 'deferred' */
  needReload(): 'reloaded' | 'deferred';
  /** 保留中か */
  isPending(): boolean;
}

export function createReloadController(deps: ReloadDeps): ReloadController {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let pending = false;
  let off: (() => void) | null = null;

  const release = () => {
    off?.();
    off = null;
    setTimer(() => {
      // 待っている間にまた描き始めた（#/free でガード中）: もう一度待つ
      if (deps.isFreeDraw() && deps.isGuarded()) {
        off = deps.onGuardChange((guarded) => {
          if (!guarded) release();
        });
        return;
      }
      pending = false;
      deps.reload();
    }, RELOAD_AFTER_RELEASE_MS);
  };

  return {
    needReload() {
      if (!(deps.isFreeDraw() && deps.isGuarded())) {
        if (pending) return 'deferred';
        deps.reload();
        return 'reloaded';
      }
      if (!pending) {
        pending = true;
        deps.notify(UPDATE_DEFERRED_MESSAGE);
        off = deps.onGuardChange((guarded) => {
          if (!guarded) release();
        });
      }
      return 'deferred';
    },
    isPending: () => pending,
  };
}
