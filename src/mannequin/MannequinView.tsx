/**
 * ポーズ人形の Preact ラッパ。host の大きさに ResizeObserver で追従し、アンマウントで必ず dispose する。
 * WebGL が使えないときは onUnsupported を呼ぶ（呼び出し側で 2D にフォールバック）。
 */
import { useEffect, useRef } from 'preact/hooks';
import type { PoseId } from './poses';
import type { CameraPreset } from './camera';
import { createMannequinView, type MannequinUnsupported, type MannequinViewApi, type ViewState } from './view';
import './mannequin.css';

export interface MannequinViewProps {
  poseId: PoseId;
  /** 変えるとそのプリセットに切り替える（'random' は変わるたびに新しい角度） */
  cameraPreset?: CameraPreset;
  /** マウント時のカメラ・光源（cameraPreset より優先） */
  initialState?: Partial<ViewState>;
  seed?: number;
  onReady?: (api: MannequinViewApi) => void;
  onUnsupported?: (reason: MannequinUnsupported['reason'] | 'context-lost') => void;
  onChange?: (s: ViewState) => void;
  class?: string;
}

export function MannequinView(props: MannequinViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<MannequinViewApi | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    const p = latest.current;
    void createMannequinView(host, {
      poseId: p.poseId,
      cameraPreset: p.cameraPreset,
      state: p.initialState,
      seed: p.seed,
      onChange: (s) => latest.current.onChange?.(s),
      onContextLost: () => latest.current.onUnsupported?.('context-lost'),
    }).then(
      (r) => {
        if (r.unsupported) {
          if (!cancelled) latest.current.onUnsupported?.(r.reason);
          return;
        }
        if (cancelled) {
          r.dispose();
          return;
        }
        apiRef.current = r;
        // 読み込み中に props が変わっていたら合わせる
        r.setPose(latest.current.poseId);
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => r.resize());
          ro.observe(host);
        }
        latest.current.onReady?.(r);
      },
      () => {
        if (!cancelled) latest.current.onUnsupported?.('load-failed');
      },
    );
    return () => {
      cancelled = true;
      ro?.disconnect();
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setPose(props.poseId);
  }, [props.poseId]);

  const firstPreset = useRef(true);
  useEffect(() => {
    if (firstPreset.current) {
      firstPreset.current = false;
      return;
    }
    if (props.cameraPreset) apiRef.current?.setCameraPreset(props.cameraPreset);
  }, [props.cameraPreset]);

  return <div ref={hostRef} class={['mq-host', props.class ?? ''].filter(Boolean).join(' ')} />;
}
