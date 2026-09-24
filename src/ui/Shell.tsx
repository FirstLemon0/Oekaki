/**
 * 共通の枠: 左レール 96px（横向き）／下ナビ 88px（縦向き・幅 < 1000px）。
 */
import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './components/Icon';
import { href, type NavTab } from './router';
import { Logo } from './components/Logo';

const TABS: { tab: NavTab; label: string; icon: IconName; to: string }[] = [
  { tab: 'home', label: 'ホーム', icon: 'home', to: href.home() },
  { tab: 'gallery', label: 'ギャラリー', icon: 'gallery', to: href.gallery() },
  { tab: 'settings', label: '設定', icon: 'settings', to: href.settings() },
];

export function Shell({ active, children }: { active: NavTab | null; children: ComponentChildren }) {
  return (
    <div class="shell">
      <nav class="nav" aria-label="メイン">
        <a class="nav__logo" href={href.home()} aria-label="成長通 ホーム">
          <Logo size={40} />
        </a>
        <ul class="nav__list">
          {TABS.map((t) => (
            <li key={t.tab}>
              <a
                class={active === t.tab ? 'nav__item is-active' : 'nav__item'}
                href={t.to}
                aria-current={active === t.tab ? 'page' : undefined}
              >
                <Icon name={t.icon} size={24} />
                <span class="nav__label">{t.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main class="shell__main">{children}</main>
    </div>
  );
}
