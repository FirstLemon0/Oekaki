import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import './ui/theme.css';
import './ui/components/components.css';
import './ui/app.css';
import { App } from './app';
import { startRouter } from './ui/router';

startRouter();
registerSW({ immediate: true });

render(<App />, document.getElementById('app')!);
