/**
 * 表示部品（DESIGN_SYSTEM.md §2）:
 * StepProgress / ScoreDisplay / SubMetric / NumberMarker / CritiqueGood / CritiqueFixes /
 * CritiqueNext / CounterChip / ImageTile / ListRow
 *
 * 見た目だけを持つ。データ取得やルーティングはしない。
 */
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// StepProgress: 8px のセグメント（gap 6）＋ mono「2/7」
// ---------------------------------------------------------------------------

export interface StepProgressProps {
  /** 済んだステップ数（現在のステップを含めるかは呼び出し側で決める） */
  current: number;
  total: number;
  label?: string;
  /** 右の「2/7」を出すか */
  showCount?: boolean;
}

export function StepProgress({ current, total, label = '進み具合', showCount = true }: StepProgressProps) {
  return (
    <div class="steps" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}>
      <div class="steps__bar">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} class={i < current ? 'steps__seg is-done' : 'steps__seg'} />
        ))}
      </div>
      {showCount && (
        <span class="steps__count num">
          {current}/{total}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreDisplay: 点数（mono 120 / 72）＋ 差分 ＋ 自己ベスト ＋ 注記
// ---------------------------------------------------------------------------

export interface ScoreDisplayProps {
  score: number;
  size?: 'lg' | 'md';
  /** 前回との差。正なら accent-text、負なら danger */
  delta?: number | null;
  best?: number | null;
  /** 「点数は線の精度だけを見ています」を出すか */
  note?: boolean;
}

export function ScoreDisplay({ score, size = 'lg', delta, best, note = true }: ScoreDisplayProps) {
  return (
    <div class={`score score--${size}`}>
      <span class="score__label label">点数</span>
      <span class="score__value num">{Math.round(score)}</span>
      {delta != null && delta !== 0 && (
        <span class={cx('score__delta num', delta > 0 ? 'is-up' : 'is-down')}>
          {delta > 0 ? '▲+' : '▲'}
          {Math.round(delta)}
        </span>
      )}
      {best != null && (
        <span class="score__best">
          自己ベスト <span class="num">{Math.round(best)}</span>
        </span>
      )}
      {note && <span class="score__note">点数は線の精度だけを見ています</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubMetric: サブ指標バー 8px（地 locked、値の色 good/mid）＋ 右に mono 値
// ---------------------------------------------------------------------------

export interface SubMetricProps {
  label: string;
  value: number;
  max?: number;
  /** 省略時は値で good / mid を決める（60 以上で good） */
  tone?: 'good' | 'mid' | 'bad';
}

export function SubMetric({ label, value, max = 100, tone }: SubMetricProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const t = tone ?? (ratio >= 0.6 ? 'good' : 'mid');
  return (
    <div class="submetric">
      <span class="submetric__label">{label}</span>
      <span class="submetric__track" aria-hidden="true">
        <span class={`submetric__fill submetric__fill--${t}`} style={{ width: `${ratio * 100}%` }} />
      </span>
      <span class="submetric__value num">{Math.round(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberMarker: 番号マーカー（リスト 28 / 絵の上 32 ＋ 2px surface 枠）
// ---------------------------------------------------------------------------

export function NumberMarker({ n, onImage = false }: { n: number; onImage?: boolean }) {
  return (
    <span class={cx('marker num', onImage && 'marker--on-image')} aria-hidden="true">
      {n}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 批評カード
// ---------------------------------------------------------------------------

export function CritiqueGood({ items, title = '良い点' }: { items: string[]; title?: string }) {
  return (
    <section class="crit crit--good">
      <h3 class="crit__head">{title}</h3>
      <ul class="crit__good">
        {items.map((g, i) => (
          <li key={i}>
            <Icon name="check" size={18} strokeWidth={2.5} />
            <span>{g}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface CritiqueFixItem {
  where: string;
  what: string;
  /** 直し方（「→ fix」の行） */
  how?: string;
}

export function CritiqueFixes({ issues, title = '直す点' }: { issues: CritiqueFixItem[]; title?: string }) {
  return (
    <section class="crit crit--fix">
      <h3 class="crit__head">{title}</h3>
      <ol class="crit__fixes">
        {issues.map((it, i) => (
          <li key={i}>
            <NumberMarker n={i + 1} />
            <div class="crit__fix-body">
              <p>
                <strong>{it.where}</strong> — {it.what}
              </p>
              {it.how && <p class="crit__how">→ {it.how}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CritiqueNext({ text, title = '次にやる1つ' }: { text: string; title?: string }) {
  return (
    <section class="crit crit--next">
      <h3 class="crit__head">{title}</h3>
      <p class="crit__next">{text}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CounterChip: 累計チップ（60px、chip 地、ラベル 11、数字 mono 20 ＋ 単位）
// ---------------------------------------------------------------------------

export interface CounterChipProps {
  label: string;
  value: string | number;
  unit?: string;
  /** 増えた直後の強調（accent-soft 地 ＋ accent 枠 ＋「▲+20」） */
  delta?: number;
}

export function CounterChip({ label, value, unit, delta }: CounterChipProps) {
  const bumped = delta !== undefined && delta > 0;
  return (
    <div class={cx('counter', bumped && 'is-bumped')}>
      <span class="counter__label">{label}</span>
      <span class="counter__value num">
        {value}
        {unit && <span class="counter__unit">{unit}</span>}
        {bumped && <span class="counter__delta num">▲+{delta}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageTile: 画像タイル（canvas 地 radius 12、左下 種別チップ、右下 mono 日付）
// ---------------------------------------------------------------------------

export interface ImageTileProps {
  src?: string;
  kind?: string;
  date?: string;
  href?: string;
  selected?: boolean;
  label?: string;
  children?: ComponentChildren;
}

export function ImageTile({ src, kind, date, href, selected, label, children }: ImageTileProps) {
  const inner = (
    <>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : children}
      {kind && <span class="itile__kind">{kind}</span>}
      {date && <span class="itile__date num">{date}</span>}
    </>
  );
  const cls = cx('itile', selected && 'is-selected');
  return href ? (
    <a class={cls} href={href} aria-label={label}>
      {inner}
    </a>
  ) : (
    <div class={cls} role={label ? 'img' : undefined} aria-label={label}>
      {inner}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListRow: 設定などの行（56〜64、下罫線、左 15px 題 ＋ 説明 12 ink-3、右 操作）
// ---------------------------------------------------------------------------

export interface ListRowProps {
  title: ComponentChildren;
  desc?: ComponentChildren;
  /** 説明を警告色（danger）にする */
  descTone?: 'default' | 'danger';
  /** 行を縦積みにする（API キー欄など） */
  stacked?: boolean;
  children?: ComponentChildren;
}

export function ListRow({ title, desc, descTone = 'default', stacked, children }: ListRowProps) {
  return (
    <div class={cx('lrow', stacked && 'lrow--stacked')}>
      <div class="lrow__text">
        <span class="lrow__title">{title}</span>
        {desc && <span class={cx('lrow__desc', descTone === 'danger' && 'is-danger')}>{desc}</span>}
      </div>
      {children !== undefined && <div class="lrow__control">{children}</div>}
    </div>
  );
}
