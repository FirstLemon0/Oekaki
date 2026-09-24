/**
 * 絵の詳細  #/gallery/:id
 *
 * 大きく表示、日付・種別、描いた順に再生（src/canvas の replay。未統合のあいだは押せない）、
 * 批評（4 ブロック）、削除（確認つき）。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { deleteDrawing, getCritique, getDrawing } from '@/data/repo';
import type { Critique, Drawing } from '@/data/types';
import { Button, Card, EmptyState, Icon, Modal, showToast } from '../components';
import { formatDate, KIND_LABEL } from '../format';
import { href, navigate } from '../router';
import { path } from '../state';
import { canvasAvailable } from '../stubs/canvas';
import { useObjectUrls } from '../useObjectUrl';

function CritiqueBlocks({ critique }: { critique: Critique }) {
  const r = critique.response;
  return (
    <div class="critique">
      <p class="critique__note faint">点数はつけません。言葉で見ます。</p>
      <Card class="critique__block critique__block--good">
        <span class="label">良い点</span>
        <ul>
          {r.good.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </Card>
      {r.issues.length > 0 && (
        <Card class="critique__block">
          <span class="label">直す点</span>
          <ol class="critique__issues">
            {r.issues.map((it, i) => (
              <li key={i}>
                <span class="critique__marker num" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <p class="critique__where">
                    {it.where} ・ {it.what}
                  </p>
                  <p class="muted">{it.how}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Card tone="soft" class="critique__block">
        <span class="label">次にやる 1 つ</span>
        <p class="critique__next">{r.next_one}</p>
      </Card>
      <Card class="critique__block">
        <span class="label">一言</span>
        <p>{r.encourage}</p>
      </Card>
      <p class="faint critique__model">
        {critique.model} ・ {formatDate(critique.createdAt)}
      </p>
    </div>
  );
}

export function GalleryDetail({ id }: { id: string }) {
  const [drawing, setDrawing] = useState<Drawing | null | undefined>(undefined);
  const [critique, setCritique] = useState<Critique | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

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
  const canReplay = canvasAvailable && drawing.strokes !== null && drawing.strokes.length > 0;

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
          <h1 class="detail__title display">{lesson?.title ?? `${KIND_LABEL[drawing.kind]}の絵`}</h1>
          <span class="muted num">{formatDate(drawing.createdAt)}</span>
        </div>
        <div class="detail__actions">
          <Button variant="secondary" icon="play" disabled={!canReplay} title={canReplay ? undefined : '再生は準備中です'}>
            描いた順に再生
          </Button>
          <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
            削除
          </Button>
        </div>
      </header>

      <div class={critique ? 'detail__body detail__body--split' : 'detail__body'}>
        <div class="detail__image">
          <img src={urls.get(drawing.id)} alt={`${KIND_LABEL[drawing.kind]}の絵`} />
        </div>
        {critique ? (
          <CritiqueBlocks critique={critique} />
        ) : drawing.strokes === null ? null : (
          <p class="detail__hint faint">
            <Icon name="help" size={18} /> 線の記録があります。再生は近日対応です。
          </p>
        )}
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
