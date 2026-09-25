/**
 * 絵の詳細  #/gallery/:id
 *
 * 大きく表示、日付・種別、描いた順に再生（src/canvas の replay。ストロークの無い取込画像では出さない）、
 * 批評（4 ブロック）、削除（確認つき）。
 *
 * 再生: 表示中の画像と同じ枠に createCanvasEngine を attach し、loadStrokes(strokes, meta.strokeStyles) → replay({ speed: 2 })。
 * 線ごとの見た目（ペンの種類・太さ・色）は保存時の meta.strokeStyles。無い旧データは既定のペン。
 * 消しゴムを使った絵は meta.history（消しゴムを含む生の履歴）があれば、そちらを loadHistory して再生する
 * （消しゴムも描いた順に消える）。範囲（sourceRect）は従来どおり strokes（消えた所を除いた線）から出す。
 * キャンバスはストロークの座標（CSS px）のまま描くので、書き出し範囲（切り詰めなら cropRect、
 * 旧データの紙全体書き出しなら紙の大きさの推定）ぶんの箱を作って枠に合わせて拡大縮小する。
 *
 * お絵描き v2: meta.doc（レイヤー等を使った絵の CanvasDocument）があれば、紙の大きさ（doc.width × doc.height）の
 * 箱に attach して loadDocument → replay（塗りつぶし・変形・レイヤー操作も順に再現）。
 * 見せる範囲は保存時に残した切り詰め範囲（meta.contentRect）。保存画像と同じ範囲なので縦横比もずれない。
 * contentRect の無い旧データは従来の推定（線の切り詰め範囲が画像と同じ縦横比ならそこ、違えば紙全体を画像の縦横比で）。
 * 「PNG で書き出す」: 紙色つきの PNG（長辺 2048）をダウンロードする。文書・履歴・線があればエンジンで描き直し、
 * 取込画像はそのまま PNG に変換する。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createCanvasEngine, cropRect, DEFAULT_OPTIONS, type CanvasEngine, type Rect, type StrokeHistory, type StrokeStyle } from '@/canvas';
import { deleteDrawing, getCritique, getDrawing } from '@/data/repo';
import type { Critique, Drawing, StrokeDrawing } from '@/data/types';
import { Button, CritiqueFixes, CritiqueGood, CritiqueNext, EmptyState, Modal, showToast } from '../components';
import { formatDate, KIND_LABEL } from '../format';
import { href, navigate } from '../router';
import { path } from '../state';
import { useObjectUrls } from '../useObjectUrl';
import { readStrokeHistory, readStrokeStyles } from '../lesson/stateBridge';
import { docSourceRect, downloadBlob, exportFileName, readContentRect, readDrawingDoc } from '../paint/canvasDoc';
import type { CanvasDocument } from '../paint/types';
import { PaintIcon } from '../paint/PaintIcon';

/** 線の無い絵（塗りだけの文書）の再生で渡す空の線（毎回同じ参照にして再生面を作り直さない） */
const NO_STROKES: StrokeDrawing = [];

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * 画面外の箱にエンジンを attach して、紙色つきの PNG（長辺 2048）を作る。
 * 文書（doc）→ 履歴（history）→ 線（strokes）の順に使えるものを使う。どれも無ければ保存画像を PNG に変換する。
 */
async function drawingPng(
  drawing: Drawing,
  src: { doc?: CanvasDocument; history?: StrokeHistory; strokes: StrokeDrawing | null; styles?: (StrokeStyle | undefined)[] },
): Promise<Blob> {
  if (!src.doc && !src.history && !src.strokes) {
    const bmp = await createImageBitmap(drawing.image);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')?.drawImage(bmp, 0, 0);
    bmp.close();
    return new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
  }
  let w = 0;
  let h = 0;
  if (src.doc) {
    w = src.doc.width;
    h = src.doc.height;
  } else {
    for (const st of src.history?.strokes ?? src.strokes ?? []) {
      for (const p of st) {
        if (p.x > w) w = p.x;
        if (p.y > h) h = p.y;
      }
    }
    w += 48;
    h += 48;
  }
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${Math.ceil(w)}px`, height: `${Math.ceil(h)}px`, pointerEvents: 'none' });
  document.body.appendChild(host);
  const engine = createCanvasEngine({ penOnly: true, allowMouse: false });
  try {
    engine.attach(host);
    await nextFrame();
    await nextFrame();
    if (src.doc) engine.loadDocument(src.doc);
    else if (src.history) engine.loadHistory(src.history);
    else engine.loadStrokes(src.strokes ?? [], src.styles);
    return await engine.toPng(2048);
  } finally {
    engine.detach();
    host.remove();
  }
}

function CritiqueBlocks({ critique }: { critique: Critique }) {
  const r = critique.response;
  return (
    <div class="critique">
      <p class="critique__note">点数はつけません。言葉で見ます。</p>
      <CritiqueGood items={r.good} />
      {r.issues.length > 0 && (
        <CritiqueFixes issues={r.issues.map((it) => ({ where: it.where, what: it.what, how: it.how }))} />
      )}
      <CritiqueNext text={r.next_one} />
      {r.encourage && <p class="critique__quote">『{r.encourage}』</p>}
      <p class="critique__model">
        <span class="num">{critique.model}</span> · <span class="num">{formatDate(critique.createdAt)}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 描いた順に再生
// ---------------------------------------------------------------------------

type ReplayMode = 'idle' | 'playing' | 'done';

/**
 * 画像に対応するストローク座標の範囲。保存時の toWebp が切り詰めていれば cropRect と縦横比が一致する。
 * 一致しなければ（切り詰め導入前の絵）紙全体を書き出したものとみなし、原点から画像の縦横比で広げる。
 */
function sourceRect(strokes: StrokeDrawing, imageAspect: number, styles?: readonly (StrokeStyle | undefined)[]): Rect {
  // 保存時と同じく線ごとの太さで範囲を出す（太いペンでも画像と重なるように）
  const crop = cropRect(strokes, DEFAULT_OPTIONS.baseWidth, styles);
  if (crop && imageAspect > 0 && Math.abs(crop.width / crop.height - imageAspect) / imageAspect < 0.03) return crop;
  let maxX = 1;
  let maxY = 1;
  for (const st of strokes) {
    for (const p of st) {
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const r = imageAspect > 0 ? imageAspect : (maxX + 16) / (maxY + 16);
  const width = Math.max(maxX + 16, (maxY + 16) * r);
  return { x: 0, y: 0, width, height: width / r };
}

function shift(strokes: StrokeDrawing, dx: number, dy: number): StrokeDrawing {
  return strokes.map((st) => st.map((p) => ({ ...p, x: p.x - dx, y: p.y - dy })));
}

/** 画像の上に重ねる再生面。mode が idle 以外のあいだだけ描画される */
function ReplayStage({
  strokes,
  styles,
  history,
  doc,
  contentRect,
  imageAspect,
  runId,
  onEnd,
  engineRef,
}: {
  /** レイヤー等を使った絵の文書（あれば紙の大きさの箱で loadDocument → replay） */
  doc: CanvasDocument | undefined;
  /** 保存画像が写している範囲（meta.contentRect。無ければ推定） */
  contentRect: Rect | undefined;
  strokes: StrokeDrawing;
  /** strokes と同じ並びの線ごとの見た目（無ければ旧データのペン） */
  styles: (StrokeStyle | undefined)[] | undefined;
  /** 消しゴムを含む生の履歴（あればこちらを再生する） */
  history: StrokeHistory | undefined;
  imageAspect: number;
  /** 増えるたびに頭から再生する */
  runId: number;
  onEnd: () => void;
  engineRef: { current: CanvasEngine | null };
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rect = useMemo(() => {
    if (!doc) return sourceRect(strokes, imageAspect, styles);
    return docSourceRect(doc, contentRect, strokes, imageAspect, styles);
  }, [doc, contentRect, strokes, imageAspect, styles]);
  const [scale, setScale] = useState<{ x: number; y: number } | null>(null);

  // 枠の大きさに合わせる
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      const w = frame.clientWidth;
      const h = frame.clientHeight;
      if (w > 0 && h > 0) setScale({ x: w / rect.width, y: h / rect.height });
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [rect]);

  // エンジンを attach（1 回だけ）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = createCanvasEngine({ penOnly: true, allowMouse: false });
    engine.attach(host);
    if (doc) engine.loadDocument(doc);
    else if (history) engine.loadHistory({ strokes: shift(history.strokes, rect.x, rect.y), styles: history.styles });
    else engine.loadStrokes(shift(strokes, rect.x, rect.y), styles);
    engineRef.current = engine;
    return () => {
      engine.cancelReplay();
      engine.detach();
      engineRef.current = null;
    };
  }, [doc, strokes, styles, history, rect, engineRef]);

  // 再生（runId が変わるたび）
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let alive = true;
    void engine.replay({ speed: 2 }).then(() => {
      if (alive) onEnd();
    });
    return () => {
      alive = false;
    };
  }, [runId]);

  return (
    <div class="replay" ref={frameRef} aria-hidden="true">
      <div
        class="replay__host"
        ref={hostRef}
        style={
          doc
            ? {
                // 文書は紙の大きさのまま描き、表示したい範囲（rect）を枠に合わせる
                width: `${doc.width}px`,
                height: `${doc.height}px`,
                transform: scale ? `scale(${scale.x}, ${scale.y}) translate(${-rect.x}px, ${-rect.y}px)` : undefined,
                visibility: scale ? undefined : 'hidden',
              }
            : {
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                transform: scale ? `scale(${scale.x}, ${scale.y})` : undefined,
                visibility: scale ? undefined : 'hidden',
              }
        }
      />
    </div>
  );
}

export function GalleryDetail({ id }: { id: string }) {
  const [drawing, setDrawing] = useState<Drawing | null | undefined>(undefined);
  const [critique, setCritique] = useState<Critique | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<ReplayMode>('idle');
  const [runId, setRunId] = useState(0);
  const [imageAspect, setImageAspect] = useState(0);
  const engineRef = useRef<CanvasEngine | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getDrawing(id), getCritique(id)])
      .then(([d, c]) => {
        if (!alive) return;
        setDrawing(d ?? null);
        setCritique(c);
      })
      .catch(() => alive && setDrawing(null));
    return () => {
      alive = false;
    };
  }, [id]);

  const list = useMemo(() => (drawing ? [drawing] : []), [drawing]);
  // 再生面の attach は styles の同一性で作り直すので、絵が変わったときだけ読み直す
  const strokeStyles = useMemo(() => readStrokeStyles(drawing?.meta), [drawing]);
  const strokeHistory = useMemo(() => readStrokeHistory(drawing?.meta), [drawing]);
  const strokeDoc = useMemo(() => readDrawingDoc(drawing?.meta), [drawing]);
  const contentRect = useMemo(() => readContentRect(drawing?.meta), [drawing]);
  const [exporting, setExporting] = useState(false);
  const urls = useObjectUrls(list);

  if (drawing === undefined) return <div class="loading" aria-busy="true" />;

  if (drawing === null) {
    return (
      <div class="detail">
        <EmptyState title="この絵は見つかりません" action={<Button href={href.gallery()}>ギャラリーへ</Button>}>
          消したか、まだ保存されていないようです。
        </EmptyState>
      </div>
    );
  }

  const lesson = drawing.lessonId ? path.value.find((n) => n.lesson.id === drawing.lessonId)?.lesson : undefined;
  const strokes = drawing.strokes && drawing.strokes.some((st) => st.length > 0) ? drawing.strokes : null;
  /** 再生できるか（線か、レイヤー等の文書がある） */
  const replayable = strokes !== null || strokeDoc !== undefined;

  const exportPng = async () => {
    setExporting(true);
    try {
      const blob = await drawingPng(drawing, { doc: strokeDoc, history: strokeHistory, strokes, styles: strokeStyles });
      downloadBlob(blob, exportFileName(drawing.kind, new Date(drawing.createdAt)));
      showToast('PNG で書き出しました');
    } catch {
      showToast('書き出せませんでした', 'danger');
    } finally {
      setExporting(false);
    }
  };

  const startReplay = () => {
    setMode('playing');
    setRunId((n) => n + 1);
  };
  const stopReplay = () => {
    engineRef.current?.cancelReplay();
    setMode('done');
  };

  const doDelete = async () => {
    await deleteDrawing(drawing.id);
    setConfirming(false);
    showToast('絵を消しました');
    navigate(href.gallery());
  };

  return (
    <div class="detail">
      <header class="detail__head">
        <Button variant="icon" icon="back" label="ギャラリーへ戻る" onClick={() => navigate(href.gallery())} />
        <div class="detail__meta">
          <span class="label">{KIND_LABEL[drawing.kind]}</span>
          <h1 class="detail__title">{lesson?.title ?? `${KIND_LABEL[drawing.kind]}の絵`}</h1>
          <span class="detail__date num">{formatDate(drawing.createdAt)}</span>
        </div>
        <div class="detail__actions">
          <Button variant="secondary" disabled={exporting} onClick={() => void exportPng()}>
            <span class="pt-btnicon">
              <PaintIcon name="download" size={20} />
              PNG で書き出す
            </span>
          </Button>
          {replayable &&
            (mode === 'playing' ? (
              <Button variant="secondary" icon="close" onClick={stopReplay}>
                止める
              </Button>
            ) : (
              <Button variant="secondary" icon={mode === 'done' ? 'rotate' : 'play'} disabled={imageAspect === 0} onClick={startReplay}>
                {mode === 'done' ? 'もう一度' : '描いた順に再生'}
              </Button>
            ))}
          <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
            削除
          </Button>
        </div>
      </header>

      <div class={critique ? 'detail__body detail__body--split' : 'detail__body'}>
        <div class="detail__image">
          <div class="detail__frame">
            <img
              src={urls.get(drawing.id)}
              alt={`${KIND_LABEL[drawing.kind]}の絵`}
              style={mode === 'idle' ? undefined : { visibility: 'hidden' }}
              onLoad={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) setImageAspect(img.naturalWidth / img.naturalHeight);
              }}
            />
            {replayable && mode !== 'idle' && imageAspect > 0 && (
              <ReplayStage
                doc={strokeDoc}
                contentRect={contentRect}
                strokes={strokes ?? NO_STROKES}
                styles={strokeStyles}
                history={strokeHistory}
                imageAspect={imageAspect}
                runId={runId}
                engineRef={engineRef}
                onEnd={() => setMode('done')}
              />
            )}
          </div>
          {mode === 'playing' && (
            <span class="detail__replaying" role="status">
              再生中
            </span>
          )}
        </div>
        {critique && <CritiqueBlocks critique={critique} />}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="この絵を消しますか"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              やめる
            </Button>
            <Button variant="danger" onClick={() => void doDelete()}>
              消す
            </Button>
          </>
        }
      >
        <p>消した絵は元に戻せません。</p>
      </Modal>
    </div>
  );
}
