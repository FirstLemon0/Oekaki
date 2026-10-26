/**
 * 新しいお絵描き（OgFreeDraw）の「保存して終わる」の流れ（画面に依らない部分。src/ui/og/finishFlow.test.ts）。
 *
 * 1. まだ保存していなければ保存する（容量不足などで失敗したら、作った画像と文書のまま次に押したときに書き直す = retry）
 * 2. **Before / After の印は保存の枝の外で、まだ付けていなければ毎回付ける**（ilust-sup-followup-05）。
 *    保存は成功したのに印（IndexedDB の profile）が一時的に失敗したとき、もう一度押すと保存の枝は飛ばされるので、
 *    印を保存の枝の中に置くと月次の描き直しの Before / After の紐づけが抜ける。今までのお絵描き（FreeDraw）と同じく、
 *    保存済みの絵があって ?save= があり、続きから描いた絵でなければ、印が付くまで押すたびに付け直す（付いたら markedRef で 2 度付けない）
 * 3. 実描画の時間の記録・保存済みの印・下書きの掃除（finalize）→ 画面を離れる（leave）
 *
 * 失敗はすべて { status: 'failed' } で返す（投げない）。画面は reason で文言を選ぶ。
 */
import type { Drawing } from '@/data/types';
import type { OgSaveOutcome } from './freeSession';

/** 書き換えられる参照（preact の useRef と同じ形） */
export interface MutableRef<T> {
  current: T;
}

export interface OgFinishRefs {
  /** 保存できた絵（保存の後に押し直したときは保存を飛ばす） */
  readonly savedDrawing: MutableRef<Drawing | null>;
  /** 保存に失敗したときの書き直し（作った画像と文書のまま） */
  readonly retry: MutableRef<(() => Promise<OgSaveOutcome>) | null>;
  /** Before / After の印を付け終えたか（ilust-sup-followup-05） */
  readonly marked: MutableRef<boolean>;
}

export interface OgFinishDeps {
  /** 初めての保存（saveOgFree） */
  save(): Promise<OgSaveOutcome>;
  /** Before / After の印（stateBridge の markBeforeAfter） */
  markBeforeAfter(drawingId: string, save: 'before' | 'after'): Promise<void>;
  /** 実描画の時間の記録・保存済みの印・下書きの掃除（投げたら失敗として扱う） */
  finalize(): Promise<void>;
  /** 画面を離れる */
  leave(): void;
}

export interface RunOgFinishOptions {
  /** ?save=before|after（無ければ自由お絵描き） */
  readonly save?: 'before' | 'after';
  /** 続きから描いた絵（元の Before / After の記録を変えない） */
  readonly continuing: boolean;
  readonly refs: OgFinishRefs;
  readonly deps: OgFinishDeps;
}

export type OgFinishResult = { status: 'left' } | { status: 'failed'; reason: 'quota' | 'other' };

export async function runOgFinish(o: RunOgFinishOptions): Promise<OgFinishResult> {
  const { refs, deps } = o;
  try {
    if (!refs.savedDrawing.current) {
      const outcome = refs.retry.current ? await refs.retry.current() : await deps.save();
      if (outcome.status === 'failed') {
        refs.retry.current = outcome.retry;
        return { status: 'failed', reason: outcome.reason === 'quota' ? 'quota' : 'other' };
      }
      refs.retry.current = null;
      if (outcome.status === 'saved') refs.savedDrawing.current = outcome.drawing;
    }
    // 保存の枝の外: 1 回目の印が失敗しても、次に押したときに付け直す（ilust-sup-followup-05）
    const drawing = refs.savedDrawing.current;
    if (drawing && o.save && !o.continuing && !refs.marked.current) {
      await deps.markBeforeAfter(drawing.id, o.save);
      refs.marked.current = true;
    }
    await deps.finalize();
    deps.leave();
    return { status: 'left' };
  } catch {
    return { status: 'failed', reason: 'other' };
  }
}
