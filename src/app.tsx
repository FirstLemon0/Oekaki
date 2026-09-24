import { useEffect } from 'preact/hooks';
import { ToastHost } from './ui/components';
import { Shell } from './ui/Shell';
import { navigate, navTabOf, route, type Route } from './ui/router';
import { initState, loadError, ready } from './ui/state';
import { Home } from './ui/screens/Home';
import { Settings } from './ui/screens/Settings';
import { Gallery } from './ui/screens/Gallery';
import { GalleryDetail } from './ui/screens/GalleryDetail';
import { Placeholder } from './ui/screens/Placeholder';
import { LessonPlayer, isReviewLessonId } from './ui/screens/LessonPlayer';
import { FreeDraw } from './ui/screens/FreeDraw';
import { Calibrate } from './ui/screens/Calibrate';
import { Review } from './ui/screens/Review';
import { CritiqueRoute } from './ui/screens/CritiqueScreen';
import './ui/lesson/lesson.css';

/** レール・下ナビを出さない全画面のルート（レッスン・キャンバス・批評） */
function isFullscreen(r: Route): boolean {
  return r.name === 'lesson' || r.name === 'lessonStep' || r.name === 'free' || r.name === 'calibrate' || r.name === 'review' || r.name === 'critique';
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function FullscreenScreen({ r }: { r: Route }) {
  switch (r.name) {
    case 'lesson':
    case 'lessonStep': {
      // ホームの復習ノードは #/lesson/review-<drillType> で来る
      const review = isReviewLessonId(r.id);
      if (review) return <Redirect to={`#/review/${encodeURIComponent(review)}`} />;
      return <LessonPlayer key={r.id} id={r.id} step={r.name === 'lessonStep' ? r.step : undefined} />;
    }
    case 'free':
      return <FreeDraw />;
    case 'calibrate':
      return <Calibrate />;
    case 'review':
      return <Review key={r.drillType} drillType={r.drillType} />;
    case 'critique':
      return <CritiqueRoute key={r.id} drawingId={r.id} />;
    default:
      return null;
  }
}

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
    case 'notFound':
      return <Placeholder title="ページが見つかりません" body={`${r.path} はありません。ホームへ戻りましょう。`} />;
    default:
      return null;
  }
}

export function App() {
  useEffect(() => {
    void initState();
  }, []);

  const r = route.value;

  if (isFullscreen(r)) {
    return (
      <>
        {loadError.value && (
          <div class="load-error" role="alert">
            {loadError.value}
          </div>
        )}
        {ready.value ? <FullscreenScreen r={r} /> : <div class="loading" aria-busy="true" />}
        {/* レッスン中の短い知らせ（例: 選択式を飛ばした）。キャンバス上では呼び出し側が出さない */}
        <ToastHost />
      </>
    );
  }

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
