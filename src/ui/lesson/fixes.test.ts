/**
 * レビュー指摘の修正（レッスン進行・キャンバス・批評）のテスト。
 * 番号はレビュー由来（1: 復習の番号 / 2: セッション / 4: 完了の記録 / 5: 確定した本だけ記録 /
 * 6: params の採点 / 8: 描いていた時間 / 10: 回転 / 11: 批評の文言 / 12: Before・After /
 * 15: 採点済みの線 / 20: クイズの並べ替え / 21: 箱の追加ドリル）。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { flattenPath, getTemplate, loadCurriculum } from '@/content';
import { openDb } from '@/data/db';
import { getDrillStats, getProfile, getProgress } from '@/data/repo';
import { circle, line as lineStroke, pt } from '@/scoring/test-helpers';
import type { Stroke } from '@/scoring';
import { counters, curriculum, drillStats, profile, progress } from '../state';
import { href, parseHash } from '../router';
import { ERROR_TEXT } from './critiqueText';
import { strokeKey, summarizeEntries, syncEntries, type DrillEntry } from './drillEntries';
import { drillSetup, fitTemplate, orientationError, rescaleMap, scoreDrill, taperOutScore } from './drillSetup';
import { scorersFor } from './limits';
import {
  finishLesson,
  freeDrawingKind,
  markBeforeAfter,
  peekLessonSession,
  recordDrillScores,
  resetLessonSession,
  endLessonSession,
} from './stateBridge';
import {
  activeDrawingMs,
  afterStep,
  boxReviewSteps,
  buildPlaySteps,
  ELAPSED_MIN_CAP,
  elapsedMinutes,
  playIndexOf,
  reachedBoxStage,
  shuffledOrder,
  warmupCount,
} from './steps';

const cur = loadCurriculum();
const path = flattenPath(cur);
const node = (id: string) => path.find((n) => n.lesson.id === id)!;
const dueLine = [{ drillType: 'line', reasons: ['stale' as const], recentAverage: 50, bestScore: 80, daysSinceLast: 20 }];

async function clearAllStores(): Promise<void> {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, 'readwrite');
  await Promise.all(names.map((n) => tx.objectStore(n).clear()));
  await tx.done;
}

beforeEach(async () => {
  await clearAllStores();
  curriculum.value = cur;
  progress.value = [];
  counters.value = null;
  drillStats.value = [];
  profile.value = null;
});

describe('1: 復習は表示上の前置き（URL の番号はレッスン本来の番号）', () => {
  const lesson = node('s1-u1-l1').lesson;
  const steps = buildPlaySteps(lesson, dueLine);

  it('復習を済ませるまでは復習、済んだら URL の番号のステップ', () => {
    expect(warmupCount(steps)).toBe(1);
    expect(playIndexOf(steps, 0, 0)).toBe(0);
    expect(steps[playIndexOf(steps, 0, 0)]!.warmup).toBe(true);
    expect(playIndexOf(steps, 1, 0)).toBe(1);
    expect(steps[playIndexOf(steps, 1, 2)]!.step).toBe(lesson.steps[2]);
  });

  it('復習のあとはレッスンのステップ 0 → 1 … と進み、最後で完了', () => {
    expect(afterStep(steps, 0, 0)).toEqual({ kind: 'warmup', warmupsDone: 1 });
    expect(afterStep(steps, 1, 0)).toEqual({ kind: 'step', lessonIndex: 1 });
    expect(afterStep(steps, 1, lesson.steps.length - 1)).toEqual({ kind: 'finish' });
  });

  it('再読込（復習なしで作り直し）しても、URL の番号のステップがそのまま出る＝1 つ飛ばない', () => {
    const reloaded = buildPlaySteps(lesson, dueLine, false);
    for (let k = 0; k < lesson.steps.length; k++) {
      expect(reloaded[playIndexOf(reloaded, 0, k)]!.step).toBe(lesson.steps[k]);
    }
  });
});

describe('2: セッションは作り直す・所要分に上限', () => {
  it('resetLessonSession は前回の点数・絵・開始時刻を持ち越さない', () => {
    const lesson = node('s1-u1-l1').lesson;
    const a = resetLessonSession(lesson, [], true);
    a.drillScores.push(90);
    a.drawingIds.push('x');
    a.startedAt = 0;
    const b = resetLessonSession(lesson, [], true);
    expect(b).not.toBe(a);
    expect(b.drillScores).toEqual([]);
    expect(b.drawingIds).toEqual([]);
    expect(b.startedAt).toBeGreaterThan(0);
    expect(peekLessonSession(lesson.id)).toBe(b);
    endLessonSession(lesson.id);
    expect(peekLessonSession(lesson.id)).toBeUndefined();
  });

  it('所要分は 1..上限（上限を超えたら capped）', () => {
    expect(elapsedMinutes(0, 10_000)).toEqual({ min: 1, capped: false });
    expect(elapsedMinutes(0, 14 * 60_000)).toEqual({ min: 14, capped: false });
    expect(elapsedMinutes(0, 300 * 60_000)).toEqual({ min: ELAPSED_MIN_CAP, capped: true });
  });
});

describe('4・5: 完了の記録は押し直しても重ならない／確定した本だけ履歴へ', () => {
  it('finishLesson を 2 回呼んでも attempts は 1、XP は実増分', async () => {
    const lesson = node('s1-u1-l1').lesson;
    const session = resetLessonSession(lesson, [], false);
    session.drillScores.push(95, 40); // 記録済みのドリル（5 + 2 XP）
    const s1 = await finishLesson(lesson, session);
    // 1 回目の途中で失敗して押し直した想定: 同じセッションでもう一度
    await finishLesson(lesson, session);
    const p = await getProgress(lesson.id);
    expect(p?.attempts).toBe(1);
    expect(s1.xp).toBe(10 + 5 + 2);
    expect(s1.counter).toBeNull();
  });

  it('recordDrillScores は記録済みの数から続ける（二重に入れない）', async () => {
    const prog = { done: 0 };
    await recordDrillScores('line', [70, 80], prog);
    expect(prog.done).toBe(2);
    await recordDrillScores('line', [70, 80, 90], prog);
    const st = await getDrillStats('line');
    expect(st?.history.map((h) => h.score)).toEqual([70, 80, 90]);
  });
});

describe('6: 教材 params を採点に反映', () => {
  const size = { width: 1200, height: 800 };
  const sc = scorersFor(null, 'normal');

  it('向きのズレ（h/v/d）', () => {
    expect(orientationError(0, 'h')).toBe(0);
    expect(orientationError(90, 'h')).toBe(90);
    expect(orientationError(90, 'v')).toBe(0);
    expect(orientationError(135, 'd')).toBe(0);
    expect(orientationError(5, 'd')).toBe(15);
  });

  it('目標の無い直線でも向きを比べる（縦線を水平線の課題で引くと減点）', () => {
    const st = drillSetup('line', { orientation: 'h' }, size, 0);
    expect(st.line).toBeUndefined();
    const good = scoreDrill(sc, 'line', st, [lineStroke(300, 400, 700, 400)])!;
    const bad = scoreDrill(sc, 'line', st, [lineStroke(600, 200, 600, 600)])!;
    expect(good.sub['line.orient']).toBe(100);
    expect(bad.sub['line.orient']).toBe(0);
    expect(bad.score).toBeLessThan(good.score - 25);
    // 斜めの課題で斜め線は減点なし
    const d = drillSetup('line', { orientation: 'd' }, size, 0);
    expect(scoreDrill(sc, 'line', d, [lineStroke(300, 600, 600, 300)])!.sub['line.orient']).toBe(100);
  });

  it('長さ（long は短辺の 45% 以上）', () => {
    const st = drillSetup('line', { orientation: 'h', length: 'long' }, size, 0);
    const short = scoreDrill(sc, 'line', st, [lineStroke(500, 400, 600, 400)])!;
    const long = scoreDrill(sc, 'line', st, [lineStroke(300, 400, 800, 400)])!;
    expect(long.sub['line.length']).toBe(100);
    expect(short.sub['line.length']).toBeLessThan(40);
  });

  it('円の大きさ', () => {
    const st = drillSetup('circle', { size: 'large' }, size, 0);
    const small = scoreDrill(sc, 'circle', st, [circle(600, 400, 40)])!;
    const large = scoreDrill(sc, 'circle', st, [circle(600, 400, 250)])!;
    expect(large.sub['circle.size']).toBe(100);
    expect(small.sub['circle.size']).toBeLessThan(20);
  });

  it('抜き: 筆圧が終わりに下がれば高く、筆圧の無い入力は採点に混ぜない', () => {
    const taper: Stroke = Array.from({ length: 40 }, (_, i) => pt(i * 10, 0, i * 10, i < 30 ? 0.6 : 0.6 - (i - 29) * 0.05));
    const flat: Stroke = Array.from({ length: 40 }, (_, i) => pt(i * 10, 0, i * 10, 0.6 + (i % 2) * 0.1));
    expect(taperOutScore(taper)).toBe(100);
    expect(taperOutScore(flat)).toBeLessThan(40);
    expect(taperOutScore(lineStroke(0, 0, 100, 0))).toBeNull();
  });
});

describe('8: 自由お絵描きの時間は実際に描いていた時間', () => {
  it('ストロークの長さ＋間の空き（空きは 1 回 1 分まで）', () => {
    expect(activeDrawingMs([])).toBe(0);
    expect(
      activeDrawingMs([
        { start: 0, end: 1000 },
        { start: 3000, end: 4000 },
      ]),
    ).toBe(4000);
    // 開きっぱなしで 1 時間空いても、数えるのは 1 分まで
    expect(
      activeDrawingMs([
        { start: 0, end: 1000 },
        { start: 3_600_000, end: 3_601_000 },
      ]),
    ).toBe(2000 + 60_000);
  });
});

describe('10: 回転しても線と目標がずれない', () => {
  it('なぞりのお手本と同じ規則で線を動かす', () => {
    const tpl = getTemplate('cube-1pt')!;
    const a = { width: 1200, height: 800 };
    const b = { width: 800, height: 1200 };
    const before = fitTemplate(tpl, a);
    const after = fitTemplate(tpl, b);
    const map = rescaleMap(a, b);
    const moved = before.map((s) => s.map(map));
    for (let i = 0; i < moved.length; i++) {
      for (let j = 0; j < moved[i]!.length; j++) {
        expect(moved[i]![j]!.x).toBeCloseTo(after[i]![j]!.x, 6);
        expect(moved[i]![j]!.y).toBeCloseTo(after[i]![j]!.y, 6);
      }
    }
  });

  it('ハッチングの枠も同じ規則で動く', () => {
    const a = { width: 1200, height: 800 };
    const b = { width: 800, height: 1200 };
    const ra = drillSetup('hatching', {}, a, 0).guide.area!;
    const rb = drillSetup('hatching', {}, b, 0).guide.area!;
    const q = rescaleMap(a, b)(pt(ra.x, ra.y, 0));
    expect(q.x).toBeCloseTo(rb.x, 6);
    expect(q.y).toBeCloseTo(rb.y, 6);
  });
});

describe('11: 批評の文言', () => {
  it('rate_limited（一時制限）と daily_limit（アプリの上限）を分ける', () => {
    expect(ERROR_TEXT.rate_limited.title).toContain('少し待ってからもう一度');
    expect(ERROR_TEXT.daily_limit.body).toContain('明日');
    expect(ERROR_TEXT.daily_limit.title).not.toBe(ERROR_TEXT.rate_limited.title);
    for (const t of Object.values(ERROR_TEXT)) expect(t.title + t.body).not.toContain('ください');
  });
});

describe('12: Before / After', () => {
  it('保存の種別と profile の更新', async () => {
    expect(freeDrawingKind(undefined)).toBe('free');
    expect(freeDrawingKind('before')).toBe('before');
    expect(freeDrawingKind('after')).toBe('after');
    await markBeforeAfter('d-before', 'before');
    await markBeforeAfter('d-after', 'after');
    const p = await getProfile();
    expect(p.beforeDrawingId).toBe('d-before');
    expect(p.beforeCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.afterDrawingId).toBe('d-after');
    expect(profile.value?.afterDrawingId).toBe('d-after');
  });

  it('#/free?save=after を読む', () => {
    expect(parseHash('#/free?save=after')).toEqual({ name: 'free', save: 'after' });
    expect(parseHash('#/free')).toEqual({ name: 'free' });
    expect(parseHash('#/free?save=xx')).toEqual({ name: 'free' });
    expect(href.free('after')).toBe('#/free?save=after');
  });
});

describe('15: 採点済みの線', () => {
  const s1 = lineStroke(0, 0, 100, 0);
  const s2 = lineStroke(0, 50, 100, 50);
  const entry = (s: Stroke, score: number): DrillEntry => ({
    keys: [strokeKey(s)],
    strokes: [s],
    result: { score, sub: { 'line.rmse': score }, hint: `h${score}`, heat: [s.map(() => 0)], raw: {} },
    target: null,
  });

  it('Undo・消しゴムで消えた線の採点は外す', () => {
    const es = [entry(s1, 80), entry(s2, 60)];
    expect(syncEntries(es, [s1, s2])).toHaveLength(2);
    expect(syncEntries(es, [s1])).toEqual([es[0]]);
    expect(syncEntries(es, [])).toEqual([]);
  });

  it('セットのまとめは平均点・一番低い本の助言', () => {
    const sum = summarizeEntries([entry(s1, 80), entry(s2, 60)])!;
    expect(sum.score).toBe(70);
    expect(sum.sub['line.rmse']).toBe(70);
    expect(sum.hint).toBe('h60');
    expect(sum.heat).toHaveLength(2);
  });
});

describe('20: クイズの並べ替え', () => {
  it('並べ替えは順列で、元の番号で正誤を引ける', () => {
    const order = shuffledOrder(4, () => 0);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    // rnd=0 だと先頭（元の 0 番＝教材の正解に偏りがちな位置）は後ろへ回る
    expect(order[0]).not.toBe(0);
    expect(shuffledOrder(1)).toEqual([0]);
  });
});

describe('21: 箱の追加ドリル', () => {
  it('cube-1pt / cube-2pt のなぞりで、counter は boxes', () => {
    const steps = boxReviewSteps();
    expect(steps.map((s) => s.template)).toEqual(['cube-1pt', 'cube-2pt']);
    for (const s of steps) {
      expect(s.counter).toBe('boxes');
      expect(getTemplate(s.template)).toBeDefined();
    }
  });

  it('ステージ 2 以降の学習者だけ', () => {
    expect(reachedBoxStage(path, new Set())).toBe(false);
    const upToS1 = new Set(path.filter((n) => n.stage.order < 2).map((n) => n.lesson.id));
    expect(reachedBoxStage(path, upToS1)).toBe(true);
    expect(reachedBoxStage(path, new Set(path.map((n) => n.lesson.id)))).toBe(true);
  });
});
