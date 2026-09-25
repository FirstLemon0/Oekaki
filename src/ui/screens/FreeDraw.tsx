/**
 * 自由お絵描き #/free（採点なし・記録だけ）。「終わる」で保存（kind 'free'）、5 分以上ならストリークに数える。
 *
 * - フルツール（お絵描き v2: レイヤー・塗りつぶし・スポイト・図形・選択と変形・手のひら・HSV ピッカー）
 * - 「終わる」で下からシート: 「保存して終わる」「透過 PNG を書き出す」「描き続ける」。
 *   透過 PNG は toPng(2048, { transparent: true, inkColor: '#2B2A28' })（紙色を敷かない。レイヤーの合成結果）をダウンロードする。
 *   墨（色なし）の線・塗りはライトの墨で出す（ダークテーマでも、透明の上で見える墨になる）
 * - 保存はレイヤー等を使っていれば meta.doc（getDocument()）付き（stateBridge.saveCanvas）
 * - 5 分の判定は画面を開いていた時間ではなく「実際に描いていた時間」（ストロークの長さ＋間の空き。空きは 1 回 1 分まで）。
 *   区間は strokeend が来たときだけ積む（手のひら・選択・塗り・スポイトの押し下げは区間の始まりにしない）
 * - #/free?save=after はホームの「今月の 1 枚を描く」（月次の描き直し）。kind 'after' で保存し profile.afterDrawingId を更新
 * - 描いた線があるときに戻る（画面の戻る・端末の戻る・閉じる）と、捨ててよいか確かめる（CanvasScreen の離脱ガード）
 * - 描いている間は下書きを sessionStorage（seichotsu.draft.free）に残し、開き直したら続きから描ける
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { href, navigate } from '../router';
import { uiPrefs } from '../state';
import { CanvasScreen } from './CanvasScreen';
import { draftKey } from '../draft';
import { Button } from '../components';
import { SAVE_FAILED, useBusy, useEngine } from '../lesson/common';
import { freeDrawingKind, markBeforeAfter, recordFreeActivity, saveCanvas } from '../lesson/stateBridge';
import { activeDrawingMs } from '../lesson/steps';
import { downloadBlob, exportFileName } from '../paint/canvasDoc';
import { releaseSelection } from '../paint/SelectionOverlay';
import { PaintIcon } from '../paint/PaintIcon';
import type { Drawing } from '@/data/types';

/** 透過 PNG の墨（テーマに関係なくライトの墨） */
const EXPORT_INK = '#2B2A28';
/** 透過 PNG の長辺 */
const EXPORT_EDGE = 2048;

export function FreeDraw({ save }: { save?: 'before' | 'after' }) {
  const engine = useEngine();
  const { busy, error, run } = useBusy();
  /** 描いていた区間（ms） */
  const spans = useRef<{ start: number; end: number }[]>([]);
  const downAt = useRef<number | null>(null);
  const saved = useRef<Drawing | null>(null);
  const [done, setDone] = useState(false);
  const [ending, setEnding] = useState(false);
  const [exported, setExported] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

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
      if (!saved.current) saved.current = await saveCanvas(engine, freeDrawingKind(save), null);
      if (saved.current && save) await markBeforeAfter(saved.current.id, save);
      await recordFreeActivity(activeDrawingMs(spans.current));
    }, SAVE_FAILED);
    if (ok) {
      setDone(true);
      leave();
    }
  };

  const exportPng = async () => {
    setExported('busy');
    try {
      releaseSelection(engine);
      const blob = await engine.toPng(EXPORT_EDGE, { transparent: true, inkColor: EXPORT_INK });
      downloadBlob(blob, exportFileName('free'));
      setExported('done');
    } catch {
      setExported('failed');
    }
  };

  const task =
    save === 'after'
      ? '今月の1枚 — 最初の1枚（Before）と同じお題で描き直しましょう。採点はありません。'
      : '自由お絵描き — 採点なし・記録だけ。描いた時間が5分以上でストリークに数えます。';

  const sheet = ending ? (
    <div class="ls-sheet pt-endsheet" role="dialog" aria-label="終わる">
      <div class="ls-sheet__grip" aria-hidden="true" />
      <div class="pt-endsheet__body">
        <h2 class="pt-endsheet__title">終わりますか</h2>
        <p class="pt-endsheet__text">保存するとギャラリーに残ります。画像として手元に残したいときは、透過 PNG（紙の色なし）で書き出せます。</p>
        {exported === 'done' && (
          <p class="pt-endsheet__status" role="status">
            透過 PNG を書き出しました。
          </p>
        )}
        {exported === 'failed' && (
          <p class="ls-sheet__error" role="alert">
            書き出せませんでした。もう一度押してみましょう。
          </p>
        )}
        {error && (
          <p class="ls-sheet__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div class="ls-sheet__foot pt-endsheet__foot">
        <Button variant="secondary" disabled={exported === 'busy'} onClick={() => void exportPng()}>
          <span class="pt-btnicon">
            <PaintIcon name="download" size={20} />
            透過 PNG を書き出す
          </span>
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEnding(false)}>
          描き続ける
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void finish()}>
          保存して終わる
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div
      class="ls-root is-fullscreen"
      onPointerDownCapture={(e) => {
        // 押し下げごとに始まりを取り直す（手のひら・選択・塗り・スポイトの押し下げが次の線の始まりに残らない）。
        // 区間を積むのは strokeend が来たときだけ。2 本目の指（ジェスチャー）は見ない
        if (uiPrefs.value.penOnly && e.pointerType === 'touch') return; // ペン専用: 指（手のひら）は描かない
        if (e.target instanceof HTMLCanvasElement && e.isPrimary) downAt.current = Date.now();
      }}
    >
      <CanvasScreen
        engine={engine}
        full
        task={task}
        onExit={leave}
        exitLabel="ホームへ戻る"
        draftKey={draftKey(null)}
        saved={done}
        onDone={() => {
          setExported('idle');
          setEnding(true);
        }}
        doneLabel="終わる"
        doneDisabled={busy || ending}
        error={ending ? null : error}
        sheet={sheet}
      />
    </div>
  );
}
