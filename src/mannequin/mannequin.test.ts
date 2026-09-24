import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Object3D, Vector3 } from 'three';
import { POSES, POSE_IDS, pickPoseSequence, resolvePose } from './poses';
import { CONTACTS, JOINTS, eulerToMat3, forwardKinematics, type EulerOrder, type Vec3 } from './skeleton';
import {
  CAMERA_LIMITS,
  cameraPosition,
  clampCamera,
  dragCamera,
  frameBounds,
  pinchCamera,
  roundView,
  sphericalDir,
  wheelCamera,
  wrapDeg,
} from './camera';
import { mixSeed, mulberry32 } from './rng';
import { alphaBounds, flipRows, parseCssColor, tintSolid, unpremultiply } from './silhouette';
import { MANNEQUIN_POSES, poseBounds, projectPoint, stickPoseFor, POSE_VIEWBOX } from '@/ui/lesson/mannequin-poses';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('ポーズ定義', () => {
  it('16 種以上・id が重複しない・ラベルがある', () => {
    expect(POSES.length).toBeGreaterThanOrEqual(16);
    expect(new Set(POSE_IDS).size).toBe(POSES.length);
    for (const p of POSES) expect(p.label.length).toBeGreaterThan(0);
    for (const id of [
      'stand',
      'contrapposto',
      'walk',
      'run',
      'jump',
      'sit',
      'crouch',
      'raise-hand',
      'turn',
      'bend',
      'stretch',
      'throw',
      'kick',
      'one-leg',
      'lie',
      'look-back-walk',
    ]) {
      expect(POSE_IDS).toContain(id);
    }
  });

  it('関節角は有限の数で、知らない関節名を使っていない', () => {
    const names = new Set(JOINTS.map((j) => j.name));
    for (const p of POSES) {
      for (const [k, v] of Object.entries(p.joints)) {
        expect(names.has(k as never)).toBe(true);
        expect(v).toHaveLength(3);
        for (const a of v!) expect(Number.isFinite(a) && Math.abs(a) <= 180).toBe(true);
      }
    }
  });

  it('接地: lift のないポーズは体表の最下点がちょうど地面、跳ぶは浮いている', () => {
    for (const p of POSES) {
      const r = resolvePose(p.id);
      let min = Infinity;
      for (const c of CONTACTS) min = Math.min(min, r.fk.points[c.at][1] - c.r);
      close(min, p.lift ?? 0, 1e-9);
    }
    expect(resolvePose('jump').bounds.min[1]).toBeGreaterThan(0.3);
  });

  it('立ちポーズは頭が一番上・身長はおよそ 1.7〜1.9', () => {
    const r = resolvePose('stand');
    const top = r.fk.points.headTop[1];
    expect(top).toBeGreaterThan(1.7);
    expect(top).toBeLessThan(1.9);
    for (const k of ['toeL', 'toeR', 'heelL', 'heelR'] as const) close(r.fk.points[k][1], 0, 0.02);
    // 左は +X、顔は +Z
    expect(r.fk.points.shoulderL[0]).toBeGreaterThan(0);
    expect(r.fk.points.toeL[2]).toBeGreaterThan(r.fk.points.heelL[2]);
  });

  it('ポーズの意味どおりの向き（歩く=左脚が前、手を上げる=右手が頭より上、寝そべる=頭が低い）', () => {
    const walk = resolvePose('walk').fk.points;
    expect(walk.ankleL[2]).toBeGreaterThan(walk.ankleR[2]);
    const raise = resolvePose('raise-hand').fk.points;
    expect(raise.handR[1]).toBeGreaterThan(raise.headTop[1]);
    expect(raise.handL[1]).toBeLessThan(raise.pelvis[1]);
    const lie = resolvePose('lie');
    expect(lie.fk.points.headTop[1]).toBeLessThan(0.8);
    expect(lie.bounds.max[2] - lie.bounds.min[2]).toBeGreaterThan(1.2);
    const crouch = resolvePose('crouch').fk.points;
    expect(crouch.pelvis[1]).toBeLessThan(0.6);
    const kick = resolvePose('kick').fk.points;
    expect(kick.ankleR[1]).toBeGreaterThan(0.6);
  });
});

describe('前進運動学は three.js と一致する', () => {
  it('eulerToMat3 == three の Euler（YXZ / ZXY / XYZ）', () => {
    const rng = mulberry32(42);
    for (const order of ['YXZ', 'ZXY', 'XYZ'] as const) {
      for (let n = 0; n < 20; n++) {
        const deg: Vec3 = [rng() * 360 - 180, rng() * 360 - 180, rng() * 360 - 180];
        const m = eulerToMat3(deg, order);
        const rad = deg.map((d) => (d * Math.PI) / 180);
        const t = new Matrix4().makeRotationFromEuler(new Euler(rad[0], rad[1], rad[2], order)).elements;
        // three は列優先
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) close(m[r * 3 + c]!, t[c * 4 + r]!, 1e-9);
      }
    }
  });

  it('全ポーズの関節の世界座標が Object3D 階層の結果と一致', () => {
    for (const p of POSES) {
      const r = resolvePose(p.id);
      const objs = new Map<string, Object3D>();
      const root = new Object3D();
      for (const j of JOINTS) {
        const o = new Object3D();
        o.position.set(...j.offset);
        const a = p.joints[j.name] ?? [0, 0, 0];
        o.rotation.set(...(a.map((d) => (d * Math.PI) / 180) as [number, number, number]), j.order as EulerOrder);
        objs.set(j.name, o);
        (j.parent ? objs.get(j.parent)! : root).add(o);
      }
      root.position.set(...r.root);
      root.updateMatrixWorld(true);
      for (const j of JOINTS) {
        const w = objs.get(j.name)!.getWorldPosition(new Vector3());
        const f = r.fk.points[j.name];
        close(w.x, f[0], 1e-9);
        close(w.y, f[1], 1e-9);
        close(w.z, f[2], 1e-9);
      }
    }
  });

  it('角度 0 なら骨格はオフセットの足し算', () => {
    const f = forwardKinematics({}, [0, 1, 0]);
    close(f.points.elbowL[0], 0.19);
    close(f.points.elbowL[1], 1 + 0.12 + 0.34 - 0.29);
  });
});

describe('pickPoseSequence', () => {
  it('同じ seed なら同じ順、違う seed なら（ほぼ）違う順', () => {
    expect(pickPoseSequence(10, 123)).toEqual(pickPoseSequence(10, 123));
    expect(pickPoseSequence(16, 1)).not.toEqual(pickPoseSequence(16, 2));
  });

  it('count 個・一巡するまで重複なし', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = pickPoseSequence(16, seed);
      expect(s).toHaveLength(16);
      expect(new Set(s).size).toBe(16);
      const s5 = pickPoseSequence(5, seed);
      expect(new Set(s5).size).toBe(5);
      expect(s.slice(0, 5)).toEqual(s5);
    }
  });

  it('長い列でも同じポーズが連続しない（巡目の境目を含む）', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = pickPoseSequence(80, seed);
      for (let k = 1; k < s.length; k++) expect(s[k]).not.toBe(s[k - 1]);
      for (let b = 0; b < 5; b++) expect(new Set(s.slice(b * 16, b * 16 + 16)).size).toBe(16);
    }
  });

  it('0 以下や候補 1 種でも壊れない', () => {
    expect(pickPoseSequence(0, 1)).toEqual([]);
    expect(pickPoseSequence(3, 1, ['walk'])).toEqual(['walk', 'walk', 'walk']);
  });
});

describe('カメラ・光源', () => {
  it('wrapDeg は -180〜180', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(0)).toBe(0);
  });

  it('sphericalDir: 正面は +Z、右回り 90° は +X、真上は +Y', () => {
    const f = sphericalDir(0, 0);
    close(f[2], 1);
    const r = sphericalDir(90, 0);
    close(r[0], 1);
    close(sphericalDir(0, 90)[1], 1);
  });

  it('ドラッグ: 水平は回り続け、上下は制限内に収まる', () => {
    let s = { azimuth: 0, elevation: 10, zoom: 1 };
    s = dragCamera(s, -100, 0);
    close(s.azimuth, 45);
    s = dragCamera(s, 0, 10000);
    expect(s.elevation).toBe(CAMERA_LIMITS.elevationMax);
    s = dragCamera(s, 0, -10000);
    expect(s.elevation).toBe(CAMERA_LIMITS.elevationMin);
    s = dragCamera(s, -1000, 0);
    expect(s.azimuth).toBeGreaterThanOrEqual(-180);
    expect(s.azimuth).toBeLessThanOrEqual(180);
  });

  it('ピンチで開くと寄り、ホイール下で遠ざかる・距離は制限内', () => {
    const s = { azimuth: 0, elevation: 10, zoom: 1 };
    expect(pinchCamera(s, 100, 200).zoom).toBeCloseTo(0.55);
    expect(pinchCamera(s, 100, 50).zoom).toBeCloseTo(1.8);
    expect(pinchCamera(s, 0, 50)).toEqual(s);
    expect(wheelCamera(s, 100).zoom).toBeGreaterThan(1);
    expect(clampCamera({ ...s, zoom: 99 }).zoom).toBe(CAMERA_LIMITS.zoomMax);
  });

  it('frameBounds: 外接球が縦横どちらの画角にも収まる', () => {
    const b = resolvePose('stand').bounds;
    for (const aspect of [360 / 520, 1, 2]) {
      const f = frameBounds(b, 30, aspect);
      const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
      const hHalf = Math.atan(Math.tan((15 * Math.PI) / 180) * aspect);
      const half = Math.min((15 * Math.PI) / 180, hHalf);
      expect(r * 0.94 / f.distance).toBeCloseTo(Math.sin(half), 9);
      expect(f.target[1]).toBeGreaterThan(0.8);
      const p = cameraPosition(f, { azimuth: 0, elevation: 0, zoom: 2 });
      close(p[2] - f.target[2], f.distance * 2);
    }
  });

  it('roundView: 1 体目は斜めの既定、以降はシードで再現できるランダム', () => {
    expect(roundView(5, 0).camera).toEqual({ azimuth: 35, elevation: 16, zoom: 1 });
    expect(roundView(5, 3)).toEqual(roundView(5, 3));
    expect(roundView(5, 3)).not.toEqual(roundView(5, 4));
    for (let n = 1; n < 50; n++) {
      const v = roundView(99, n);
      expect(v.camera.elevation).toBeGreaterThanOrEqual(-5);
      expect(v.camera.elevation).toBeLessThanOrEqual(35);
      expect(v.light.elevation).toBeGreaterThanOrEqual(35);
      expect(v.light.elevation).toBeLessThanOrEqual(75);
    }
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
  });
});

describe('シルエット処理', () => {
  it('alphaBounds: 不透明部分の外接矩形', () => {
    const w = 6;
    const h = 5;
    const d = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number) => (d[(y * w + x) * 4 + 3] = 255);
    set(1, 2);
    set(4, 3);
    expect(alphaBounds(d, w, h)).toEqual({ x: 1, y: 2, w: 4, h: 2 });
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  it('flipRows で上下が入れ替わる', () => {
    const d = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]);
    expect([...flipRows(d, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('tintSolid は alpha を残して色だけ変える／unpremultiply', () => {
    const d = new Uint8ClampedArray([10, 20, 30, 128]);
    tintSolid(d, [1, 2, 3]);
    expect([...d]).toEqual([1, 2, 3, 128]);
    const p = new Uint8ClampedArray([64, 32, 0, 128]);
    unpremultiply(p);
    expect([...p]).toEqual([128, 64, 0, 128]);
  });

  it('parseCssColor', () => {
    expect(parseCssColor(' #7BB661 ')).toEqual([0x7b, 0xb6, 0x61]);
    expect(parseCssColor('#fff')).toEqual([255, 255, 255]);
    expect(parseCssColor('rgba(143, 197, 111, 0.8)')).toEqual([143, 197, 111]);
    expect(parseCssColor('rgb(1 2 3)')).toEqual([1, 2, 3]);
    expect(parseCssColor('green')).toBeNull();
  });
});

describe('2D フォールバック（棒人形）', () => {
  it('全ポーズぶんあり、viewBox に収まる', () => {
    expect(MANNEQUIN_POSES).toHaveLength(POSES.length);
    for (const p of MANNEQUIN_POSES) {
      const b = poseBounds(p);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(POSE_VIEWBOX.width + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(POSE_VIEWBOX.height + 0.5);
      expect(p.lines.length).toBe(7);
    }
  });

  it('立ちポーズは頭が上、足が下（画面座標は下向き）', () => {
    const s = stickPoseFor('stand');
    const feet = s.lines[5]!.at(-1)!;
    expect(s.head.y).toBeLessThan(feet.y);
  });

  it('projectPoint: 正面から見ると +X が右、上が +y', () => {
    const q = projectPoint([1, 2, 0], 0, 0);
    close(q.x, 1);
    close(q.y, 2);
    const side = projectPoint([0, 0, 1], 90, 0);
    close(side.x, -1);
  });
});
