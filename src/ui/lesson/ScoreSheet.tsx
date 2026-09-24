/**
 * 採点シート（DESIGN_SYSTEM §3 キャンバス）。高さ 400、取っ手、
 * 左: 点数 mono 120 ＋ ▲差分（自己ベスト比）＋自己ベスト＋注記
 * 中: ヒートマップ（最後の 1 本。目標線は破線）
 * 右: 助言箱＋サブ指標バー。フッタ右寄せ 副「次へ」・主「もう一回」
 */
import type { Drawing, ScoreResult } from '@/scoring';
import { Button } from '../components';
import { heatBand } from './drillSetup';

const SUB_LABEL: Record<string, string> = {
  'line.rmse': 'まっすぐさ',
  'line.p90': '大きなズレ',
  'line.endpoint': '始点・終点',
  'line.direction': '向きの安定',
  'line.orient': '向き',
  'line.length': '長さ',
  'circle.size': '大きさ',
  'curve.taper': '抜き',
  'curve.chamfer': '目標との近さ',
  'curve.smooth': 'なめらかさ',
  'circle.fit': '丸さ',
  'circle.closure': '閉じ',
  'ellipse.fit': '楕円の形',
  'ellipse.degree': '度合い',
  'ellipse.angle': '向き',
  pressure: '筆圧',
  'hatch.spacing': '間隔',
  'hatch.angle': '角度',
  'hatch.straight': 'まっすぐさ',
  'trace.chamfer': 'お手本との近さ',
  'trace.iou': '重なり',
  jitter: 'ブレの少なさ',
};

export function subLabel(key: string): string {
  return SUB_LABEL[key] ?? key;
}

/** ヒートマップ（strokes と heat は同じ並び） */
export function Heatmap({ strokes, heat, target }: { strokes: Drawing; heat: number[][]; target?: Drawing | null }) {
  const all = [...strokes, ...(target ?? [])].flat();
  if (all.length === 0) return <div class="ls-heat" />;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of all) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const pad = Math.max(12, Math.max(x1 - x0, y1 - y0) * 0.08);
  const vb = `${x0 - pad} ${y0 - pad} ${Math.max(1, x1 - x0 + pad * 2)} ${Math.max(1, y1 - y0 + pad * 2)}`;
  return (
    <div class="ls-heat">
      <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="ズレの色分け">
        {(target ?? []).map((s, i) => (
          <polyline key={`t${i}`} class="ls-heat__target" points={s.map((q) => `${q.x},${q.y}`).join(' ')} />
        ))}
        {strokes.map((s, si) =>
          s.slice(1).map((q, i) => {
            const a = s[i]!;
            const h = heat[si]?.[i + 1] ?? heat[si]?.[i] ?? 0;
            return <line key={`${si}-${i}`} class={`ls-heat__seg is-${heatBand(h)}`} x1={a.x} y1={a.y} x2={q.x} y2={q.y} />;
          }),
        )}
      </svg>
    </div>
  );
}

export interface ScoreSheetProps {
  result: ScoreResult;
  strokes: Drawing;
  target?: Drawing | null;
  /** この回を含めない自己ベスト */
  best: number | null;
  onNext: () => void;
  onAgain: () => void;
  nextLabel?: string;
  heatLabel?: string;
  /** 保存中（ボタンを止める） */
  busy?: boolean;
  /** 保存に失敗したときの案内（シートの中に出す。描画中はトーストを出さない） */
  error?: string | null;
  /** 「もう一回」の文言 */
  againLabel?: string;
}

export function ScoreSheet({
  result,
  strokes,
  target,
  best,
  onNext,
  onAgain,
  nextLabel = '次へ',
  heatLabel = 'ヒートマップ — 最後の1本',
  busy = false,
  error = null,
  againLabel = 'もう一回',
}: ScoreSheetProps) {
  const delta = best === null ? null : result.score - best;
  // 5 つまで。多いときは低い（直すところのある）ものを残し、並びは元の順
  const all = Object.entries(result.sub);
  const keep = new Set(
    [...all]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([k]) => k),
  );
  const subs = all.filter(([k]) => keep.has(k));
  return (
    <div class="ls-sheet" role="dialog" aria-label="採点">
      <div class="ls-sheet__grip" aria-hidden="true" />
      <div class="ls-sheet__grid">
        <div class="ls-sheet__score">
          <span class="ls-label">点数</span>
          <span class="ls-bigscore num" data-testid="score">
            {result.score}
          </span>
          {delta !== null && (
            <span class={delta >= 0 ? 'ls-delta num is-up' : 'ls-delta num is-down'}>
              {delta >= 0 ? `▲+${delta}` : `▼${delta}`}
            </span>
          )}
          <span class="ls-best">
            自己ベスト <span class="num">{best === null ? result.score : Math.max(best, result.score)}</span>
          </span>
          <span class="ls-note">点数は線の精度だけを見ています</span>
        </div>
        <div class="ls-sheet__heat">
          <span class="ls-label">{heatLabel}</span>
          <Heatmap strokes={strokes} heat={result.heat} target={target} />
          <div class="ls-legend">
            <span class="ls-legend__grad" aria-hidden="true" />
            <span>ズレ 小→大</span>
            {target && target.length > 0 && (
              <>
                <span class="ls-legend__dash" aria-hidden="true" />
                <span>目標線</span>
              </>
            )}
          </div>
        </div>
        <div class="ls-sheet__advice">
          <p class="ls-advice">{result.hint}</p>
          <ul class="ls-subs">
            {subs.map(([k, v]) => (
              <li key={k} class="ls-sub">
                <span class="ls-sub__label">{subLabel(k)}</span>
                <span class="ls-sub__bar" aria-hidden="true">
                  <span class={v >= 60 ? 'ls-sub__fill is-good' : 'ls-sub__fill is-mid'} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
                </span>
                <span class="ls-sub__val num">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div class="ls-sheet__foot">
        {error && (
          <p class="ls-sheet__error" role="alert">
            {error}
          </p>
        )}
        <Button variant="secondary" disabled={busy} onClick={onNext}>
          {busy ? '保存しています…' : nextLabel}
        </Button>
        <Button variant="primary" icon="undo" class="ls-sheet__primary" disabled={busy} onClick={onAgain}>
          {againLabel}
        </Button>
      </div>
    </div>
  );
}
