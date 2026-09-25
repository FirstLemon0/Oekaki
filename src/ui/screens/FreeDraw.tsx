/**
 * 自由お絵描き #/free（採点なし・記録だけ）。「終わる」で保存（kind 'free'）、5 分以上ならストリークに数える。
 *
 * - 5 分の判定は画面を開いていた時間ではなく「実際に描いていた時間」（ストロークの長さ＋間の空き。空きは 1 回 1 分まで）
 * - #/free?save=after はホームの「今月の 1 枚を描く」（月次の描き直し）。kind 'after' で保存し profile.afterDrawingId を更新
 * - 描いた線があるときに戻る（画面の戻る・端末の戻る・閉じる）と、捨ててよいか確かめる（CanvasScreen の離脱ガード）
 * - 描いている間は下書きを sessionStorage（seichotsu.draft.free）に残し、開き直したら続きから描ける
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { href, navigate } from '../router';
import { CanvasScreen } from './CanvasScreen';
import { draftKey } from '../draft';
import { SAVE_FAILED, useBusy, useEngine } from '../lesson/common';
import { freeDrawingKind, markBeforeAfter, recordFreeActivity, saveStrokes } from '../lesson/stateBridge';
import { activeDrawingMs } from '../lesson/steps';
import type { Drawing } from '@/data/types';

export function FreeDraw({ save }: { save?: 'before' | 'after' }) {
  const engine = useEngine();
  const { busy, error, run } = useBusy();
  const [n, setN] = useState(0);
  /** 描いていた区間（ms） */
  const spans = useRef<{ start: number; end: number }[]>([]);
  const downAt = useRef<number | null>(null);
  const saved = useRef<Drawing | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);
  useEffect(
    () =>
      engine.on('strokeend', () => {
        const end = Date.now();
        spans.current.push({ start: downAt.current ?? end, end });
        downAt.current = null;
      }),
    [engine],
  );

  const leave = () => navigate(href.home(), { replace: true });

  const finish = async () => {
    const ok = await run(async () => {
      if (n > 0 && !saved.current) saved.current = await saveStrokes(engine.getStrokes(), freeDrawingKind(save), null, undefined, engine.getStyles());
      if (saved.current && save) await markBeforeAfter(saved.current.id, save);
      await recordFreeActivity(activeDrawingMs(spans.current));
    }, SAVE_FAILED);
    if (ok) {
      setDone(true);
      leave();
    }
  };

  const task =
    save === 'after'
      ? '今月の1枚 — 最初の1枚（Before）と同じお題で描き直しましょう。採点はありません。'
      : '自由お絵描き — 採点なし・記録だけ。描いた時間が5分以上でストリークに数えます。';

  return (
    <div
      class="ls-root is-fullscreen"
      onPointerDownCapture={(e) => {
        if (e.target instanceof HTMLCanvasElement && downAt.current === null) downAt.current = Date.now();
      }}
    >
      <CanvasScreen
        engine={engine}
        task={task}
        onExit={leave}
        exitLabel="ホームへ戻る"
        draftKey={draftKey(null)}
        saved={done}
        onDone={() => void finish()}
        doneLabel="終わる"
        doneDisabled={busy}
        error={error}
      />
    </div>
  );
}
