/**
 * 遅延の画面（動的 import）。読み込みが終わるまでは読み込み中の表示、失敗したら再読み込みの案内を出す。
 * 自由お絵描き（#/free）を入口の静的な依存から外すために使う（ADR-0007 D7、scripts/check-bundle.mjs が確かめる）。
 */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let cached: ComponentType<P> | null = null;
  let inflight: Promise<ComponentType<P>> | null = null;
  const get = () => {
    if (!inflight) {
      inflight = load().then((c) => {
        cached = c;
        return c;
      });
      // 失敗したら次の表示でやり直せるようにする
      inflight.catch(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  function Lazy(props: P) {
    const [Comp, setComp] = useState<ComponentType<P> | null>(() => cached);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (Comp) return;
      let alive = true;
      get().then(
        (c) => {
          if (alive) setComp(() => c);
        },
        () => {
          if (alive) setFailed(true);
        },
      );
      return () => {
        alive = false;
      };
    }, [Comp]);
    if (Comp) return <Comp {...props} />;
    if (failed) {
      return (
        <div class="load-error" role="alert">
          画面を読み込めませんでした。通信を確かめてから、ページを再読み込みしてください。
        </div>
      );
    }
    return <div class="loading" aria-busy="true" />;
  }
  return Lazy;
}
