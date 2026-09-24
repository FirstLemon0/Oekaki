import { useEffect, useRef } from 'preact/hooks';
import type { CanvasEngine } from './types';

export interface CanvasViewProps {
  engine: CanvasEngine;
  class?: string;
}

/** 描画面だけを出す薄いラッパ。ツールバーは UI 側が描く。親要素の大きさいっぱいに広がる。 */
export function CanvasView({ engine, class: cls }: CanvasViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    engine.attach(el);
    return () => engine.detach();
  }, [engine]);
  return (
    <div
      ref={ref}
      class={cls}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}
    />
  );
}
