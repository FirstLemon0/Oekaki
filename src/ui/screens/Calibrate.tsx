/**
 * 校正 #/calibrate — 直線 5・円 3・楕円 3 を描いて、採点の基準（profile.calibration）を作る。
 * 以後の採点は makeScorers(baseline) を通る（src/ui/lesson/stateBridge.ts の scorers）。
 */
import { useEffect, useState } from 'preact/hooks';
import { calibrate, type CalibrationSamples, type Stroke } from '@/scoring';
import { Button, Icon } from '../components';
import { href, navigate } from '../router';
import { CanvasScreen } from './CanvasScreen';
import { useBusy, useEngine } from '../lesson/common';
import { CALIBRATION_PLAN } from '../lesson/limits';
import { saveCalibrationBaseline } from '../lesson/stateBridge';

export function Calibrate() {
  const engine = useEngine();
  const [phase, setPhase] = useState(0);
  const [n, setN] = useState(0);
  const [samples, setSamples] = useState<CalibrationSamples>({});
  const [done, setDone] = useState(false);
  const { busy, error, run } = useBusy();

  useEffect(() => engine.on('change', () => setN(engine.getStrokes().filter((s) => s.length >= 3).length)), [engine]);

  const plan = CALIBRATION_PLAN[phase];
  const total = CALIBRATION_PLAN.reduce((a, p) => a + p.count, 0);
  const before = CALIBRATION_PLAN.slice(0, phase).reduce((a, p) => a + p.count, 0);

  const next = async () => {
    if (!plan) return;
    const strokes: Stroke[] = engine.getStrokes().filter((s) => s.length >= 3);
    const merged: CalibrationSamples = { ...samples, [plan.key]: strokes };
    setSamples(merged);
    if (phase + 1 < CALIBRATION_PLAN.length) {
      engine.loadStrokes([]);
      setN(0);
      setPhase(phase + 1);
      return;
    }
    // 最後の組は保存できるまで線を残す（失敗しても押し直せる）
    const ok = await run(async () => {
      await saveCalibrationBaseline(calibrate(merged));
    });
    if (ok) setDone(true);
  };

  if (done) {
    return (
      <div class="ls-root">
        <div class="ls-reviewdone">
          <span class="ls-done__check" aria-hidden="true">
            <Icon name="check" size={26} strokeWidth={2.5} />
          </span>
          <h2 class="ls-done__title">基準を作りました</h2>
          <p class="ls-muted">これからの点数は、今描いた線を 60 点の目安にして計ります。上がった分が、そのまま伸びです。</p>
          <div class="ls-modal__actions">
            <Button variant="secondary" onClick={() => navigate(href.settings('scoring'))}>
              設定へ戻る
            </Button>
            <Button variant="primary" onClick={() => navigate(href.home())}>
              ホームへ
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div class="ls-root is-fullscreen">
      <CanvasScreen
        key={phase}
        engine={engine}
        task={`校正 ${phase + 1}/3 · ${plan.label}: ${plan.instruction}`}
        counter={`${Math.min(before + n, before + plan.count)}/${total}`}
        onExit={() => navigate(href.settings('scoring'))}
        exitLabel="設定へ戻る"
        onDone={() => void next()}
        doneLabel={phase + 1 < CALIBRATION_PLAN.length ? '次へ' : '基準を作る'}
        doneDisabled={n < plan.count || busy}
        error={error}
      />
    </div>
  );
}
