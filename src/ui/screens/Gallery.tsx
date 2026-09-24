/**
 * ギャラリー  #/gallery   （DESIGN_SYSTEM.md §3 ギャラリー）
 *
 * ヘッダ 88: 見出し ＋ セグメント（グリッド／Before / After 比較）＋ 右に mono の枚数・容量。
 * グリッド: フィルタピル 40（選択は墨地）＋ 6 列 aspect 1 のタイル。
 * 比較: Before / After の 2 カード ＋「月ごとの描き直し」カード（高さ 120）。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { listDrawings } from '@/data/repo';
import type { Drawing, DrawingKind } from '@/data/types';
import { Button, Chip, EmptyState, ImageTile, Segment } from '../components';
import { formatBytes, KIND_LABEL, nf } from '../format';
import { href, navigate } from '../router';
import { profile } from '../state';
import { useObjectUrls } from '../useObjectUrl';

type View = 'grid' | 'compare';
type Filter = 'all' | 'drill' | 'lesson' | 'free' | 'submit' | 'beforeAfter';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'drill', label: 'ドリル' },
  { value: 'lesson', label: 'レッスン' },
  { value: 'free', label: '自由' },
  { value: 'submit', label: '卒業課題' },
  { value: 'beforeAfter', label: 'Before・After' },
];

const FILTER_KINDS: Record<Exclude<Filter, 'all'>, DrawingKind[]> = {
  drill: ['drill'],
  lesson: ['lesson'],
  free: ['free'],
  submit: ['submit'],
  beforeAfter: ['before', 'after'],
};

let rememberedFilter: Filter = 'all';
let rememberedView: View = 'grid';
const EMPTY: Drawing[] = [];

/** 2026.9.24 */
function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 9.24 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Before / After 比較
// ---------------------------------------------------------------------------

function CompareView({ drawings }: { drawings: Drawing[] }) {
  const pf = profile.value;
  const afters = useMemo(
    () => drawings.filter((d) => d.kind === 'after').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [drawings],
  );
  const before =
    drawings.find((d) => d.id === pf?.beforeDrawingId) ?? drawings.filter((d) => d.kind === 'before').at(-1);
  const defaultAfter = drawings.find((d) => d.id === pf?.afterDrawingId) ?? afters.at(-1);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const after = (pickedId ? afters.find((d) => d.id === pickedId) : undefined) ?? defaultAfter;
  const pair = useMemo(() => [before, after].filter((d): d is Drawing => !!d), [before, after]);
  const pairUrls = useObjectUrls(pair);
  const monthUrls = useObjectUrls(afters);

  if (!before) {
    return (
      <EmptyState icon="image" title="Before がまだありません" action={<Button variant="primary" href={href.home()}>ホームへ</Button>}>
        はじめの 1 枚を描くと、ここで比べられます
      </EmptyState>
    );
  }

  const days = after
    ? Math.max(0, Math.round((new Date(after.createdAt).getTime() - new Date(before.createdAt).getTime()) / 86_400_000))
    : null;
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + (afters.length > 0 ? 1 : 0));

  return (
    <div class="ba">
      <div class="ba__pair">
        <figure class="ba__card">
          <img src={pairUrls.get(before.id)} alt="Before の絵" />
          <figcaption class="ba__cap">
            <span class="ba__tag">BEFORE</span>
            <span class="num ba__date">{ymd(before.createdAt)}</span>
          </figcaption>
        </figure>
        <figure class="ba__card ba__card--after">
          {after ? (
            <img src={pairUrls.get(after.id)} alt="After の絵" />
          ) : (
            <p class="ba__none">今月の 1 枚を描くと、ここに並びます</p>
          )}
          <figcaption class="ba__cap">
            <span class="ba__tag ba__tag--after">AFTER</span>
            {after && <span class="num ba__date">{ymd(after.createdAt)}</span>}
          </figcaption>
          {days !== null && (
            <span class="ba__days">
              <span class="num">{days}</span>日
            </span>
          )}
        </figure>
      </div>
      <section class="ba__months" aria-label="月ごとの描き直し">
        <span class="ba__months-label">
          月ごとの
          <br />
          描き直し
        </span>
        <div class="ba__rail">
          <span class="ba__rail-line" aria-hidden="true" />
          {afters.map((d) => (
            <button
              key={d.id}
              type="button"
              class="ba__month"
              aria-pressed={after?.id === d.id}
              onClick={() => setPickedId(d.id)}
            >
              <span class={after?.id === d.id ? 'ba__thumb is-selected' : 'ba__thumb'}>
                <img src={monthUrls.get(d.id)} alt="" loading="lazy" />
              </span>
              <span class="ba__month-label">{new Date(d.createdAt).getMonth() + 1}月</span>
            </button>
          ))}
          <a class="ba__month" href={href.free()} aria-label="今月の 1 枚を描く">
            <span class="ba__thumb ba__thumb--future">＋</span>
            <span class="ba__month-label faint">{nextMonth.getMonth() + 1}月</span>
          </a>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export function Gallery() {
  const [view, setView] = useState<View>(rememberedView);
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
  const gridUrls = useObjectUrls(view === 'compare' ? EMPTY : shown);
  const totalBytes = all.reduce((sum, d) => sum + d.image.size, 0);

  const chooseFilter = (f: Filter) => {
    rememberedFilter = f;
    setFilter(f);
  };
  const chooseView = (v: View) => {
    rememberedView = v;
    setView(v);
  };

  return (
    <div class="gallery">
      <header class="gallery__head">
        <h1 class="gallery__title">ギャラリー</h1>
        <div class="segment--locked-wrap">
          <Segment<View>
            label="表示"
            value={view}
            options={[
              { value: 'grid', label: 'グリッド' },
              { value: 'compare', label: 'Before / After 比較' },
            ]}
            onChange={chooseView}
          />
        </div>
        <span class="gallery__total">
          <span class="num">{nf.format(all.length)}</span> 枚 · <span class="num">{formatBytes(totalBytes)}</span>
        </span>
      </header>

      {drawings === null ? null : view === 'compare' ? (
        <CompareView drawings={all} />
      ) : (
        <>
          <div class="gallery__filters" role="group" aria-label="種類で絞り込む">
            {FILTERS.map((f) => (
              <Chip key={f.value} selected={filter === f.value} onClick={() => chooseFilter(f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon="image"
              title="まだ絵がありません"
              action={
                <Button variant="primary" onClick={() => navigate(href.home())}>
                  ホームへ
                </Button>
              }
            >
              今日の1歩を描くと、ここに並びます
            </EmptyState>
          ) : (
            <div class="gallery__grid">
              {shown.map((d) => (
                <ImageTile
                  key={d.id}
                  href={href.galleryDetail(d.id)}
                  src={gridUrls.get(d.id)}
                  kind={KIND_LABEL[d.kind]}
                  date={shortDate(d.createdAt)}
                  label={`${KIND_LABEL[d.kind]} ${ymd(d.createdAt)}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
