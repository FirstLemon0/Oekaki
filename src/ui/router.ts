/**
 * ハッシュルーティング（ARCHITECTURE.md 契約 3）。
 *
 *   #/                        home
 *   #/lesson/:id              lesson
 *   #/lesson/:id/step/:n      lessonStep
 *   #/free                    free（?save=after で月次の描き直し＝After として保存）
 *   #/gallery                 gallery
 *   #/gallery/:id             galleryDetail
 *   #/settings                settings
 *   #/calibrate               calibrate
 *   #/review/:drillType       review（復習: 該当ドリル 10 本）
 *   #/critique/:drawingId     critique（批評の履歴・送信）
 *   それ以外                   notFound
 */
import { signal } from '@preact/signals';
import { navigateAfterGuard } from './navGuard';

export type Route =
  | { name: 'home' }
  | { name: 'lesson'; id: string }
  | { name: 'lessonStep'; id: string; step: number }
  | { name: 'free'; save?: 'before' | 'after' }
  | { name: 'gallery' }
  | { name: 'galleryDetail'; id: string }
  | { name: 'settings'; section?: string }
  | { name: 'calibrate' }
  | { name: 'review'; drillType: string }
  | { name: 'critique'; id: string }
  | { name: 'notFound'; path: string };

/** ナビ（レール／下ナビ）で選択中にするタブ */
export type NavTab = 'home' | 'gallery' | 'settings';

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const segs = path.split('/').filter(Boolean).map(decode);
  const query = new URLSearchParams(queryPart);

  if (segs.length === 0) return { name: 'home' };

  const [head, a, b, c] = segs;
  switch (head) {
    case 'lesson':
      if (a && segs.length === 2) return { name: 'lesson', id: a };
      if (a && b === 'step' && c && segs.length === 4 && /^\d+$/.test(c)) {
        return { name: 'lessonStep', id: a, step: Number(c) };
      }
      break;
    case 'free':
      if (segs.length === 1) {
        const save = query.get('save');
        return save === 'after' || save === 'before' ? { name: 'free', save } : { name: 'free' };
      }
      break;
    case 'gallery':
      if (segs.length === 1) return { name: 'gallery' };
      if (a && segs.length === 2) return { name: 'galleryDetail', id: a };
      break;
    case 'settings':
      if (segs.length === 1) {
        const section = query.get('section') ?? undefined;
        return section ? { name: 'settings', section } : { name: 'settings' };
      }
      break;
    case 'calibrate':
      if (segs.length === 1) return { name: 'calibrate' };
      break;
    case 'review':
      if (a && segs.length === 2) return { name: 'review', drillType: a };
      break;
    case 'critique':
      if (a && segs.length === 2) return { name: 'critique', id: a };
      break;
  }
  return { name: 'notFound', path };
}

/** ルートからハッシュ文字列を作る（リンク用）。 */
export const href = {
  home: () => '#/',
  lesson: (id: string) => `#/lesson/${encodeURIComponent(id)}`,
  lessonStep: (id: string, n: number) => `#/lesson/${encodeURIComponent(id)}/step/${n}`,
  free: (save?: 'before' | 'after') => (save ? `#/free?save=${save}` : '#/free'),
  gallery: () => '#/gallery',
  galleryDetail: (id: string) => `#/gallery/${encodeURIComponent(id)}`,
  settings: (section?: string) => (section ? `#/settings?section=${encodeURIComponent(section)}` : '#/settings'),
  calibrate: () => '#/calibrate',
  review: (drillType: string) => `#/review/${encodeURIComponent(drillType)}`,
  critique: (drawingId: string) => `#/critique/${encodeURIComponent(drawingId)}`,
};

export function navTabOf(route: Route): NavTab | null {
  switch (route.name) {
    case 'home':
      return 'home';
    case 'gallery':
    case 'galleryDetail':
      return 'gallery';
    case 'settings':
    case 'calibrate':
      return 'settings';
    default:
      return null;
  }
}

const currentHash = () => (typeof location !== 'undefined' ? location.hash : '');

export const route = signal<Route>(parseHash(currentHash()));

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#${to}`;
  // 離脱ガード（navGuard）の 1 段が積んであれば、先に戻してから移動する
  if (typeof history !== 'undefined' && typeof location !== 'undefined') navigateAfterGuard(() => go(target, opts));
  else go(target, opts);
}

function go(target: string, opts: { replace?: boolean }): void {
  if (opts.replace) {
    history.replaceState(null, '', target);
    route.value = parseHash(target);
  } else if (location.hash === target) {
    route.value = parseHash(target);
  } else {
    location.hash = target;
  }
}

let started = false;

/** hashchange を購読する。main から一度だけ呼ぶ。 */
export function startRouter(): void {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', () => {
    route.value = parseHash(location.hash);
  });
  route.value = parseHash(location.hash);
}
