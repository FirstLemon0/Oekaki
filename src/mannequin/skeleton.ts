/**
 * デッサン人形の骨格（three.js 非依存の純ロジック）。
 * 座標系: Y 上、人形は +Z を向く。人形の「左」は +X。単位はおよそメートル（身長 ≈ 1.8）。
 *
 * 回転の約束（度・Euler）:
 * - 胴系（pelvis/chest/neck/head, 順序 YXZ）: y+ = 自分の左へひねる、x+ = 前へ倒す、z+ = 上端が自分の右へ傾く
 * - 手足系（肩・肘・手首・股・膝・足首, 順序 ZXY）: 下向きの手足に対し z+ = +X 側へ開く（左は外へ／右は内へ）、
 *   x- = 前へ上げる、x+ = 後ろへ、y = 長軸まわりのひねり。肘は x- で曲がり、膝は x+ で曲がる。足首は x+ でつま先が下がる。
 */

export type Vec3 = readonly [number, number, number];

export type JointName =
  | 'pelvis'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'elbowL'
  | 'wristL'
  | 'shoulderR'
  | 'elbowR'
  | 'wristR'
  | 'hipL'
  | 'kneeL'
  | 'ankleL'
  | 'hipR'
  | 'kneeR'
  | 'ankleR';

export type EulerOrder = 'YXZ' | 'ZXY';

export interface JointSpec {
  name: JointName;
  parent: JointName | null;
  /** 親関節からの位置（親のローカル座標） */
  offset: Vec3;
  order: EulerOrder;
}

/** 親→子の順（FK はこの順に計算すればよい） */
export const JOINTS: readonly JointSpec[] = [
  { name: 'pelvis', parent: null, offset: [0, 0, 0], order: 'YXZ' },
  { name: 'chest', parent: 'pelvis', offset: [0, 0.12, 0], order: 'YXZ' },
  { name: 'neck', parent: 'chest', offset: [0, 0.4, 0], order: 'YXZ' },
  { name: 'head', parent: 'neck', offset: [0, 0.09, 0], order: 'YXZ' },
  { name: 'shoulderL', parent: 'chest', offset: [0.19, 0.34, 0], order: 'ZXY' },
  { name: 'elbowL', parent: 'shoulderL', offset: [0, -0.29, 0], order: 'ZXY' },
  { name: 'wristL', parent: 'elbowL', offset: [0, -0.26, 0], order: 'ZXY' },
  { name: 'shoulderR', parent: 'chest', offset: [-0.19, 0.34, 0], order: 'ZXY' },
  { name: 'elbowR', parent: 'shoulderR', offset: [0, -0.29, 0], order: 'ZXY' },
  { name: 'wristR', parent: 'elbowR', offset: [0, -0.26, 0], order: 'ZXY' },
  { name: 'hipL', parent: 'pelvis', offset: [0.1, -0.06, 0], order: 'ZXY' },
  { name: 'kneeL', parent: 'hipL', offset: [0, -0.43, 0], order: 'ZXY' },
  { name: 'ankleL', parent: 'kneeL', offset: [0, -0.42, 0], order: 'ZXY' },
  { name: 'hipR', parent: 'pelvis', offset: [-0.1, -0.06, 0], order: 'ZXY' },
  { name: 'kneeR', parent: 'hipR', offset: [0, -0.43, 0], order: 'ZXY' },
  { name: 'ankleR', parent: 'kneeR', offset: [0, -0.42, 0], order: 'ZXY' },
];

export type TipName = 'headCenter' | 'headTop' | 'handL' | 'handR' | 'toeL' | 'heelL' | 'toeR' | 'heelR';

/** 末端の目印（親関節のローカル座標） */
export const TIPS: Readonly<Record<TipName, { parent: JointName; offset: Vec3 }>> = {
  headCenter: { parent: 'head', offset: [0, 0.11, 0] },
  headTop: { parent: 'head', offset: [0, 0.23, 0] },
  handL: { parent: 'wristL', offset: [0, -0.17, 0] },
  handR: { parent: 'wristR', offset: [0, -0.17, 0] },
  toeL: { parent: 'ankleL', offset: [0, -0.07, 0.16] },
  heelL: { parent: 'ankleL', offset: [0, -0.07, -0.05] },
  toeR: { parent: 'ankleR', offset: [0, -0.07, 0.16] },
  heelR: { parent: 'ankleR', offset: [0, -0.07, -0.05] },
};

export const HEAD_RADIUS = 0.115;

export type PointName = JointName | TipName;

/** 接地判定・外接箱に使う点とその半径（点の中心から体表までのおおよその距離） */
export const CONTACTS: readonly { at: PointName; r: number }[] = [
  { at: 'pelvis', r: 0.13 },
  { at: 'chest', r: 0.12 },
  { at: 'neck', r: 0.13 },
  { at: 'headCenter', r: HEAD_RADIUS },
  { at: 'shoulderL', r: 0.06 },
  { at: 'shoulderR', r: 0.06 },
  { at: 'elbowL', r: 0.045 },
  { at: 'elbowR', r: 0.045 },
  { at: 'wristL', r: 0.035 },
  { at: 'wristR', r: 0.035 },
  { at: 'handL', r: 0.02 },
  { at: 'handR', r: 0.02 },
  { at: 'hipL', r: 0.07 },
  { at: 'hipR', r: 0.07 },
  { at: 'kneeL', r: 0.06 },
  { at: 'kneeR', r: 0.06 },
  { at: 'ankleL', r: 0.045 },
  { at: 'ankleR', r: 0.045 },
  { at: 'toeL', r: 0 },
  { at: 'heelL', r: 0 },
  { at: 'toeR', r: 0 },
  { at: 'heelR', r: 0 },
];

// ---------------------------------------------------------------- 行列（3x3 行優先）

export type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r.push(a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!);
    }
  }
  return r as Mat3;
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function rx(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function ry(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rz(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** three.js の Euler と同じ意味（order の文字順に行列を掛ける＝内在回転）。角度は度。 */
export function eulerToMat3(deg: Vec3, order: EulerOrder | 'XYZ'): Mat3 {
  const by: Record<string, Mat3> = { X: rx(deg[0] * DEG), Y: ry(deg[1] * DEG), Z: rz(deg[2] * DEG) };
  return mul3(mul3(by[order[0]!]!, by[order[1]!]!), by[order[2]!]!);
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export type JointAngles = Partial<Record<JointName, Vec3>>;

export interface FkResult {
  /** 各関節・末端の世界座標 */
  points: Record<PointName, Vec3>;
  /** 各関節の世界回転 */
  rotations: Record<JointName, Mat3>;
}

/** 前進運動学。angles は関節ごとの Euler 角（度）。root は骨盤の世界位置、pelvis の角度が全身の向き。 */
export function forwardKinematics(angles: JointAngles, root: Vec3 = [0, 0, 0]): FkResult {
  const points = {} as Record<PointName, Vec3>;
  const rotations = {} as Record<JointName, Mat3>;
  for (const j of JOINTS) {
    const local = eulerToMat3(angles[j.name] ?? [0, 0, 0], j.order);
    if (j.parent === null) {
      points[j.name] = root;
      rotations[j.name] = local;
    } else {
      const pr = rotations[j.parent];
      points[j.name] = add(points[j.parent], apply3(pr, j.offset));
      rotations[j.name] = mul3(pr, local);
    }
  }
  for (const name of Object.keys(TIPS) as TipName[]) {
    const t = TIPS[name];
    points[name] = add(points[t.parent], apply3(rotations[t.parent], t.offset));
  }
  return { points, rotations };
}

/** 体表の一番低い点が地面 (y=0) に触れるための骨盤の高さ */
export function groundHeight(angles: JointAngles): number {
  const { points } = forwardKinematics(angles);
  let min = Infinity;
  for (const c of CONTACTS) min = Math.min(min, points[c.at][1] - c.r);
  return -min;
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

/** 体表込みのおおよその外接箱 */
export function contactBounds(points: Record<PointName, Vec3>): Bounds3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of CONTACTS) {
    const p = points[c.at];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]! - c.r);
      max[k] = Math.max(max[k]!, p[k]! + c.r);
    }
  }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}
