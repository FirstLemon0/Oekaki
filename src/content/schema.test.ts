import { describe, expect, it } from 'vitest';
import { CurriculumSchema, LessonSchema, normalizePressureProfile, StageSchema, StepSchema, UnitSchema } from './schema';

function minimalLesson(id: string, steps: unknown[] = [{ type: 'free' }]) {
  return {
    id,
    title: 'テストレッスン',
    minutes: 10,
    kind: 'lesson',
    summary: 'テスト用の要約です。',
    steps,
  };
}

describe('Step / discriminated union', () => {
  it('read ステップが通る', () => {
    expect(() =>
      StepSchema.parse({ type: 'read', title: 'タイトル', body: '本文です。' })
    ).not.toThrow();
  });

  it('drill ステップが params/counter 込みで通る', () => {
    expect(() =>
      StepSchema.parse({
        type: 'drill',
        drill: 'ellipse',
        count: 5,
        instruction: '楕円を5個描きましょう。',
        params: { degree: 30, axisAngleDeg: '15' },
        counter: 'ellipses',
      })
    ).not.toThrow();
  });

  it('quiz の answer が options 範囲内なら通る', () => {
    expect(() =>
      StepSchema.parse({
        type: 'quiz',
        question: 'Q?',
        options: [{ text: 'A' }, { text: 'B' }],
        answer: 1,
        explain: '説明',
      })
    ).not.toThrow();
  });

  it('quiz の answer が options 範囲外なら弾かれる', () => {
    const result = StepSchema.safeParse({
      type: 'quiz',
      question: 'Q?',
      options: [{ text: 'A' }, { text: 'B' }],
      answer: 2,
      explain: '説明',
    });
    expect(result.success).toBe(false);
  });

  it('quiz の options が1個しかない場合は弾かれる', () => {
    const result = StepSchema.safeParse({
      type: 'quiz',
      question: 'Q?',
      options: [{ text: 'A' }],
      answer: 0,
      explain: '説明',
    });
    expect(result.success).toBe(false);
  });

  it('未知の type は弾かれる', () => {
    const result = StepSchema.safeParse({ type: 'unknown-type', foo: 'bar' });
    expect(result.success).toBe(false);
  });
});

describe('Lesson', () => {
  it('最小構成のレッスンが通る', () => {
    expect(() => LessonSchema.parse(minimalLesson('s1-u1-l1'))).not.toThrow();
  });

  it('lesson.id が規約違反なら弾かれる', () => {
    const result = LessonSchema.safeParse(minimalLesson('lesson-1'));
    expect(result.success).toBe(false);
  });

  it('steps が空配列だと弾かれる', () => {
    const result = LessonSchema.safeParse(minimalLesson('s1-u1-l1', []));
    expect(result.success).toBe(false);
  });
});

describe('Unit', () => {
  it('最小構成のユニットが通る', () => {
    const unit = {
      id: 's1-u1',
      title: '直線',
      lessons: [minimalLesson('s1-u1-l1'), minimalLesson('s1-u1-l2')],
    };
    expect(() => UnitSchema.parse(unit)).not.toThrow();
  });

  it('unit.id が規約違反なら弾かれる', () => {
    const unit = {
      id: 'u1',
      title: '直線',
      lessons: [minimalLesson('s1-u1-l1')],
    };
    const result = UnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
  });

  it('lesson.id が親 unit の配下でないと弾かれる', () => {
    const unit = {
      id: 's1-u1',
      title: '直線',
      lessons: [minimalLesson('s2-u1-l1')],
    };
    const result = UnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
  });

  it('unit 内で lesson.id が重複すると弾かれる', () => {
    const unit = {
      id: 's1-u1',
      title: '直線',
      lessons: [minimalLesson('s1-u1-l1'), minimalLesson('s1-u1-l1')],
    };
    const result = UnitSchema.safeParse(unit);
    expect(result.success).toBe(false);
  });
});

describe('Stage', () => {
  const validStage = {
    id: 's9',
    order: 9,
    title: 'テストステージ',
    weeks: 1,
    units: [
      {
        id: 's9-u1',
        title: 'ユニット1',
        lessons: [minimalLesson('s9-u1-l1'), minimalLesson('s9-u1-l2')],
      },
    ],
  };

  it('最小構成のステージが通る', () => {
    expect(() => StageSchema.parse(validStage)).not.toThrow();
  });

  it('stage.id が規約違反（s1_5 以外の小数表記など）なら弾かれる', () => {
    const result = StageSchema.safeParse({ ...validStage, id: 'stage-9' });
    expect(result.success).toBe(false);
  });

  it('s1_5 形式の stage.id は通る', () => {
    const stage = {
      ...validStage,
      id: 's1_5',
      units: [
        {
          id: 's1_5-u1',
          title: 'ユニット1',
          lessons: [minimalLesson('s1_5-u1-l1')],
        },
      ],
    };
    expect(() => StageSchema.parse(stage)).not.toThrow();
  });

  it('unit.id が親 stage の配下でないと弾かれる', () => {
    const stage = {
      ...validStage,
      units: [
        {
          id: 's1-u1',
          title: 'ユニット1',
          lessons: [minimalLesson('s1-u1-l1')],
        },
      ],
    };
    const result = StageSchema.safeParse(stage);
    expect(result.success).toBe(false);
  });

  it('stage 内で unit.id が重複すると弾かれる', () => {
    const stage = {
      ...validStage,
      units: [
        { id: 's9-u1', title: 'A', lessons: [minimalLesson('s9-u1-l1')] },
        { id: 's9-u1', title: 'B', lessons: [minimalLesson('s9-u1-l2')] },
      ],
    };
    const result = StageSchema.safeParse(stage);
    expect(result.success).toBe(false);
  });

  it('stage 内で lesson.id がユニットを跨いで重複すると弾かれる', () => {
    const stage = {
      ...validStage,
      units: [
        { id: 's9-u1', title: 'A', lessons: [minimalLesson('s9-u1-l1')] },
        { id: 's9-u2', title: 'B', lessons: [minimalLesson('s9-u1-l1')] },
      ],
    };
    const result = StageSchema.safeParse(stage);
    expect(result.success).toBe(false);
  });
});

describe('Curriculum', () => {
  const stage = {
    id: 's9',
    order: 9,
    title: 'テストステージ',
    weeks: 1,
    units: [
      {
        id: 's9-u1',
        title: 'ユニット1',
        lessons: [minimalLesson('s9-u1-l1')],
      },
    ],
  };
  const rubric = {
    id: 's9-graduation',
    stage: 's9',
    title: 'ルーブリック',
    points: ['観点1'],
    focus: '重み付けの説明',
  };

  it('最小構成のカリキュラムが通る', () => {
    expect(() => CurriculumSchema.parse({ stages: [stage], rubrics: [rubric] })).not.toThrow();
  });

  it('rubric.stage はまだ存在しない stage（未着手ステージの先行ルーブリック）でも通る', () => {
    // ルーブリックは、そのステージ本体の JSON より先に用意してよい。
    const result = CurriculumSchema.safeParse({
      stages: [stage],
      rubrics: [{ ...rubric, stage: 's999' }],
    });
    expect(result.success).toBe(true);
  });

  it('rubric.stage が stage.id の形式に違反すると弾かれる', () => {
    const result = CurriculumSchema.safeParse({
      stages: [stage],
      rubrics: [{ ...rubric, stage: 'not-a-stage-id' }],
    });
    expect(result.success).toBe(false);
  });

  it('stage.id がカリキュラム全体で重複すると弾かれる', () => {
    const result = CurriculumSchema.safeParse({
      stages: [stage, { ...stage, order: 10 }],
      rubrics: [],
    });
    expect(result.success).toBe(false);
  });

  it('stage.order がカリキュラム全体で重複すると弾かれる', () => {
    const otherStage = {
      ...stage,
      id: 's10',
      units: [
        {
          id: 's10-u1',
          title: 'ユニット1',
          lessons: [minimalLesson('s10-u1-l1')],
        },
      ],
    };
    const result = CurriculumSchema.safeParse({
      stages: [stage, otherStage],
      rubrics: [],
    });
    expect(result.success).toBe(false);
  });

  it('lesson.id がステージを跨いで重複すると弾かれる', () => {
    const otherStage = {
      ...stage,
      id: 's10',
      order: 10,
      units: [
        {
          id: 's10-u1',
          title: 'ユニット1',
          lessons: [minimalLesson('s9-u1-l1')],
        },
      ],
    };
    const result = CurriculumSchema.safeParse({
      stages: [stage, otherStage],
      rubrics: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('選択式（optional）', () => {
  it('optional: true / false / 省略のどれも通る', () => {
    expect(LessonSchema.safeParse({ ...minimalLesson('s1-u1-l1'), optional: true }).success).toBe(true);
    expect(LessonSchema.safeParse({ ...minimalLesson('s1-u1-l1'), optional: false }).success).toBe(true);
    const r = LessonSchema.safeParse(minimalLesson('s1-u1-l1'));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.optional).toBeUndefined();
  });

  it('optional が真偽値でなければ弾かれる', () => {
    expect(LessonSchema.safeParse({ ...minimalLesson('s1-u1-l1'), optional: 'yes' }).success).toBe(false);
    expect(LessonSchema.safeParse({ ...minimalLesson('s1-u1-l1'), optional: 1 }).success).toBe(false);
  });
});

describe('trace / construct の counter', () => {
  const construct = {
    type: 'construct',
    instruction: '箱を描きましょう。',
    stages: [{ title: '箱', instruction: '箱を1つ描きます。' }],
  };

  it('trace に counter が付けられる', () => {
    const r = StepSchema.safeParse({ type: 'trace', template: 'cube-2pt', instruction: 'なぞりましょう。', count: 3, counter: 'boxes' });
    expect(r.success).toBe(true);
  });

  it('construct に counter と count が付けられる（count は省略可）', () => {
    expect(StepSchema.safeParse({ ...construct, counter: 'boxes', count: 5 }).success).toBe(true);
    expect(StepSchema.safeParse({ ...construct, counter: 'circles' }).success).toBe(true);
    expect(StepSchema.safeParse(construct).success).toBe(true);
  });

  it('未知の counter は弾かれる', () => {
    expect(StepSchema.safeParse({ type: 'trace', template: 't', instruction: 'x', counter: 'cubes' }).success).toBe(false);
    expect(StepSchema.safeParse({ ...construct, counter: 'box' }).success).toBe(false);
  });

  it('construct の count は正の整数だけ', () => {
    expect(StepSchema.safeParse({ ...construct, counter: 'boxes', count: 0 }).success).toBe(false);
    expect(StepSchema.safeParse({ ...construct, counter: 'boxes', count: 1.5 }).success).toBe(false);
    expect(StepSchema.safeParse({ ...construct, counter: 'boxes', count: '3' }).success).toBe(false);
  });
});

describe('筆圧プロファイルの正規化', () => {
  const pressure = (profile: unknown) => ({ type: 'drill', drill: 'pressure', count: 5, instruction: '線を引きましょう。', params: { profile } });

  it('別名は読み込み時に正式な値へそろう', () => {
    for (const [alias, canonical] of [
      ['increasing', 'ramp-up'],
      ['decreasing', 'ramp-down'],
      ['constant', 'flat'],
      ['ramp-up', 'ramp-up'],
    ] as const) {
      const r = StepSchema.parse(pressure(alias));
      expect(r.type === 'drill' && r.params?.['profile']).toBe(canonical);
    }
  });

  it('知らない値は弾かれる（筆圧ドリルのときだけ）', () => {
    expect(StepSchema.safeParse(pressure('zigzag')).success).toBe(false);
    expect(StepSchema.safeParse(pressure(3)).success).toBe(false);
    // 他のドリルの profile は見ない
    expect(StepSchema.safeParse({ type: 'drill', drill: 'line', count: 5, instruction: 'x', params: { profile: 'zigzag' } }).success).toBe(true);
    // profile 省略は通る（画面側で ramp-up）
    expect(StepSchema.safeParse({ type: 'drill', drill: 'pressure', count: 5, instruction: 'x' }).success).toBe(true);
  });

  it('normalizePressureProfile', () => {
    expect(normalizePressureProfile('increasing')).toBe('ramp-up');
    expect(normalizePressureProfile('flat')).toBe('flat');
    expect(normalizePressureProfile('nope')).toBeNull();
    expect(normalizePressureProfile(undefined)).toBeNull();
  });
});
