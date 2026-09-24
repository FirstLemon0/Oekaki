/**
 * カメラ・光源の角度計算（three.js 非依存）。
 * azimuth: 0 = 正面（+Z 側から見る）、+ で人形の左側（+X）へ回り込む。elevation: + で上から。度。
 */
import type { Bounds3, Vec3 } from './skeleton';
import { mixSeed, mulberry32, range, type Rng } from './rng';

export type CameraPreset = 'front' | 'three-quarter' | 'random';

export interface CameraState {
  azimuth: number;
  elevation: number;
  /** 自動フィット距離に掛ける倍率（1 = 全身がちょうど入る） */
  zoom: number;
}

export interface LightState {
  azimuth: number;
  elevation: number;
}

export const CAMERA_LIMITS = { elevationMin: -15, elevationMax: 60, zoomMin: 0.55, zoomMax: 1.8 } as const;

export const CAMERA_PRESETS: Readonly<Record<Exclude<CameraPreset, 'random'>, CameraState>> = {
  front: { azimuth: 0, elevation: 10, zoom: 1 },
  'three-quarter': { azimuth: 35, elevation: 16, zoom: 1 },
};

/** 右上から（初期視点から見て右・上） */
export const DEFAULT_LIGHT: LightState = { azimuth: 50, elevation: 55 };

const DEG = Math.PI / 180;

/** -180〜180 に正規化 */
export function wrapDeg(a: number): number {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

export function clampCamera(s: CameraState): CameraState {
  return {
    azimuth: wrapDeg(s.azimuth),
    elevation: Math.min(CAMERA_LIMITS.elevationMax, Math.max(CAMERA_LIMITS.elevationMin, s.elevation)),
    zoom: Math.min(CAMERA_LIMITS.zoomMax, Math.max(CAMERA_LIMITS.zoomMin, s.zoom)),
  };
}

export function randomCamera(rng: Rng): CameraState {
  return { azimuth: wrapDeg(range(rng, -180, 180)), elevation: range(rng, -5, 35), zoom: 1 };
}

export function randomLight(rng: Rng): LightState {
  return { azimuth: wrapDeg(range(rng, -180, 180)), elevation: range(rng, 35, 75) };
}

export function presetCamera(p: CameraPreset, rng: Rng = Math.random): CameraState {
  return p === 'random' ? randomCamera(rng) : { ...CAMERA_PRESETS[p] };
}

/** 球面座標 → 単位方向ベクトル */
export function sphericalDir(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** ドラッグ量（CSS px）→ 新しいカメラ。水平は大きく、上下は少しだけ。 */
export function dragCamera(s: CameraState, dx: number, dy: number): CameraState {
  return clampCamera({ ...s, azimuth: s.azimuth - dx * 0.45, elevation: s.elevation + dy * 0.25 });
}

/** ピンチ（開始時の指間距離 → 今の指間距離） */
export function pinchCamera(start: CameraState, startDist: number, dist: number): CameraState {
  if (startDist <= 0 || dist <= 0) return start;
  return clampCamera({ ...start, zoom: start.zoom * (startDist / dist) });
}

/** ホイール（deltaY: 下スクロールで遠ざかる） */
export function wheelCamera(s: CameraState, deltaY: number): CameraState {
  return clampCamera({ ...s, zoom: s.zoom * Math.exp(deltaY * 0.0012) });
}

export interface Framing {
  target: Vec3;
  /** zoom = 1 のときの距離 */
  distance: number;
}

/**
 * 外接箱が画面に収まる注視点と距離。vfovDeg は縦の画角、aspect = 幅/高さ。
 * 外接球で近似するので、どの角度から見ても切れない。
 */
export function frameBounds(b: Bounds3, vfovDeg: number, aspect: number): Framing {
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  const vHalf = (vfovDeg * DEG) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.1, aspect));
  const half = Math.min(vHalf, hHalf);
  return { target: c, distance: (r * 0.94) / Math.sin(half) };
}

export function cameraPosition(f: Framing, s: CameraState): Vec3 {
  const d = sphericalDir(s.azimuth, s.elevation);
  const dist = f.distance * s.zoom;
  return [f.target[0] + d[0] * dist, f.target[1] + d[1] * dist, f.target[2] + d[2] * dist];
}

export interface RoundView {
  camera: CameraState;
  light: LightState;
}

/**
 * ジェスチャー n 体目の出題角度（シード固定）。1 体目は見やすい斜め＋既定の光、以降はランダム。
 */
export function roundView(seed: number, n: number): RoundView {
  if (n <= 0) return { camera: { ...CAMERA_PRESETS['three-quarter'] }, light: { ...DEFAULT_LIGHT } };
  const rng = mulberry32(mixSeed(seed, n));
  return { camera: randomCamera(rng), light: randomLight(rng) };
}
