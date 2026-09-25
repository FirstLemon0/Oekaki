/**
 * お絵描き v2 の小パネルとピル: 塗りつぶし・図形・ズーム率。
 * 小パネルはペン・消しゴムと同じ glass の ls-toolpanel（選択中のツールをもう一度タップ／長押しで開く）。
 */
import { useEffect, useState } from 'preact/hooks';
import type { CanvasEngine } from '@/canvas';
import { Slider } from '../components';
import { SHAPE_LABEL, SHAPE_ORDER, toleranceFromPercent, toleranceToPercent, type FillPrefs, type ShapeTool } from '../screens/canvasPrefs';
import { PaintIcon } from './PaintIcon';

export function FillPanel({ prefs, onChange }: { prefs: FillPrefs; onChange: (next: FillPrefs) => void }) {
  const pct = toleranceToPercent(prefs.tolerance);
  return (
    <div class="ls-pop ls-toolpanel" role="group" aria-label="塗りつぶしの設定">
      <span class="ls-toolpanel__title">塗りつぶし</span>
      <label class="ls-toolpanel__row">
        <span class="ls-toolpanel__label">許容値</span>
        <Slider value={pct} min={0} max={100} onInput={(v) => onChange({ ...prefs, tolerance: toleranceFromPercent(v) })} label="塗りつぶしの許容値" width={150} />
        <span class="num ls-pop__val">{pct}</span>
      </label>
      <div class="ls-toolpanel__row">
        <span class="ls-toolpanel__label">境界</span>
        <div class="pt-seg" role="radiogroup" aria-label="塗りつぶしの境界">
          {(
            [
              ['layer', 'このレイヤー'],
              ['all', 'すべて'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={prefs.reference === v}
              class={prefs.reference === v ? 'pt-seg__item is-selected' : 'pt-seg__item'}
              onClick={() => onChange({ ...prefs, reference: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p class="ls-toolpanel__note">色はペンの色を使います。「すべて」は見えている絵全体の線を境界にして、今のレイヤーに塗ります。</p>
    </div>
  );
}

export function ShapePanel({ shape, onPick }: { shape: ShapeTool; onPick: (s: ShapeTool) => void }) {
  return (
    <div class="ls-pop ls-toolpanel pt-shapepanel" role="group" aria-label="図形の種類">
      <span class="ls-toolpanel__title">図形</span>
      <div class="pt-shapes" role="radiogroup" aria-label="図形">
        {SHAPE_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={shape === s}
            class={shape === s ? 'ls-toolpanel__preset is-selected' : 'ls-toolpanel__preset'}
            onClick={() => onPick(s)}
          >
            <PaintIcon name={s} size={24} />
            <span>{SHAPE_LABEL[s]}</span>
          </button>
        ))}
      </div>
      <p class="ls-toolpanel__note">ドラッグで描きます。線の色・太さはペンの設定です。</p>
    </div>
  );
}

/** 右上のズーム率（mono）。タップで「全体を表示」。回転していれば「回転を戻す」も出す */
export function ZoomPill({ engine }: { engine: CanvasEngine }) {
  const [view, setView] = useState(() => engine.getView());
  useEffect(() => {
    setView(engine.getView());
    return engine.on('viewchange', () => setView(engine.getView()));
  }, [engine]);
  const pct = Math.round(view.zoom * 100);
  const rotated = Math.abs(view.rotationDeg % 360) > 0.05;
  return (
    <div class="pt-zoom" data-testid="zoom-pill">
      {rotated && (
        <button type="button" class="pt-zoom__rot" aria-label="回転を戻す" title="回転を戻す" onClick={() => engine.setView({ rotationDeg: 0 })}>
          <PaintIcon name="rotate-reset" size={20} />
          <span class="num">{Math.round(view.rotationDeg)}°</span>
        </button>
      )}
      <button type="button" class="pt-zoom__pct" aria-label={`表示 ${pct}%（タップで全体を表示）`} title="全体を表示" onClick={() => engine.fitView()}>
        <span class="num">{pct}%</span>
      </button>
    </div>
  );
}
