/**
 * three.js のプリミティブで木製デッサン人形を組み立てる（外部アセットなし）。
 * three 本体は呼び出し側が動的 import して渡す（このファイルは型だけを参照する）。
 */
import type * as THREE from 'three';
import { JOINTS, type JointName } from './skeleton';
import type { ResolvedPose } from './poses';

type Three = typeof THREE;

export const WOOD_COLOR = '#C9B79C';
export const JOINT_COLOR = '#B7A283';

export interface MannequinRig {
  root: THREE.Group;
  joints: Record<JointName, THREE.Object3D>;
  applyPose(p: ResolvedPose): void;
  dispose(): void;
}

const DEG = Math.PI / 180;

export function buildMannequin(T: Three): MannequinRig {
  const geos: THREE.BufferGeometry[] = [];
  const g = <G extends THREE.BufferGeometry>(x: G): G => {
    geos.push(x);
    return x;
  };
  const wood = new T.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.78, metalness: 0 });
  const jointMat = new T.MeshStandardMaterial({ color: JOINT_COLOR, roughness: 0.7, metalness: 0 });

  const root = new T.Group();
  root.name = 'mannequin';
  const joints = {} as Record<JointName, THREE.Object3D>;
  for (const j of JOINTS) {
    const o = new T.Object3D();
    o.name = j.name;
    o.position.set(j.offset[0], j.offset[1], j.offset[2]);
    o.rotation.order = j.order;
    joints[j.name] = o;
    (j.parent ? joints[j.parent] : root).add(o);
  }

  const mesh = (
    parent: JointName,
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    opts: { scale?: [number, number, number]; mat?: THREE.Material; rot?: [number, number, number] } = {},
  ) => {
    const m = new T.Mesh(geo, opts.mat ?? wood);
    m.position.set(pos[0], pos[1], pos[2]);
    if (opts.scale) m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (opts.rot) m.rotation.set(opts.rot[0] * DEG, opts.rot[1] * DEG, opts.rot[2] * DEG);
    m.castShadow = true;
    m.receiveShadow = true;
    joints[parent].add(m);
    return m;
  };
  /** 長さ len（端から端）で、関節から -Y 方向へ伸びるカプセル */
  const limb = (parent: JointName, r: number, len: number, start = 0) =>
    mesh(parent, g(new T.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 6, 16)), [0, -(start + len / 2), 0]);
  const ball = (parent: JointName, r: number) => mesh(parent, g(new T.SphereGeometry(r, 20, 14)), [0, 0, 0], { mat: jointMat });

  // 胴: 骨盤と胸郭の 2 つのカプセル＋腰の球
  mesh('pelvis', g(new T.CapsuleGeometry(0.12, 0.06, 8, 20)), [0, 0.01, 0], { scale: [1.35, 0.72, 0.85] });
  mesh('chest', g(new T.CapsuleGeometry(0.14, 0.16, 8, 20)), [0, 0.22, 0], { scale: [1.22, 1, 0.8] });
  mesh('chest', g(new T.SphereGeometry(0.1, 18, 12)), [0, 0.02, 0], { mat: jointMat, scale: [1.2, 1, 0.9] });
  // 首・頭（顔の向きがわかるよう、鼻と顎の小さな張り出し）
  ball('neck', 0.05);
  mesh('neck', g(new T.CapsuleGeometry(0.042, 0.05, 4, 12)), [0, 0.05, 0]);
  mesh('head', g(new T.SphereGeometry(0.115, 32, 20)), [0, 0.11, 0], { scale: [0.9, 1.05, 0.97] });
  mesh('head', g(new T.SphereGeometry(0.06, 16, 10)), [0, 0.055, 0.05], { scale: [1.1, 0.8, 1] });
  mesh('head', g(new T.BoxGeometry(0.022, 0.04, 0.03)), [0, 0.1, 0.11], { rot: [-12, 0, 0] });

  for (const s of ['L', 'R'] as const) {
    const sh = `shoulder${s}` as JointName;
    const el = `elbow${s}` as JointName;
    const wr = `wrist${s}` as JointName;
    const hp = `hip${s}` as JointName;
    const kn = `knee${s}` as JointName;
    const an = `ankle${s}` as JointName;
    ball(sh, 0.058);
    limb(sh, 0.046, 0.26, 0.02);
    ball(el, 0.043);
    limb(el, 0.04, 0.23, 0.02);
    ball(wr, 0.032);
    // 手: ミトン形（平たいカプセル）
    mesh(wr, g(new T.CapsuleGeometry(0.036, 0.08, 4, 12)), [0, -0.09, 0], { scale: [1, 1, 0.45] });
    ball(hp, 0.072);
    limb(hp, 0.07, 0.38, 0.03);
    ball(kn, 0.058);
    limb(kn, 0.054, 0.37, 0.02);
    ball(an, 0.044);
    // 足: つま先が薄いくさび
    const foot = g(new T.BoxGeometry(0.09, 0.07, 0.22, 1, 1, 1));
    const pos = foot.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > 0 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) - 0.035);
    }
    foot.computeVertexNormals();
    mesh(an, foot, [0, -0.035, 0.055]);
  }

  const applyPose = (p: ResolvedPose) => {
    root.position.set(p.root[0], p.root[1], p.root[2]);
    for (const j of JOINTS) {
      const a = p.def.joints[j.name] ?? [0, 0, 0];
      joints[j.name].rotation.set(a[0] * DEG, a[1] * DEG, a[2] * DEG, j.order);
    }
    root.updateMatrixWorld(true);
  };

  return {
    root,
    joints,
    applyPose,
    dispose() {
      for (const x of geos) x.dispose();
      wood.dispose();
      jointMat.dispose();
    },
  };
}

/** 地面の柔らかい丸影（放射グラデーションの板） */
export function makeContactShadow(T: Three): { mesh: THREE.Mesh; dispose(): void } {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(60,48,32,0.38)');
    grad.addColorStop(0.55, 'rgba(60,48,32,0.14)');
    grad.addColorStop(1, 'rgba(60,48,32,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const geo = new T.PlaneGeometry(1, 1);
  const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new T.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  mesh.renderOrder = -1;
  return {
    mesh,
    dispose() {
      tex.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
