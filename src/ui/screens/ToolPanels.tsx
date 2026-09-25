/**
 * ツールバーの小パネル（ペン・消しゴム）。DESIGN_SYSTEM §2 ツールバー。
 *
 * 選択中のツールをもう一度タップ（またはロングプレス 400ms）で開く。glass 地、当たり判定 48px。
 * 紙に触れた（pointerdown）ら閉じる（CanvasScreen 側）。値の保存も CanvasScreen 側。
 * 補助線（ツールバーの「補助線」、点線の斜め線のアイコン）は設定が固定（1.5px・ink-2・不透明度 0.35）なので小パネルは無い。
 * 補助線は採点・本数・累計に数えない。
 */
import { PALETTE_COLORS, PEN_PRESETS, type PenPreset, type PenStyle } from '@/canvas';
import { Slider } from '../components';
import { HsvPicker } from '../paint/HsvPicker';
import { normalizeColor } from './canvasPrefs';
import { PEN_OPACITY, PEN_PRESET_LABEL, PEN_PRESET_ORDER, PEN_SIZE } from './canvasPrefs';

// ---------------------------------------------------------------------------
// 色
// ---------------------------------------------------------------------------

export interface Swatch {
  /** undefined ＝ 墨（テーマの ink に追従） */
  value: string | undefined;
  label: string;
}

/**
 * パレットの 14 色（エンジンの PALETTE_COLORS）。先頭の「墨」は固定色ではなく
 * テーマの ink（color 未指定）として扱う（ダークでも紙に合った墨になる）。
 */
export function paletteSwatches(): Swatch[] {
  return PALETTE_COLORS.map((c, i) => ({ value: i === 0 ? undefined : c.color, label: c.label }));
}

const INK_LABEL = '墨（テーマの色）';

/** テーマの墨色（CSS 変数 --color-ink）を `#rrggbb` で。読めなければ既定の墨 */
export function themeInkHex(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim();
    return normalizeColor(v) ?? '#2b2a28';
  } catch {
    return '#2b2a28';
  }
}

/** ツールバーのペンアイコンの下に出す現在色 */
export function penDotColor(style: PenStyle, locked: boolean): string {
  return locked || !style.color ? 'var(--color-ink)' : style.color;
}

// ---------------------------------------------------------------------------
// プリセットの見本線（線画。太さの違いで種類を見せる）
// ---------------------------------------------------------------------------

function PresetGlyph({ preset }: { preset: PenPreset }) {
  const d = 'M5 17 C 12 5, 20 21, 27 11 S 36 7, 39 9';
  return (
    <svg width="44" height="24" viewBox="0 0 44 24" fill="none" aria-hidden="true">
      {preset === 'pencil' && <path d={d} stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="7 1.5" opacity="0.85" />}
      {preset === 'pen' && <path d={d} stroke="currentColor" stroke-width="2.25" stroke-linecap="round" />}
      {preset === 'brush' && (
        <>
          <path d={d} stroke="currentColor" stroke-width="4.5" stroke-linecap="round" opacity="0.9" />
          <path d="M3 18 L6 16.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
        </>
      )}
      {preset === 'marker' && <path d={d} stroke="currentColor" stroke-width="8" stroke-linecap="square" opacity="0.4" />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ペン
// ---------------------------------------------------------------------------

export function PenPanel({
  style,
  locked,
  recent,
  onChange,
  onCustomColor,
  full,
}: {
  /** フルツール（自由お絵描きなど）: HSV ピッカーと直近 6 色を出す（「その他」の代わり） */
  full?: boolean;
  style: PenStyle;
  /** 採点するドリル: ペン（墨）に固定 */
  locked: boolean;
  recent: readonly string[];
  onChange: (next: PenStyle) => void;
  /** 「その他」で任意色を決めたとき（直近に記憶する） */
  onCustomColor: (color: string) => void;
}) {
  if (locked) {
    return (
      <div class="ls-pop ls-toolpanel" role="group" aria-label="ペンの設定">
        <span class="ls-toolpanel__title">ペン</span>
        <p class="ls-toolpanel__note">採点中は「ペン」・墨に固定しています。線の精度を見るためです。</p>
      </div>
    );
  }

  const setColor = (color: string | undefined) => {
    const rest: PenStyle = { ...style };
    delete rest.color;
    onChange(color ? { ...rest, color } : rest);
  };
  const swatches = paletteSwatches();
  const cur = style.color?.toLowerCase();
  const known = new Set(swatches.map((s) => s.value?.toLowerCase()));
  const extra = recent.filter((c) => !known.has(c));

  return (
    <div class={full ? 'ls-pop ls-toolpanel pt-penpanel' : 'ls-pop ls-toolpanel'} role="group" aria-label="ペンの設定">
      <span class="ls-toolpanel__title">ペン</span>
      <div class="ls-toolpanel__presets" role="radiogroup" aria-label="ペンの種類">
        {PEN_PRESET_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={style.preset === p}
            class={style.preset === p ? 'ls-toolpanel__preset is-selected' : 'ls-toolpanel__preset'}
            onClick={() =>
              onChange({
                ...style,
                preset: p,
                // 種類を変えたらその種類の既定の太さ・不透明度にする（色はそのまま）
                size: PEN_PRESETS[p].size,
                opacity: PEN_PRESETS[p].opacity,
              })
            }
          >
            <PresetGlyph preset={p} />
            <span>{PEN_PRESET_LABEL[p]}</span>
          </button>
        ))}
      </div>
      <label class="ls-toolpanel__row">
        <span class="ls-toolpanel__label">太さ</span>
        <Slider value={style.size} min={PEN_SIZE.min} max={PEN_SIZE.max} onInput={(v) => onChange({ ...style, size: v })} label="ペンの太さ" width={150} />
        <span class="num ls-pop__val">{style.size}</span>
      </label>
      <label class="ls-toolpanel__row">
        <span class="ls-toolpanel__label">不透明度</span>
        <Slider
          value={Math.round(style.opacity * 100)}
          min={Math.round(PEN_OPACITY.min * 100)}
          max={100}
          onInput={(v) => onChange({ ...style, opacity: v / 100 })}
          label="ペンの不透明度"
          width={150}
        />
        <span class="num ls-pop__val">{Math.round(style.opacity * 100)}%</span>
      </label>
      {full && (
        <HsvPicker color={style.color ?? themeInkHex()} onInput={(hex) => setColor(hex)} onCommit={(hex) => onCustomColor(hex)} />
      )}
      {full && recent.length > 0 && (
        <div class="pt-recent">
          <span class="ls-toolpanel__label">最近の色</span>
          <div class="ls-toolpanel__swatches pt-recent__list" role="radiogroup" aria-label="最近の色">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cur === c}
                aria-label={`最近の色 ${c}`}
                title={c}
                class={cur === c ? 'ls-swatch is-selected' : 'ls-swatch'}
                onClick={() => setColor(c)}
              >
                <span class="ls-swatch__chip" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="ls-toolpanel__swatches" role="radiogroup" aria-label="色">
        {[...swatches, ...(full ? [] : extra).map((c) => ({ value: c as string | undefined, label: `最近の色 ${c}` }))].map((s) => {
          const v = s.value?.toLowerCase();
          const on = cur === v;
          return (
            <button
              key={v ?? 'ink'}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={v ? s.label : INK_LABEL}
              title={v ? s.label : INK_LABEL}
              class={on ? 'ls-swatch is-selected' : 'ls-swatch'}
              onClick={() => setColor(s.value)}
            >
              <span class="ls-swatch__chip" style={{ background: s.value ?? 'var(--color-ink)' }} />
            </button>
          );
        })}
        {!full && (
        <label class="ls-swatch ls-swatch--other" title="その他の色">
          <span class="ls-swatch__chip ls-swatch__chip--other" aria-hidden="true" />
          <input
            type="color"
            class="ls-swatch__input"
            aria-label="その他の色"
            value={cur ?? '#2a2926'}
            onInput={(e) => setColor((e.currentTarget as HTMLInputElement).value)}
            onChange={(e) => onCustomColor((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        )}
      </div>
    </div>
  );
}
