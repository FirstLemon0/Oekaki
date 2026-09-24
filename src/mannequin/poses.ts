/**
 * ポーズ定義（関節角の表）と出題順。three.js 非依存。
 * 角度の約束は skeleton.ts の冒頭を参照。骨盤の高さは接地から自動で決める（lift で浮かせる）。
 */
import { contactBounds, forwardKinematics, groundHeight, type Bounds3, type FkResult, type JointAngles, type Vec3 } from './skeleton';
import { mulberry32 } from './rng';

export type PoseId =
  | 'stand'
  | 'contrapposto'
  | 'walk'
  | 'run'
  | 'jump'
  | 'sit'
  | 'crouch'
  | 'raise-hand'
  | 'turn'
  | 'bend'
  | 'stretch'
  | 'throw'
  | 'kick'
  | 'one-leg'
  | 'lie'
  | 'look-back-walk';

export interface PoseDef {
  id: PoseId;
  label: string;
  /** 関節角（度）。pelvis は全身の向き */
  joints: JointAngles;
  /** 接地からさらに浮かせる高さ（跳ぶ・走る） */
  lift?: number;
}

const WALK_LEGS: JointAngles = {
  hipL: [-24, 0, 2],
  kneeL: [8, 0, 0],
  ankleL: [-8, 0, 0],
  hipR: [16, 0, -2],
  kneeR: [28, 0, 0],
  ankleR: [18, 0, 0],
};

export const POSES: readonly PoseDef[] = [
  {
    id: 'stand',
    label: '立ち（正面）',
    joints: {
      shoulderL: [0, 0, 6],
      shoulderR: [0, 0, -6],
      elbowL: [-6, 0, 0],
      elbowR: [-6, 0, 0],
      hipL: [0, 0, 3],
      hipR: [0, 0, -3],
    },
  },
  {
    id: 'contrapposto',
    label: 'コントラポスト',
    joints: {
      pelvis: [0, 8, -6],
      chest: [0, -10, 10],
      neck: [0, 0, -3],
      head: [4, 12, -4],
      hipR: [-2, 0, 8],
      hipL: [-12, 0, -2],
      kneeL: [22, 0, 0],
      ankleL: [6, 0, 0],
      shoulderL: [4, 0, 8],
      elbowL: [-10, 0, 0],
      shoulderR: [6, 0, -14],
      elbowR: [-25, 0, 0],
    },
  },
  {
    id: 'walk',
    label: '歩く',
    joints: {
      pelvis: [3, -6, 0],
      chest: [2, 12, 0],
      head: [0, -6, 0],
      ...WALK_LEGS,
      shoulderL: [22, 0, 6],
      elbowL: [-12, 0, 0],
      shoulderR: [-24, 0, -6],
      elbowR: [-32, 0, 0],
    },
  },
  {
    id: 'run',
    label: '走る',
    lift: 0.03,
    joints: {
      pelvis: [14, -8, 0],
      chest: [6, 16, 0],
      neck: [-8, 0, 0],
      head: [-8, -6, 0],
      hipL: [-72, 0, 4],
      kneeL: [95, 0, 0],
      ankleL: [10, 0, 0],
      hipR: [22, 0, -4],
      kneeR: [30, 0, 0],
      ankleR: [30, 0, 0],
      shoulderL: [45, 0, 8],
      elbowL: [-95, 0, 0],
      shoulderR: [-55, 0, -10],
      elbowR: [-90, 0, 0],
    },
  },
  {
    id: 'jump',
    label: '跳ぶ',
    lift: 0.35,
    joints: {
      pelvis: [-6, 0, 0],
      chest: [-12, 0, 0],
      head: [-14, 0, 0],
      shoulderL: [-10, 0, 145],
      elbowL: [-15, 0, 0],
      shoulderR: [-10, 0, -145],
      elbowR: [-15, 0, 0],
      hipL: [-35, 0, 8],
      kneeL: [85, 0, 0],
      ankleL: [35, 0, 0],
      hipR: [-15, 0, -6],
      kneeR: [100, 0, 0],
      ankleR: [40, 0, 0],
    },
  },
  {
    id: 'sit',
    label: '座る',
    joints: {
      pelvis: [-22, 0, 0],
      chest: [18, 0, 0],
      head: [10, 0, 0],
      hipL: [-88, 0, 10],
      kneeL: [110, 0, 0],
      hipR: [-100, 0, -6],
      kneeR: [70, 0, 0],
      ankleR: [30, 0, 0],
      shoulderL: [38, 0, 18],
      elbowL: [-4, 0, 0],
      shoulderR: [38, 0, -18],
      elbowR: [-4, 0, 0],
    },
  },
  {
    id: 'crouch',
    label: 'しゃがむ',
    joints: {
      pelvis: [22, 0, 0],
      chest: [18, 0, 0],
      neck: [-10, 0, 0],
      head: [-18, 0, 0],
      hipL: [-128, 0, 14],
      kneeL: [145, 0, 0],
      ankleL: [-39, 0, 0],
      hipR: [-128, 0, -14],
      kneeR: [145, 0, 0],
      ankleR: [-39, 0, 0],
      shoulderL: [-58, 0, 10],
      elbowL: [-40, 0, 0],
      shoulderR: [-58, 0, -10],
      elbowR: [-40, 0, 0],
    },
  },
  {
    id: 'raise-hand',
    label: '手を上げる',
    joints: {
      chest: [0, 4, -5],
      head: [-10, 10, 3],
      shoulderR: [-8, 0, -168],
      elbowR: [-12, 0, 0],
      shoulderL: [4, 0, 8],
      elbowL: [-14, 0, 0],
      hipL: [0, 0, 4],
      hipR: [0, 0, -4],
    },
  },
  {
    id: 'turn',
    label: '振り向く',
    joints: {
      chest: [0, 32, 0],
      neck: [0, 18, 0],
      head: [-4, 26, 0],
      shoulderL: [12, 0, 8],
      elbowL: [-18, 0, 0],
      shoulderR: [-12, 0, -8],
      elbowR: [-20, 0, 0],
      hipL: [4, 0, 4],
      kneeL: [6, 0, 0],
      hipR: [-6, 0, -4],
      kneeR: [10, 0, 0],
    },
  },
  {
    id: 'bend',
    label: '前かがみ',
    joints: {
      pelvis: [58, 0, 0],
      chest: [22, 0, 0],
      neck: [-18, 0, 0],
      head: [-26, 0, 0],
      hipL: [-54, 0, 4],
      hipR: [-54, 0, -4],
      kneeL: [8, 0, 0],
      kneeR: [8, 0, 0],
      ankleL: [-12, 0, 0],
      ankleR: [-12, 0, 0],
      shoulderL: [-48, 0, 6],
      elbowL: [-12, 0, 0],
      shoulderR: [-48, 0, -6],
      elbowR: [-12, 0, 0],
    },
  },
  {
    id: 'stretch',
    label: '伸び',
    joints: {
      chest: [-12, 0, 0],
      neck: [-6, 0, 0],
      head: [-16, 0, 0],
      shoulderL: [-4, 0, 172],
      elbowL: [-6, 0, 0],
      shoulderR: [-4, 0, -172],
      elbowR: [-6, 0, 0],
      ankleL: [25, 0, 0],
      ankleR: [25, 0, 0],
    },
  },
  {
    id: 'throw',
    label: '投げる',
    joints: {
      pelvis: [4, -26, 0],
      chest: [0, -24, -10],
      head: [0, 46, 0],
      shoulderR: [25, -90, -95],
      elbowR: [-95, 0, 0],
      wristR: [20, 0, 0],
      shoulderL: [-35, 0, 70],
      elbowL: [-20, 0, 0],
      hipL: [-38, 0, 6],
      kneeL: [22, 0, 0],
      hipR: [12, 0, -10],
      kneeR: [18, 0, 0],
      ankleR: [10, 0, 0],
    },
  },
  {
    id: 'kick',
    label: '蹴る',
    joints: {
      pelvis: [-10, 0, 0],
      chest: [-4, 0, 0],
      head: [10, 0, 0],
      hipR: [-82, 0, -4],
      kneeR: [18, 0, 0],
      ankleR: [30, 0, 0],
      hipL: [8, 0, 2],
      kneeL: [8, 0, 0],
      ankleL: [-6, 0, 0],
      shoulderL: [-50, 0, 40],
      elbowL: [-20, 0, 0],
      shoulderR: [30, 0, -35],
      elbowR: [-20, 0, 0],
    },
  },
  {
    id: 'one-leg',
    label: '片足立ち',
    joints: {
      chest: [0, 0, -3],
      head: [0, 0, 4],
      hipL: [0, 0, -3],
      hipR: [-80, 0, -2],
      kneeR: [90, 0, 0],
      ankleR: [20, 0, 0],
      shoulderL: [0, 0, 80],
      elbowL: [-6, 0, 0],
      shoulderR: [0, 0, -80],
      elbowR: [-6, 0, 0],
    },
  },
  {
    id: 'lie',
    label: '寝そべる',
    joints: {
      pelvis: [90, 0, 0],
      chest: [-35, 0, 0],
      neck: [-20, 0, 0],
      head: [-15, 0, 0],
      shoulderL: [-55, 0, 8],
      elbowL: [-90, 0, 0],
      shoulderR: [-55, 0, -8],
      elbowR: [-95, 0, 0],
      hipL: [0, 0, 3],
      hipR: [0, 0, -3],
      kneeL: [70, 0, 0],
      kneeR: [100, 0, 0],
      ankleL: [30, 0, 0],
      ankleR: [30, 0, 0],
    },
  },
  {
    id: 'look-back-walk',
    label: '振り返り歩き',
    joints: {
      pelvis: [3, -4, 0],
      chest: [2, 26, 0],
      neck: [0, 20, 0],
      head: [-4, 34, 0],
      ...WALK_LEGS,
      shoulderL: [20, 0, 6],
      elbowL: [-14, 0, 0],
      shoulderR: [-20, 0, -6],
      elbowR: [-30, 0, 0],
    },
  },
];

export const POSE_IDS: readonly PoseId[] = POSES.map((p) => p.id);

/** 出題グループ（教材の gesture.poseGroup）。all は全種 */
export type PoseGroup = 'all' | 'standing' | 'sitting' | 'action';

/** グループごとの母集団（pickPoseSequence の ids に渡す） */
export const POSE_GROUPS: Readonly<Record<PoseGroup, readonly PoseId[]>> = {
  all: POSE_IDS,
  standing: ['stand', 'contrapposto', 'raise-hand', 'stretch', 'one-leg', 'turn'],
  sitting: ['sit', 'crouch', 'lie', 'bend'],
  action: ['walk', 'run', 'jump', 'throw', 'kick', 'look-back-walk'],
};

/** グループ名 → 母集団。未指定・知らない値は全種 */
export function poseIdsOf(group: string | undefined | null): readonly PoseId[] {
  return group && Object.prototype.hasOwnProperty.call(POSE_GROUPS, group) ? POSE_GROUPS[group as PoseGroup] : POSE_IDS;
}

const BY_ID = new Map<PoseId, PoseDef>(POSES.map((p) => [p.id, p]));

export function getPose(id: PoseId): PoseDef {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown pose: ${id}`);
  return p;
}

export function isPoseId(v: string): v is PoseId {
  return BY_ID.has(v as PoseId);
}

export interface ResolvedPose {
  def: PoseDef;
  /** 骨盤の世界位置（接地済み） */
  root: Vec3;
  fk: FkResult;
  bounds: Bounds3;
}

/** ポーズを接地させて世界座標を求める */
export function resolvePose(id: PoseId): ResolvedPose {
  const def = getPose(id);
  const root: Vec3 = [0, groundHeight(def.joints) + (def.lift ?? 0), 0];
  const fk = forwardKinematics(def.joints, root);
  return { def, root, fk, bounds: contactBounds(fk.points) };
}

/**
 * count 体ぶんのポーズ順。全種を一巡するまで重複なし、巡目の境目でも同じポーズが続かない。
 * 同じ seed なら同じ順（テスト・再開用）。
 */
export function pickPoseSequence(count: number, seed: number, ids: readonly PoseId[] = POSE_IDS): PoseId[] {
  const rng = mulberry32(seed);
  const out: PoseId[] = [];
  if (ids.length === 0 || count <= 0) return out;
  while (out.length < count) {
    const bag = [...ids];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    const last = out[out.length - 1];
    if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1]!, bag[0]!];
    for (const id of bag) {
      if (out.length >= count) break;
      out.push(id);
    }
  }
  return out;
}

/** URL の ?seed=<0 以上の整数>（location.search。ハッシュの前）。無ければ null */
export function seedFromSearch(search: string = typeof location !== 'undefined' ? location.search : ''): number | null {
  const v = new URLSearchParams(search).get('seed');
  if (v === null || !/^\d{1,10}$/.test(v)) return null;
  return Number(v) >>> 0;
}
