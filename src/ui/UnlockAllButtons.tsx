/**
 * 「全部開放」「進捗に戻す」の 2 つの副ボタン（確認モーダル付き）。
 * ホームの一覧表示の上部と、設定 → 練習 の両方に置く（DESIGN_SYSTEM.md §3 ホーム「一覧表示」）。
 */
import { useState } from 'preact/hooks';
import { Button, Modal, showToast } from './components';
import { resetUnlockedLessons, unlockAllLessons } from './state';

type Ask = 'all' | 'reset' | null;

const COPY = {
  all: {
    title: '全部開放しますか',
    body: 'すべてのレッスンを開放します。ストリークや進捗は変わりません。',
    ok: '開放する',
    done: 'すべて開放しました',
  },
  reset: {
    title: '進捗に戻しますか',
    body: '隠し開放をすべて取り消し、完了状況どおりのロックに戻します。完了した記録は残ります。',
    ok: '戻す',
    done: '進捗に合わせて戻しました',
  },
} as const;

export function UnlockAllButtons({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!ask) return;
    const which = ask;
    setBusy(true);
    try {
      await (which === 'all' ? unlockAllLessons() : resetUnlockedLessons());
      setAsk(null);
      showToast(COPY[which].done);
    } catch (e) {
      showToast(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`, 'danger', 4000);
    } finally {
      setBusy(false);
    }
  };

  const c = ask ? COPY[ask] : null;
  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setAsk('all')}>
        全部開放
      </Button>
      <Button variant="secondary" size={size} onClick={() => setAsk('reset')}>
        進捗に戻す
      </Button>
      <Modal
        open={c !== null}
        onClose={() => setAsk(null)}
        title={c?.title ?? ''}
        width={440}
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => setAsk(null)}>
              やめる
            </Button>
            <Button variant="primary" size="md" disabled={busy} onClick={() => void run()}>
              {c?.ok}
            </Button>
          </>
        }
      >
        <p class="muted">{c?.body}</p>
      </Modal>
    </>
  );
}
