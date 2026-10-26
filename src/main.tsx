import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import './ui/theme.css';
import './ui/components/components.css';
import './ui/app.css';
import { App } from './app';
import { route, startRouter } from './ui/router';
import { isLeaveGuarded, onLeaveGuardChange } from './ui/navGuard';
import { showToast } from './ui/components/Overlays';
import { createReloadController } from './ui/updateDefer';

startRouter();

// 新しい版の SW が有効になったら再読み込みする。ただし #/free に保存していない線があるあいだは保留する（ADR-0007 D7）
const reloadController = createReloadController({
  isFreeDraw: () => route.value.name === 'free',
  isGuarded: isLeaveGuarded,
  onGuardChange: onLeaveGuardChange,
  reload: () => window.location.reload(),
  notify: (message) => showToast(message, 'default', 8000),
});
registerSW({ immediate: true, onNeedReload: () => reloadController.needReload() });

// 1 つ前の版の埋め込みのペイントのキャッシュの掃除を SW に頼む（ilust-sup-followup-02、src/sw.ts）。SW は activate の時に開いていた
// （古い版の）ページが残っていないことを確かめてから消す。このページが読み込まれた = 新しい版のページなので、読み込みの後に 1 回頼む
function requestPaintPrune(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'og-paint-prune' });
  } catch {
    // SW が無い・握られていなければ何もしない
  }
}
if (document.readyState === 'complete') requestPaintPrune();
else window.addEventListener('load', requestPaintPrune, { once: true });

render(<App />, document.getElementById('app')!);
