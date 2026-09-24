/**
 * ギャラリー  #/gallery
 *
 * セグメント（すべて／ドリル／レッスン／自由／卒業課題／Before / After）でグリッドを絞り込む。
 * Before / After タブは専用の比較ビュー。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { listDrawings } from '@/data/repo';
import type { Drawing, DrawingKind } from '@/data/types';
import { Button, Card, EmptyState, Segment } from '../components';
import { formatBytes, formatDate, formatMonth, KIND_LABEL, nf } from '../format';
import { href, navigate } from '../router';
import { completedIds, critiques, drillStats, profile } from '../state';
import { useObjectUrls } from '../useObjectUrl';

type Filter = 'all' | 'drill' | 'lesson' | 'free' | 'submit' | 'beforeAfter';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'drill', label: 'ドリル' },
  { value: 'lesson', label: 'レッスン' },
  { value: 'free', label: '自由' },
  { value: 'submit', label: '卒業課題' },
  { value: 'beforeAfter', label: 'Before / After' },
];

const FILTER_KINDS: Record<Exclude<Filter, 'all'>, DrawingKind[]> = {
  drill: ['drill'],
  lesson: ['lesson'],
  free: ['free'],
  submit: ['submit'],
  beforeAfter: ['before', 'after'],
};

let rememberedFilter: Filter = 'all';
const EMPTY: Drawing[] = [];

function Tile({ drawing, url }: { drawing: Drawing; url: string | undefined }) {
  return (
    <a class="tile" href={href.galleryDetail(drawing.id)} aria-label={`${KIND_LABEL[drawing.kind]} ${formatDate(drawing.createdAt)}`}>
      <span class="tile__img">{url && <img src={url} alt="" loading="lazy" decoding="async" />}</span>
      <span class="tile__date num">{formatDate(drawing.createdAt)}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Before / After
// ---------------------------------------------------------------------------

function monthsBetween(fromIso: string, to: Date): number {
  const f = new Date(fromIso);
  return Math.max(0, (to.getFullYear() - f.getFullYear()) * 12 + (to.getMonth() - f.getMonth()));
}

function BeforeAfterView({ drawings }: { drawings: Drawing[] }) {
  const pf = profile.value;
  const afters = useMemo(
    () => drawings.filter((d) => d.kind === 'after').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [drawings],
  );
  const before =
    drawings.find((d) => d.id === pf?.beforeDrawingId) ?? drawings.filter((d) => d.kind === 'before').at(-1);
  const after = drawings.find((d) => d.id === pf?.afterDrawingId) ?? afters.at(-1);
  const pair = useMemo(() => [before, after].filter((d): d is Drawing => !!d), [before, after]);
  const pairUrls = useObjectUrls(pair);
  const monthUrls = useObjectUrls(afters);

  if (!before) {
    return (
      <EmptyState title="Before がまだありません" action={<Button variant="primary" href={href.home()}>ホームへ</Button>}>
        はじめの 1 枚を描くと、ここで比べられます。
      </EmptyState>
    );
  }

  const months = monthsBetween(before.createdAt, new Date());
  const line = drillStats.value.find((s) => s.drillType === 'line');
  const firstLine = line?.history[0]?.score;
  const bestLine = line?.bestScore;

  return (
    <div class="ba">
      <div class="ba__main">
        <figure class="ba__tile">
          <figcaption class="label">BEFORE ・ {formatDate(before.createdAt)}</figcaption>
          <div class="ba__img">
            <img src={pairUrls.get(before.id)} alt="Before の絵" />
          </div>
        </figure>
        <figure class="ba__tile ba__tile--after">
          <figcaption class="label ba__after-label">AFTER{after ? ` ・ ${formatDate(after.createdAt)}` : ''}</figcaption>
          <div class="ba__img">
            {after ? (
              <img src={pairUrls.get(after.id)} alt="After の絵" />
            ) : (
              <p class="ba__none">今月の 1 枚を描くと、ここに並びます。</p>
            )}
          </div>
        </figure>
        <Card class="ba__stats">
          <span class="label">この {months} か月で</span>
          <dl class="ba__list">
            <div>
              <dt>レッスン</dt>
              <dd class="num">{nf.format(completedIds.value.size)}</dd>
            </div>
            <div>
              <dt>直線の自己ベスト</dt>
              <dd class="num">{firstLine !== undefined && bestLine != null ? `${firstLine} → ${bestLine}` : '—'}</dd>
            </div>
            <div>
              <dt>先生に見せた回数</dt>
              <dd class="num">{nf.format(critiques.value.length)}</dd>
            </div>
          </dl>
          <Button variant="primary" block href={href.free()}>
            今月の 1 枚を描く
          </Button>
        </Card>
      </div>
      {afters.length > 0 && (
        <section class="ba__months">
          <h2 class="label">月ごとの描き直し</h2>
          <div class="ba__strip">
            {afters.map((d) => (
              <a key={d.id} class="ba__month" href={href.galleryDetail(d.id)}>
                <span class="tile__img">
                  <img src={monthUrls.get(d.id)} alt="" loading="lazy" />
                </span>
                <span class="tile__date">{formatMonth(d.createdAt)}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export function Gallery() {
  const [filter, setFilter] = useState<Filter>(rememberedFilter);
  const [drawings, setDrawings] = useState<Drawing[] | null>(null);

  useEffect(() => {
    let alive = true;
    listDrawings()
      .then((d) => alive && setDrawings(d))
      .catch(() => alive && setDrawings([]));
    return () => {
      alive = false;
    };
  }, []);

  const all = drawings ?? EMPTY;
  const shown = useMemo(
    () => (filter === 'all' ? all : all.filter((d) => FILTER_KINDS[filter].includes(d.kind))),
    [all, filter],
  );
  const gridUrls = useObjectUrls(filter === 'beforeAfter' ? EMPTY : shown);
  const totalBytes = all.reduce((sum, d) => sum + d.image.size, 0);

  const choose = (f: Filter) => {
    rememberedFilter = f;
    setFilter(f);
  };

  return (
    <div class="gallery">
      <header class="gallery__head">
        <h1 class="display gallery__title">ギャラリー</h1>
        <Segment label="種類" value={filter} options={FILTERS} onChange={choose} />
        <span class="gallery__total num">
          全 {nf.format(all.length)} 枚 ・ {formatBytes(totalBytes)}
        </span>
      </header>

      {drawings === null ? null : filter === 'beforeAfter' ? (
        <BeforeAfterView drawings={all} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="gallery"
          action={
            <Button variant="primary" onClick={() => navigate(href.home())}>
              ホームへ
            </Button>
          }
        >
          まだ絵がありません。今日のレッスンから始めましょう。
        </EmptyState>
      ) : (
        <div class="grid">
          {shown.map((d) => (
            <Tile key={d.id} drawing={d} url={gridUrls.get(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
