/**
 * ポーズ人形のビュー本体。three は動的 import で遅延読み込みする（初期バンドルに含めない）。
 * 描画は「必要なときだけ 1 フレーム」。アニメーションループは持たない（描画中に人形が動かない）。
 */
import type * as THREE from 'three';
import { buildMannequin, makeContactShadow } from './build';
import { resolvePose, type PoseId, type ResolvedPose } from './poses';
import {
  cameraPosition,
  clampCamera,
  CAMERA_PRESETS,
  DEFAULT_LIGHT,
  dragCamera,
  frameBounds,
  pinchCamera,
  presetCamera,
  randomLight,
  sphericalDir,
  wheelCamera,
  type CameraPreset,
  type CameraState,
  type LightState,
} from './camera';
import { mulberry32, type Rng } from './rng';
import { alphaBounds, flipRows, parseCssColor, tintSolid, unpremultiply, type PixelBounds } from './silhouette';

export interface ViewState {
  camera: CameraState;
  light: LightState;
}

export interface MannequinOptions {
  poseId?: PoseId;
  cameraPreset?: CameraPreset;
  /** 初期のカメラ・光源（cameraPreset より優先） */
  state?: Partial<ViewState>;
  /** 「ランダムな角度」「光源ランダム」の乱数シード（省略時は Math.random） */
  seed?: number;
  /** シルエットの色（省略時は host の CSS 変数 --color-accent） */
  accent?: string;
  /** ユーザー操作でカメラが変わったとき */
  onChange?: (s: ViewState) => void;
  /** WebGL コンテキストを失ったとき（呼び出し側で 2D に切り替える） */
  onContextLost?: () => void;
}

export interface SnapshotSize {
  width: number;
  height: number;
}

export interface SilhouetteSnapshot extends SnapshotSize {
  blob: Blob;
  /** 人形の不透明部分の外接矩形（px） */
  bounds: PixelBounds | null;
}

export interface CompareSnapshot extends SnapshotSize {
  /** 通常の色の人形（背景透明・影つき） */
  image: Blob;
  /** accent 単色のシルエット（背景透明） */
  silhouette: Blob;
  bounds: PixelBounds | null;
}

export interface MannequinViewApi {
  readonly unsupported: false;
  setPose(id: PoseId): void;
  setCameraPreset(p: CameraPreset): void;
  /** 正面に戻す */
  resetCamera(): void;
  randomizeLight(): void;
  getState(): ViewState;
  setState(s: Partial<ViewState>): void;
  /** host の大きさに合わせ直す（ResizeObserver から呼ぶ） */
  resize(): void;
  /** 見比べ「重ねる」用: 背景透明・人形を単色 accent で描いた PNG */
  snapshotSilhouette(size?: SnapshotSize): Promise<Blob>;
  snapshotSilhouetteWithBounds(size?: SnapshotSize): Promise<SilhouetteSnapshot>;
  /** 見比べ用に通常画像とシルエットを同じ瞬間に撮る（呼んだ直後に dispose してよい） */
  snapshotForCompare(size?: SnapshotSize): Promise<CompareSnapshot>;
  dispose(): void;
}

export interface MannequinUnsupported {
  readonly unsupported: true;
  reason: 'no-webgl2' | 'load-failed' | 'renderer-failed';
}

export type MannequinViewResult = MannequinViewApi | MannequinUnsupported;

/** 360×520 の 2 倍（棒人形の viewBox と同じ比率） */
export const SNAPSHOT_SIZE: SnapshotSize = { width: 720, height: 1040 };

const FOV = 30;

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function toBlob(px: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.reject(new Error('2d context unavailable'));
  ctx.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

export async function createMannequinView(host: HTMLElement, opts: MannequinOptions = {}): Promise<MannequinViewResult> {
  if (!hasWebGL2()) return { unsupported: true, reason: 'no-webgl2' };
  let T: typeof THREE;
  try {
    T = await import('three');
  } catch {
    return { unsupported: true, reason: 'load-failed' };
  }
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return { unsupported: true, reason: 'renderer-failed' };
  }
  return createView(T, renderer, host, opts);
}

function createView(T: typeof THREE, renderer: THREE.WebGLRenderer, host: HTMLElement, opts: MannequinOptions): MannequinViewApi {
  const rng: Rng = opts.seed === undefined ? Math.random : mulberry32(opts.seed);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'mq-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.05, 50);

  const hemi = new T.HemisphereLight(0xfff8ec, 0x8f8574, 2.1);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xfffaf2, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  const sc = sun.shadow.camera;
  sc.left = -1.6;
  sc.right = 1.6;
  sc.top = 1.6;
  sc.bottom = -1.6;
  sc.near = 0.5;
  sc.far = 14;
  scene.add(sun, sun.target);

  const groundGeo = new T.PlaneGeometry(8, 8);
  const groundMat = new T.ShadowMaterial({ color: 0x3c3020, opacity: 0.16 });
  const ground = new T.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const blob = makeContactShadow(T);
  scene.add(blob.mesh);

  const rig = buildMannequin(T);
  scene.add(rig.root);

  let pose: ResolvedPose = resolvePose(opts.poseId ?? 'stand');
  let cam: CameraState = clampCamera(opts.state?.camera ?? presetCamera(opts.cameraPreset ?? 'three-quarter', rng));
  let light: LightState = opts.state?.light ?? { ...DEFAULT_LIGHT };
  let aspect = 1;
  let disposed = false;
  let raf = 0;

  const placeCamera = (c: THREE.PerspectiveCamera, asp: number) => {
    const f = frameBounds(pose.bounds, FOV, asp);
    const p = cameraPosition(f, cam);
    c.aspect = asp;
    c.position.set(p[0], p[1], p[2]);
    c.lookAt(f.target[0], f.target[1], f.target[2]);
    c.updateProjectionMatrix();
  };

  const applyScene = () => {
    rig.applyPose(pose);
    const b = pose.bounds;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    blob.mesh.position.set(cx, 0.002, cz);
    blob.mesh.scale.set(Math.max(0.5, b.max[0] - b.min[0]) * 1.3, Math.max(0.5, b.max[2] - b.min[2]) * 1.3, 1);
    // 地面から浮いている（跳ぶ）ときは丸影を薄く
    (blob.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.25, 1 - b.min[1] * 2.5);
    const d = sphericalDir(light.azimuth, light.elevation);
    const tx = cx;
    const ty = (b.min[1] + b.max[1]) / 2;
    sun.position.set(tx + d[0] * 6, ty + d[1] * 6, cz + d[2] * 6);
    sun.target.position.set(tx, ty, cz);
    sun.target.updateMatrixWorld();
  };

  const renderNow = () => {
    raf = 0;
    if (disposed) return;
    placeCamera(camera, aspect);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  };
  const requestRender = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(renderNow);
  };

  const resize = () => {
    if (disposed) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    aspect = w / h;
    requestRender();
  };

  const emit = () => opts.onChange?.({ camera: { ...cam }, light: { ...light } });

  // ---------------------------------------------------------------- 操作（ドラッグで回転・ピンチ／ホイールで距離）
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; cam: CameraState } | null = null;
  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 合成イベントなど */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = { dist: pinchDist(), cam: { ...cam } };
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      cam = pinchCamera(pinch.cam, pinch.dist, pinchDist());
    } else {
      cam = dragCamera(cam, e.clientX - prev.x, e.clientY - prev.y);
    }
    requestRender();
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) emit();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cam = wheelCamera(cam, e.deltaY);
    requestRender();
    emit();
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    if (!disposed) opts.onContextLost?.();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('webglcontextlost', onLost);

  // ---------------------------------------------------------------- スナップショット
  const readAccent = (): [number, number, number] => {
    const css = opts.accent ?? getComputedStyle(host).getPropertyValue('--color-accent');
    return parseCssColor(css) ?? [0x7b, 0xb6, 0x61];
  };
  const flatMat = new T.MeshBasicMaterial({ color: 0xffffff });

  /** 同期で描いて画素を読む（呼び出し直後に dispose されても問題ない） */
  const capture = (kind: 'color' | 'silhouette', size: SnapshotSize): Uint8ClampedArray => {
    const { width: w, height: h } = size;
    const rt = new T.WebGLRenderTarget(w, h, { samples: 4 });
    rt.texture.colorSpace = T.SRGBColorSpace;
    const snapCam = camera.clone();
    placeCamera(snapCam, w / h);
    const sil = kind === 'silhouette';
    if (sil) {
      ground.visible = false;
      blob.mesh.visible = false;
      scene.overrideMaterial = flatMat;
    }
    const buf = new Uint8Array(w * h * 4);
    try {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, snapCam);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    } finally {
      renderer.setRenderTarget(null);
      scene.overrideMaterial = null;
      ground.visible = true;
      blob.mesh.visible = true;
      rt.dispose();
    }
    const px = flipRows(buf, w, h);
    if (sil) tintSolid(px, readAccent());
    else unpremultiply(px);
    return px;
  };

  const silhouetteWithBounds = (size: SnapshotSize): Promise<SilhouetteSnapshot> => {
    if (disposed) return Promise.reject(new Error('disposed'));
    const px = capture('silhouette', size);
    const bounds = alphaBounds(px, size.width, size.height);
    return toBlob(px, size.width, size.height).then((b) => ({ blob: b, bounds, ...size }));
  };

  applyScene();
  resize();

  const api: MannequinViewApi = {
    unsupported: false,
    setPose(id) {
      if (disposed || id === pose.def.id) return;
      pose = resolvePose(id);
      applyScene();
      requestRender();
    },
    setCameraPreset(p) {
      cam = presetCamera(p, rng);
      requestRender();
      emit();
    },
    resetCamera() {
      cam = { ...CAMERA_PRESETS.front };
      requestRender();
      emit();
    },
    randomizeLight() {
      light = randomLight(rng);
      applyScene();
      requestRender();
      emit();
    },
    getState: () => ({ camera: { ...cam }, light: { ...light } }),
    setState(s) {
      if (s.camera) cam = clampCamera(s.camera);
      if (s.light) light = { ...s.light };
      applyScene();
      requestRender();
    },
    resize,
    snapshotSilhouette: (size = SNAPSHOT_SIZE) => silhouetteWithBounds(size).then((s) => s.blob),
    snapshotSilhouetteWithBounds: (size = SNAPSHOT_SIZE) => silhouetteWithBounds(size),
    snapshotForCompare(size = SNAPSHOT_SIZE) {
      if (disposed) return Promise.reject(new Error('disposed'));
      const color = capture('color', size);
      const sil = capture('silhouette', size);
      const bounds = alphaBounds(sil, size.width, size.height);
      return Promise.all([toBlob(color, size.width, size.height), toBlob(sil, size.width, size.height)]).then(([image, silhouette]) => ({
        image,
        silhouette,
        bounds,
        ...size,
      }));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onLost);
      rig.dispose();
      blob.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      flatMat.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return api;
}
