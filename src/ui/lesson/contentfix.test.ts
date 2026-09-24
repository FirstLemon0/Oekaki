/**
 * 教材レビュー「本文とアプリの動きのずれ」の修正のテスト。
 * クイズの ①②③④、構築の keepPrevious（線の引き継ぎ）、ドリルの点の取り消し閾値、
 * 重ねのお手本の縦横比、補助線を採点から除くこと、ポーズ群。
 */
import { describe, expect, it } from 'vitest';
import { createCanvasEngine, guideStrokeStyle, type StrokeStyle } from '@/canvas';
import { PoseGroupSchema } from '@/content/schema';
import { POSE_GROUPS, POSE_IDS, pickPoseSequence, poseIdsOf, seedFromSearch } from '@/mannequin/poses';
import type { Stroke, StrokePoint } from '@/scoring';
import { penStrokesOf } from './drillEntries';
import { carryHistory, DRILL_MIN_STROKE_PX, isTooShortForDrill } from './drillSetup';
import { svgForOverlay } from './figures';
import { choiceMark, labeledChoices, shuffledOrder, stripChoicePrefix } from './steps';

const pt = (x: number, y: number, t = 0): StrokePoint => ({ x, y, p: 0.5, t });

describe('クイズの選択肢ラベル（7）', () => {
  it('表示の位置に ①②③④ を振る（元の番号ではない）', () => {
    expect([0, 1, 2, 3].map(choiceMark)).toEqual(['①', '②', '③', '④']);
    expect(choiceMark(19)).toBe('⑳');
    expect(choiceMark(20)).toBe('21.');
  });

  it('並べ替えた順に ①② を振り、orig で正解を引ける', () => {
    const texts = ['正解', 'はずれ1', 'はずれ2', 'はずれ3'];
    const order = [2, 0, 3, 1];
    const c = labeledChoices(texts, order);
    expect(c.map((x) => x.mark)).toEqual(['①', '②', '③', '④']);
    expect(c.map((x) => x.text)).toEqual(['はずれ2', '正解', 'はずれ3', 'はずれ1']);
    // 正解（answer=0）は表示では ② になる
    expect(c.find((x) => x.orig === 0)!.mark).toBe('②');
  });

  it('shuffledOrder の結果でも全部の選択肢が 1 回ずつ出る', () => {
    const order = shuffledOrder(4, () => 0.3);
    const c = labeledChoices(['a', 'b', 'c', 'd'], order);
    expect(c.map((x) => x.orig).sort()).toEqual([0, 1, 2, 3]);
  });

  it('本文先頭の「A: 」「B：」「(C) 」などは外す（それ以外は触らない）', () => {
    expect(stripChoicePrefix('A: 円柱')).toBe('円柱');
    expect(stripChoicePrefix('B：箱')).toBe('箱');
    expect(stripChoicePrefix('（C）楕円')).toBe('楕円');
    expect(stripChoicePrefix('d) 線')).toBe('線');
    expect(stripChoicePrefix('A4 の紙に描く')).toBe('A4 の紙に描く');
    expect(stripChoicePrefix('Aラインの服')).toBe('Aラインの服');
    expect(stripChoicePrefix('A:')).toBe('A:');
  });
});

describe('構築の keepPrevious（3）: 前のステップの線を引き継ぐ', () => {
  const guide = guideStrokeStyle();
  const pen: StrokeStyle = { preset: 'pen', size: 3, opacity: 1 };
  const eraser: StrokeStyle = { preset: 'eraser', size: 10, opacity: 1 };

  it('同じ大きさならそのまま（コピー）、違えば中心合わせ・短辺の比で写す。消しゴム・補助線も並びごと', () => {
    const h = { strokes: [[pt(100, 100), pt(200, 100)], [pt(150, 90)], [pt(0, 0), pt(10, 10)]], styles: [pen, eraser, guide] };
    const same = carryHistory(h, { width: 400, height: 300 }, { width: 400, height: 300 });
    expect(same.strokes).toEqual(h.strokes);
    expect(same.strokes[0]).not.toBe(h.strokes[0]);
    expect(same.styles).toEqual([pen, eraser, guide]);
    const moved = carryHistory(h, { width: 400, height: 300 }, { width: 800, height: 600 });
    // 中心 (200,150) → (400,300)、倍率 2
    expect(moved.strokes[0]![0]).toMatchObject({ x: 400 + (100 - 200) * 2, y: 300 + (100 - 150) * 2 });
    expect(moved.styles).toEqual(h.styles);
  });

  it('エンジンへ読み込むと、消しゴム・補助線込みで同じ点列になる（保存は最終状態＝引き継いだ線＋描き足した線）', () => {
    const a = createCanvasEngine();
    a.loadHistory({ strokes: [[pt(0, 0), pt(50, 0)], [pt(0, 20), pt(50, 20)]], styles: [pen, guide] });
    const b = createCanvasEngine();
    b.loadHistory(carryHistory(a.getHistory(), { width: 400, height: 300 }, { width: 400, height: 300 }));
    expect(b.getStrokes()).toEqual(a.getStrokes());
    expect(b.getStrokes()).toHaveLength(1);
    expect(b.getHistory().styles.map((s) => s?.preset)).toEqual(['pen', 'guide']);
  });
});

describe('ドリルの点の取り消し（8）', () => {
  it(`点（2 点未満）・長さ ${DRILL_MIN_STROKE_PX}px 未満の線だけを取り消す`, () => {
    expect(DRILL_MIN_STROKE_PX).toBe(12);
    expect(isTooShortForDrill([pt(0, 0)])).toBe(true);
    expect(isTooShortForDrill([pt(0, 0), pt(11.9, 0)])).toBe(true);
    expect(isTooShortForDrill([pt(0, 0), pt(6, 0), pt(12, 0)])).toBe(false);
    const long: Stroke = [pt(0, 0), pt(100, 0)];
    expect(isTooShortForDrill(long)).toBe(false);
  });
});

describe('補助線（5）: 採点・本数から除く', () => {
  it('penStrokesOf（ドリルの採点済みの線との対応づけ）は補助線を含めない', () => {
    const h = {
      strokes: [[pt(0, 0), pt(50, 0)], [pt(0, 20), pt(50, 20)]] as Stroke[],
      styles: [guideStrokeStyle(), undefined],
    };
    expect(penStrokesOf(h)).toHaveLength(1);
    expect(penStrokesOf(h)[0]![0]!.y).toBe(20);
  });
});

describe('重ねのお手本（2）: 縦横比は viewBox に合わせる', () => {
  it('width が無い SVG は viewBox の縦横比で大きさを付ける（inline の図解と同じ縮尺で重なる）', () => {
    const out = svgForOverlay('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" stroke-width="2"><path/></svg>', '#000');
    expect(out).toContain('width="1600" height="1600"');
    const wide = svgForOverlay('<svg viewBox="0 0 800 500" stroke="currentColor"></svg>', '#123456');
    expect(wide).toContain('width="1600" height="1000"');
    expect(wide).toContain('stroke="#123456"');
    // width があればそのまま
    expect(svgForOverlay('<svg width="10" height="20" viewBox="0 0 800 500"></svg>', '#000')).toBe('<svg width="10" height="20" viewBox="0 0 800 500"></svg>');
  });
});

describe('ポーズ群（6）', () => {
  it('群の定義（standing / sitting / action）は全 16 種を重複なく分ける', () => {
    expect([...POSE_GROUPS.standing]).toEqual(['stand', 'contrapposto', 'raise-hand', 'stretch', 'one-leg', 'turn']);
    expect([...POSE_GROUPS.sitting]).toEqual(['sit', 'crouch', 'lie', 'bend']);
    expect([...POSE_GROUPS.action]).toEqual(['walk', 'run', 'jump', 'throw', 'kick', 'look-back-walk']);
    const union = [...POSE_GROUPS.standing, ...POSE_GROUPS.sitting, ...POSE_GROUPS.action];
    expect(new Set(union).size).toBe(union.length);
    expect([...union].sort()).toEqual([...POSE_IDS].sort());
    expect(POSE_GROUPS.all).toEqual(POSE_IDS);
  });

  it('教材スキーマの poseGroup の値と群の名前がそろっている', () => {
    expect([...PoseGroupSchema.options].sort()).toEqual(Object.keys(POSE_GROUPS).sort());
  });

  it('pickPoseSequence は群の中からだけ出す（群の数を超えたら一巡してから繰り返す）', () => {
    for (const g of ['standing', 'sitting', 'action'] as const) {
      for (const seed of [1, 42, 12345]) {
        const seq = pickPoseSequence(10, seed, poseIdsOf(g));
        expect(seq).toHaveLength(10);
        expect(seq.every((id) => POSE_GROUPS[g].includes(id))).toBe(true);
        const n = POSE_GROUPS[g].length;
        expect(new Set(seq.slice(0, n)).size).toBe(n);
      }
    }
  });

  it('poseIdsOf: 未指定・知らない値は全種。同じ seed なら同じ順', () => {
    expect(poseIdsOf(undefined)).toBe(POSE_IDS);
    expect(poseIdsOf('all')).toBe(POSE_IDS);
    expect(poseIdsOf('flying')).toBe(POSE_IDS);
    expect(pickPoseSequence(5, 7, poseIdsOf('sitting'))).toEqual(pickPoseSequence(5, 7, poseIdsOf('sitting')));
  });

  it('seedFromSearch: ?seed=<整数> だけを受ける', () => {
    expect(seedFromSearch('?seed=42')).toBe(42);
    expect(seedFromSearch('?a=1&seed=0')).toBe(0);
    expect(seedFromSearch('?seed=-1')).toBeNull();
    expect(seedFromSearch('?seed=abc')).toBeNull();
    expect(seedFromSearch('')).toBeNull();
  });
});
