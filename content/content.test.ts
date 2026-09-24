import { describe, expect, it } from 'vitest';
import { flattenPath, getTemplate, loadCurriculum, nextLesson, stageProgress } from '../src/content/index';
import type { Step } from '../src/content/schema';

/** content/figures にある図解の id（ファイルの存在確認用。中身は読まない） */
const FIGURE_IDS = new Set(Object.keys(import.meta.glob('./figures/*.svg')).map((p) => p.replace(/^.*\//, '').replace(/\.svg$/, '')));
/** 教材ファイルの生テキスト（整形前の値を確かめる） */
const RAW_STAGE_TEXT = import.meta.glob('./stages/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

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

describe('教材の全件ロードと参照', () => {
  const path = flattenPath(loadCurriculum());
  const steps = path.flatMap((n) => n.lesson.steps.map((step, i) => ({ id: n.lesson.id, i, step })));

  it('全ステージが揃っている（s0〜s10、s1_5 を含む 12 ステージ）', () => {
    const ids = loadCurriculum().stages.map((s) => s.id).sort();
    expect(ids).toEqual(['s0', 's1', 's10', 's1_5', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'].sort());
    expect(path.length).toBeGreaterThan(150);
  });

  it('参照している図解（figures/*.svg）がすべて存在する', () => {
    const figureIds = new Set<string>();
    const add = (id: string | undefined) => id && figureIds.add(id);
    for (const { step } of steps) {
      if (step.type === 'read') add(step.figure);
      if (step.type === 'quiz') step.options.forEach((o) => add(o.figure));
      if (step.type === 'construct') step.stages.forEach((s) => add(s.figure));
      if (step.type === 'copy' && step.reference === 'builtin') add(step.refId);
    }
    expect(FIGURE_IDS.size).toBeGreaterThan(100);
    const missing = [...figureIds].filter((id) => !FIGURE_IDS.has(id));
    expect(missing).toEqual([]);
  });

  it('参照しているなぞりテンプレートがすべて存在する', () => {
    const missing = steps.filter(({ step }) => step.type === 'trace' && !getTemplate(step.template)).map(({ id, i }) => `${id}[${i}]`);
    expect(missing).toEqual([]);
  });

  it('筆圧ドリルの profile は正式な値だけ（元ファイルにも別名が残っていない）', () => {
    for (const { step } of steps) {
      if (step.type === 'drill' && step.drill === 'pressure' && step.params?.['profile'] !== undefined) {
        expect(['ramp-up', 'ramp-down', 'flat']).toContain(step.params['profile']);
      }
    }
    expect(Object.keys(RAW_STAGE_TEXT).length).toBe(12);
    for (const raw of Object.values(RAW_STAGE_TEXT)) {
      expect(raw).not.toMatch(/"profile":\s*"(increasing|decreasing|constant)"/);
    }
  });
});

describe('選択式（U10-2 塗り技法）', () => {
  const s10 = loadCurriculum().stages.find((s) => s.id === 's10')!;

  it('U10-2 の 9 レッスンがすべて optional', () => {
    const u2 = s10.units.find((u) => u.id === 's10-u2')!;
    expect(u2.lessons).toHaveLength(9);
    for (const l of u2.lessons) {
      expect(l.optional).toBe(true);
      const first = l.steps.find((st) => st.type === 'read');
      expect(first && first.type === 'read' && first.body.startsWith('この技法をやらない場合は、ヘッダの「この技法は飛ばす」で3課とも飛ばして OK です。')).toBe(true);
    }
  });

  it('U10-2 以外に optional のレッスンは無い（最終課題は必修）', () => {
    const others = flattenPath(loadCurriculum()).filter((n) => n.lesson.optional && n.unit.id !== 's10-u2');
    expect(others.map((n) => n.lesson.id)).toEqual([]);
  });
});

describe('累計カウンター（trace / construct）', () => {
  const path = flattenPath(loadCurriculum());
  const withCounter = path.flatMap((n) =>
    n.lesson.steps.flatMap((step: Step, i) =>
      (step.type === 'trace' || step.type === 'construct') && step.counter ? [{ id: n.lesson.id, i, step }] : [],
    ),
  );

  it('U2-2 の箱の構築となぞりに boxes が付いている', () => {
    const ids = withCounter.filter((x) => x.id.startsWith('s2-u2-')).map((x) => `${x.id}[${x.i}]`);
    for (const want of ['s2-u2-l1[1]', 's2-u2-l1[2]', 's2-u2-l2[1]', 's2-u2-l2[2]', 's2-u2-l3[1]', 's2-u2-l3[2]', 's2-u2-l6[1]', 's2-u2-l6[2]']) {
      expect(ids).toContain(want);
    }
    for (const x of withCounter) expect(x.step.counter).toBe('boxes');
  });

  it('「箱カウンターにN個加わります」の N と construct の count が一致する', () => {
    for (const { id, i, step } of withCounter) {
      if (step.type !== 'construct') continue;
      const m = /箱カウンターに(\d+)個加わります/.exec(step.instruction);
      expect(m, `${id}[${i}]`).not.toBeNull();
      expect(Number(m![1]), `${id}[${i}]`).toBe(step.count ?? 1);
    }
  });

  it('箱カウンターに触れる文言があるステップには counter が付いている', () => {
    for (const n of path) {
      n.lesson.steps.forEach((step, i) => {
        if ((step.type === 'construct' || step.type === 'trace') && step.instruction.includes('箱カウンター')) {
          expect(step.counter, `${n.lesson.id}[${i}]`).toBe('boxes');
        }
      });
    }
  });
});
