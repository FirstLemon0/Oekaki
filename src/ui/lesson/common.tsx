/**
 * レッスン系で共有する小さな部品とフック。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createCanvasEngine, type CanvasEngine } from '@/canvas';
import { listReferences, saveReference } from '@/data/repo';
import type { ReferenceImage } from '@/data/types';
import { downscaleToWebp } from '@/data/images';
import { Button } from '../components';
import { useObjectUrls } from '../useObjectUrl';
import { loadFigure } from './figures';
import { LsIcon } from './LsIcon';

/** 保存に失敗したときの既定の案内（描画中はトーストを出さないので、画面の中に出す） */
export const SAVE_FAILED = '保存できませんでした。端末の空き容量を確かめて、もう一度押してみましょう。';

/**
 * 保存などの処理中フラグ。入口を ref で止めるので、保存待ちの間に 2 回押されても 1 回しか走らない。
 * 失敗したら error に案内を入れ、押し直せるように戻す。run は成功したら true。
 */
export function useBusy(): {
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<void>, failText?: string) => Promise<boolean>;
  clearError: () => void;
} {
  const ref = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const run = async (fn: () => Promise<void>, failText = SAVE_FAILED): Promise<boolean> => {
    if (ref.current) return false;
    ref.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch {
      if (alive.current) setError(failText);
      return false;
    } finally {
      ref.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, run, clearError: () => setError(null) };
}

/** 画面ごとに 1 つのエンジン（アンマウントで detach は CanvasView が行う） */
export function useEngine(): CanvasEngine {
  return useMemo(() => createCanvasEngine(), []);
}

/** Blob → object URL（差し替え・アンマウントで解放） */
export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** 図解 SVG を inline で出す（色は CSS の color で。currentColor が効く） */
export function Figure({ id, class: cls, label }: { id: string | undefined; class?: string; label?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSvg(null);
    if (id) {
      void loadFigure(id).then((s) => {
        if (alive) setSvg(s);
      });
    }
    return () => {
      alive = false;
    };
  }, [id]);
  if (!id || !svg) return <div class={['ls-figure', 'is-empty', cls].filter(Boolean).join(' ')} aria-hidden="true" />;
  return (
    <div
      class={['ls-figure', cls].filter(Boolean).join(' ')}
      role="img"
      aria-label={label ?? '図解'}
      // 教材リポジトリ内の SVG（外部入力ではない）
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** 画像を取り込むボタン（file input） */
export function ImportButton({
  onFile,
  children,
  variant = 'secondary',
}: {
  onFile: (file: File) => void;
  children?: ComponentChildren;
  variant?: 'primary' | 'secondary';
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        class="visually-hidden"
        data-testid="import-input"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) onFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />
      <Button variant={variant} onClick={() => ref.current?.click()}>
        <LsIcon name="image" size={22} />
        {children ?? '画像を取り込む'}
      </Button>
    </>
  );
}

/** 取込画像を references に保存する（長辺 1600 まで縮小） */
export async function importReference(file: File): Promise<ReferenceImage> {
  let image: Blob = file;
  try {
    image = await downscaleToWebp(file, { maxEdge: 1600 });
  } catch {
    // そのまま保存
  }
  return saveReference({ image, label: file.name || null });
}

/** 取込画像（お手本）を選ぶ。無ければ取り込む */
export function ReferencePicker({ onPick, title = 'お手本を選ぶ' }: { onPick: (ref: ReferenceImage) => void; title?: string }) {
  const [refs, setRefs] = useState<ReferenceImage[] | null>(null);
  useEffect(() => {
    void listReferences().then((r) => setRefs([...r].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))));
  }, []);
  const urls = useObjectUrls(refs ?? []);
  const [failed, setFailed] = useState(false);
  return (
    <div class="ls-refpick">
      <h3 class="ls-refpick__title">{title}</h3>
      {refs === null ? null : refs.length === 0 ? (
        <p class="ls-muted">取り込んだ画像はまだありません。端末の画像を1枚取り込みましょう。</p>
      ) : (
        <ul class="ls-refpick__grid">
          {refs.map((r) => (
            <li key={r.id}>
              <button type="button" class="ls-refpick__tile" onClick={() => onPick(r)} aria-label={r.label ?? '取込画像'}>
                <img src={urls.get(r.id)} alt="" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p class="ls-warn" role="alert">
          取り込めませんでした。別の画像で試しましょう。
        </p>
      )}
      <ImportButton
        variant={refs && refs.length > 0 ? 'secondary' : 'primary'}
        onFile={(f) => {
          setFailed(false);
          void importReference(f).then(onPick, () => setFailed(true));
        }}
      />
    </div>
  );
}

/** 残り秒を数えるタイマー。running が true になるたび（resetKey が変わるたび）seconds から数え直し、0 で onEnd を一度だけ呼ぶ */
export function useCountdown(seconds: number, running: boolean, resetKey: string | number, onEnd: () => void): number {
  const [left, setLeft] = useState(seconds);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setLeft(seconds);
    const id = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(l);
      if (l <= 0) {
        clearInterval(id);
        endRef.current();
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, seconds, resetKey]);
  return left;
}
