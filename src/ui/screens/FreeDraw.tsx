/**
 * 自由お絵描き #/free（採点なし・記録だけ）。「終わる」で保存（kind 'free'）、5 分以上ならストリークに数える。
 *
 * - 5 分の判定は画面を開いていた時間ではなく「実際に描いていた時間」（ストロークの長さ＋間の空き。空きは 1 回 1 分まで）
 * - #/free?save=after はホームの「今月の 1 枚を描く」（月次の描き直し）。kind 'after' で保存し profile.afterDrawingId を更新
 * - 描いた線があるときに戻る（画面の戻る・端末の戻る）と、捨ててよいか確かめる
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Modal } from '../components';
import { href, navigate } from '../router';
import { CanvasScreen } from './CanvasScreen';
import { SAVE_FAILED, useBusy, useEngine } from '../lesson/common';
import { freeDrawingKind, markBeforeAfter, recordFreeActivity, saveStrokes } from '../lesson/stateBridge';
import { activeDrawingMs } from '../lesson/steps';
import type { Drawing } from '@/data/types';

export function FreeDraw({ save }: { save?: 'before' | 'after' }) {
  const engine = useEngine();
  const { busy, error, run } = useBusy();
  const [n, setN] = useState(0);
  const [confirm, setConfirm] = useState<null | 'button' | 'device'>(null);
  /** 描いていた区間（ms） */
  const spans = useRef<{ start: number; end: number }[]>([]);
  const downAt = useRef<number | null>(null);
  /** 端末の戻るを受け止めるために積んだ履歴があるか */
  const guard = useRef(false);
  const nRef = useRef(0);
  nRef.current = n;
  const saved = useRef<Drawing | null>(null);

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

  // 描き始めたら履歴を 1 つ積み、端末の戻るで確認を出す
  useEffect(() => {
    if (n > 0 && !guard.current && typeof history !== 'undefined') {
      history.pushState({ freeGuard: true }, '', location.href);
      guard.current = true;
    }
  }, [n]);
  useEffect(() => {
    const onPop = () => {
      if (!guard.current) return;
      // 積んだ履歴が 1 つ戻った（ハッシュは同じなのでルートは変わらない）
      guard.current = false;
      if (nRef.current > 0) setConfirm('device');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const leave = () => {
    guard.current = false;
    navigate(href.home(), { replace: true });
  };

  const stay = () => {
    if (confirm === 'device' && !guard.current) {
      history.pushState({ freeGuard: true }, '', location.href);
      guard.current = true;
    }
    setConfirm(null);
  };

  const exit = () => {
    if (n > 0) setConfirm('button');
    else leave();
  };

  const finish = async () => {
    const ok = await run(async () => {
      if (n > 0 && !saved.current) saved.current = await saveStrokes(engine.getStrokes(), freeDrawingKind(save), null, undefined, engine.getStyles());
      if (saved.current && save) await markBeforeAfter(saved.current.id, save);
      await recordFreeActivity(activeDrawingMs(spans.current));
    }, SAVE_FAILED);
    if (ok) leave();
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
        onExit={exit}
        exitLabel="ホームへ戻る"
        onDone={() => void finish()}
        doneLabel="終わる"
        doneDisabled={busy}
        error={error}
      />
      <Modal
        open={confirm !== null}
        onClose={stay}
        title="描いた絵を捨てますか？"
        actions={
          <>
            <Button variant="secondary" onClick={stay}>
              描き続ける
            </Button>
            <Button variant="danger" onClick={leave}>
              捨ててホームへ
            </Button>
          </>
        }
      >
        <p>まだ保存していません。残したいときは「描き続ける」を選んで、右下の「終わる」で保存しましょう。</p>
      </Modal>
    </div>
  );
}
