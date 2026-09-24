import { useEffect } from 'preact/hooks';
import { ToastHost } from './ui/components';
import { Shell } from './ui/Shell';
import { navTabOf, route } from './ui/router';
import { initState, loadError, ready } from './ui/state';
import { Home } from './ui/screens/Home';
import { Settings } from './ui/screens/Settings';
import { Gallery } from './ui/screens/Gallery';
import { GalleryDetail } from './ui/screens/GalleryDetail';
import { Placeholder } from './ui/screens/Placeholder';

function Screen() {
  const r = route.value;
  switch (r.name) {
    case 'home':
      return <Home />;
    case 'settings':
      return <Settings section={r.section} />;
    case 'gallery':
      return <Gallery />;
    case 'galleryDetail':
      return <GalleryDetail id={r.id} />;
    case 'calibrate':
      return <Placeholder title="校正" body="直線・円・楕円を数本描いて、採点の基準を作ります。この画面は準備中です。" />;
    case 'lesson':
    case 'lessonStep':
      return <Placeholder title="レッスン" body={`レッスン画面は準備中です（${r.id}）。`} />;
    case 'free':
      return <Placeholder title="自由お絵描き" body="採点なし・記録だけの枠です。この画面は準備中です。" />;
    case 'notFound':
      return <Placeholder title="ページが見つかりません" body={`${r.path} はありません。ホームへ戻りましょう。`} />;
  }
}

export function App() {
  useEffect(() => {
    void initState();
  }, []);

  const r = route.value;

  return (
    <>
      <Shell active={navTabOf(r)}>
        {loadError.value && (
          <div class="load-error" role="alert">
            {loadError.value}
          </div>
        )}
        {ready.value ? <Screen /> : <div class="loading" aria-busy="true" />}
      </Shell>
      <ToastHost />
    </>
  );
}
