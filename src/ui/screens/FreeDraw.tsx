/**
 * 自由お絵描き #/free（採点なし・記録だけ）。「終わる」で保存（kind 'free'）、5 分以上ならストリークに数える。
 */
import { useEffect, useState } from 'preact/hooks';
import { href, navigate } from '../router';
import { CanvasScreen } from './CanvasScreen';
import { useEngine } from '../lesson/common';
import { recordFreeActivity, saveStrokes } from '../lesson/stateBridge';

export function FreeDraw() {
  const engine = useEngine();
  const [startedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => engine.on('change', () => setN(engine.getStrokes().length)), [engine]);

  const finish = async () => {
    setBusy(true);
    try {
      if (n > 0) await saveStrokes(engine.getStrokes(), 'free', null);
      await recordFreeActivity(Date.now() - startedAt);
    } finally {
      setBusy(false);
    }
    navigate(href.home());
  };

  return (
    <div class="ls-root is-fullscreen">
      <CanvasScreen
        engine={engine}
        task="自由お絵描き — 採点なし・記録だけ。5分以上でストリークに数えます。"
        onExit={() => navigate(href.home())}
        exitLabel="保存せずにホームへ"
        onDone={() => void finish()}
        doneLabel="終わる"
        doneDisabled={busy}
      />
    </div>
  );
}
