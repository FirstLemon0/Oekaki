/**
 * ジェスチャーの 2D フォールバック（WebGL が使えないとき／three.js の読み込み中）。
 * three.js のポーズ人形と同じ関節角の表（src/mannequin/poses.ts）から前進運動学で関節位置を求め、
 * 少し斜め上から正射影した棒人形にする。座標は viewBox 0 0 360 520。
 */
import { POSES, POSE_IDS, resolvePose, type PoseId } from '@/mannequin/poses';
import { HEAD_RADIUS, type PointName, type Vec3 } from '@/mannequin/skeleton';

export interface Pt {
  x: number;
  y: number;
}

export interface MannequinPose {
  id: string;
  label: string;
  head: Pt;
  headR: number;
  /** 折れ線（背骨・腕・脚・肩・腰） */
  lines: Pt[][];
}

export const POSE_VIEWBOX = { width: 360, height: 520 };

/** 棒人形を見る角度（度）。3D の「斜め」プリセットに近い */
const VIEW_AZIMUTH = 25;
const VIEW_ELEVATION = 8;
const MARGIN = 36;
/** 立ち姿の身長がこの px 程度になる倍率（寝そべり等は枠に収まるよう縮める） */
const BASE_SCALE = (POSE_VIEWBOX.height - MARGIN * 2) / 1.95;

const STICK_LINES: PointName[][] = [
  ['pelvis', 'chest', 'neck', 'head'],
  ['shoulderL', 'shoulderR'],
  ['hipL', 'hipR'],
  ['shoulderL', 'elbowL', 'wristL', 'handL'],
  ['shoulderR', 'elbowR', 'wristR', 'handR'],
  ['hipL', 'kneeL', 'ankleL', 'toeL'],
  ['hipR', 'kneeR', 'ankleR', 'toeR'],
];

/** 世界座標 → 画面座標（右 +x、上 +y の正射影） */
export function projectPoint(p: Vec3, azimuthDeg = VIEW_AZIMUTH, elevationDeg = VIEW_ELEVATION): Pt {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const up: Vec3 = [-Math.sin(el) * Math.sin(az), Math.cos(el), -Math.sin(el) * Math.cos(az)];
  return { x: p[0] * right[0] + p[2] * right[2], y: p[0] * up[0] + p[1] * up[1] + p[2] * up[2] };
}

const cache = new Map<PoseId, MannequinPose>();

/** 3D ポーズ定義から棒人形を作る */
export function stickPoseFor(id: PoseId): MannequinPose {
  const hit = cache.get(id);
  if (hit) return hit;
  const { def, fk } = resolvePose(id);
  const proj = (n: PointName): Pt => projectPoint(fk.points[n]);
  const head = proj('headCenter');
  const raw = STICK_LINES.map((l) => l.map(proj));
  const all = [...raw.flat(), { x: head.x - HEAD_RADIUS, y: head.y + HEAD_RADIUS }, { x: head.x + HEAD_RADIUS, y: head.y - HEAD_RADIUS }];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const q of all) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  const k = Math.min(BASE_SCALE, (POSE_VIEWBOX.width - MARGIN * 2) / Math.max(1e-6, x1 - x0), (POSE_VIEWBOX.height - MARGIN * 2) / Math.max(1e-6, y1 - y0));
  const cx = (x0 + x1) / 2;
  // 足元（最下点）を枠の下余白にそろえる。y は画面下向きに反転
  const toView = (q: Pt): Pt => ({
    x: Math.round((POSE_VIEWBOX.width / 2 + (q.x - cx) * k) * 10) / 10,
    y: Math.round((POSE_VIEWBOX.height - MARGIN - (q.y - y0) * k) * 10) / 10,
  });
  const pose: MannequinPose = {
    id: def.id,
    label: def.label,
    head: toView(head),
    headR: Math.round(HEAD_RADIUS * k * 10) / 10,
    lines: raw.map((l) => l.map(toView)),
  };
  cache.set(id, pose);
  return pose;
}

/** 全 16 種の棒人形（定義順） */
export const MANNEQUIN_POSES: MannequinPose[] = POSES.map((p) => stickPoseFor(p.id));

export function poseAt(i: number): MannequinPose {
  const n = POSE_IDS.length;
  return stickPoseFor(POSE_IDS[((i % n) + n) % n]!);
}

/** ポーズの外接矩形（見比べの「重ねる」で自分の線を合わせる基準） */
export function poseBounds(pose: MannequinPose): { x: number; y: number; w: number; h: number } {
  let x0 = pose.head.x - pose.headR;
  let y0 = pose.head.y - pose.headR;
  let x1 = pose.head.x + pose.headR;
  let y1 = pose.head.y + pose.headR;
  for (const l of pose.lines) {
    for (const q of l) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
