import { describe, expect, it } from 'vitest';
import { flattenPath, loadCurriculum, nextLesson, stageProgress } from '../src/content/index';

describe('loadCurriculum', () => {
  it('実ファイル（content/stages, content/rubrics）が全件検証を通る', () => {
    expect(() => loadCurriculum()).not.toThrow();
  });

  it('ステージ0が7レッスン揃っている', () => {
    const curriculum = loadCurriculum();
    const s0 = curriculum.stages.find((stage) => stage.id === 's0');
    expect(s0).toBeDefined();
    const lessonCount = s0!.units.reduce((sum, unit) => sum + unit.lessons.length, 0);
    expect(lessonCount).toBe(7);
  });

  it('ステージ1のルーブリックが読み込まれている', () => {
    const curriculum = loadCurriculum();
    const rubric = curriculum.rubrics.find((r) => r.id === 's1-graduation');
    expect(rubric).toBeDefined();
    expect(rubric?.stage).toBe('s1');
  });
});

describe('flattenPath', () => {
  it('ステージ順→ユニット順→レッスン順で一本道になる', () => {
    const curriculum = loadCurriculum();
    const path = flattenPath(curriculum);

    expect(path.length).toBeGreaterThan(0);
    expect(path[0]?.lesson.id).toBe('s0-u1-l1');
    expect(path[1]?.lesson.id).toBe('s0-u1-l2');
    expect(path[6]?.lesson.id).toBe('s0-u1-l7');

    // index は通し番号
    path.forEach((node, i) => expect(node.index).toBe(i));

    // 各ノードの stage/unit/lesson の所属関係が一致している
    for (const node of path) {
      expect(node.unit.lessons).toContain(node.lesson);
      expect(node.stage.units).toContain(node.unit);
    }
  });
});

describe('nextLesson', () => {
  it('未完了が無ければ先頭のノードを返す', () => {
    const path = flattenPath(loadCurriculum());
    const node = nextLesson(path, new Set());
    expect(node?.lesson.id).toBe('s0-u1-l1');
  });

  it('先頭が完了済みなら次のノードを返す', () => {
    const path = flattenPath(loadCurriculum());
    const node = nextLesson(path, new Set(['s0-u1-l1']));
    expect(node?.lesson.id).toBe('s0-u1-l2');
  });

  it('全て完了済みなら undefined を返す', () => {
    const path = flattenPath(loadCurriculum());
    const allIds = new Set(path.map((n) => n.lesson.id));
    const node = nextLesson(path, allIds);
    expect(node).toBeUndefined();
  });
});

describe('stageProgress', () => {
  it('ステージ0の完了数と総数を返す', () => {
    const path = flattenPath(loadCurriculum());
    const progress = stageProgress(path, new Set(['s0-u1-l1', 's0-u1-l2']), 's0');
    expect(progress).toEqual({ done: 2, total: 7 });
  });

  it('該当ノードが無いステージは total 0 を返す', () => {
    const path = flattenPath(loadCurriculum());
    const progress = stageProgress(path, new Set(), 's999');
    expect(progress).toEqual({ done: 0, total: 0 });
  });
});
