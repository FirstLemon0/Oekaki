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

render(<App />, document.getElementById('app')!);
