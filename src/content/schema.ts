/**
 * 教材スキーマ（zod）
 *
 * 正典: DESIGN.md §4（カリキュラム）／§4.2（レッスン型）
 *
 * 階層: Curriculum { stages[], rubrics[] }
 *         Stage { units[] }
 *           Unit { lessons[] }
 *             Lesson { steps[] }
 *
 * ID の規約:
 *   stage:  s0, s1, s1_5, s2, ...
 *   unit:   <stageId>-u<番号>            例: s1-u3
 *   lesson: <unitId>-l<番号>             例: s1-u3-l5
 * これらは refine / superRefine で「形式」「一意性」「親への所属」を検証する。
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* ID 正規表現                                                          */
/* ------------------------------------------------------------------ */

const STAGE_ID_RE = /^s(?:0|[1-9]\d*)(?:_5)?$/;
const UNIT_ID_RE = /^s(?:0|[1-9]\d*)(?:_5)?-u[1-9]\d*$/;
const LESSON_ID_RE = /^s(?:0|[1-9]\d*)(?:_5)?-u[1-9]\d*-l[1-9]\d*$/;
const RUBRIC_ID_RE = /^[a-z][a-z0-9_-]*$/;

/* ------------------------------------------------------------------ */
/* Step（判別共用体）                                                    */
/* ------------------------------------------------------------------ */

const ReadStepSchema = z.object({
  type: z.literal('read'),
  title: z.string().min(1),
  /** 段落は空行（\n\n）区切り */
  body: z.string().min(1),
  /** content/figures/<id>.svg の id */
  figure: z.string().min(1).optional(),
});

const DrillStepSchema = z.object({
  type: z.literal('drill'),
  drill: z.enum(['line', 'curve', 'circle', 'ellipse', 'pressure', 'hatching']),
  count: z.number().int().positive(),
  instruction: z.string().min(1),
  /** 例: ellipse の degree, axisAngleDeg */
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  /** 累計カウンターに加算する種別 */
  counter: z.enum(['lines', 'ellipses', 'circles', 'boxes']).optional(),
});

const TraceStepSchema = z.object({
  type: z.literal('trace'),
  /** content/templates/<id>.json の id */
  template: z.string().min(1),
  instruction: z.string().min(1),
  count: z.number().int().positive().optional(),
});

const CopyStepSchema = z.object({
  type: z.literal('copy'),
  reference: z.enum(['builtin', 'user']),
  refId: z.string().min(1).optional(),
  instruction: z.string().min(1),
});

const ConstructStageItemSchema = z.object({
  title: z.string().min(1),
  figure: z.string().min(1).optional(),
  instruction: z.string().min(1),
});

const ConstructStepSchema = z.object({
  type: z.literal('construct'),
  instruction: z.string().min(1),
  stages: z.array(ConstructStageItemSchema).min(1),
});

const GestureStepSchema = z.object({
  type: z.literal('gesture'),
  seconds: z.literal([30, 60, 90]),
  count: z.number().int().positive(),
  source: z.enum(['mannequin', 'user']),
  instruction: z.string().min(1),
});

const QuizOptionSchema = z.object({
  text: z.string().min(1),
  figure: z.string().min(1).optional(),
});

const QuizStepSchema = z
  .object({
    type: z.literal('quiz'),
    question: z.string().min(1),
    options: z.array(QuizOptionSchema).min(2),
    answer: z.number().int().nonnegative(),
    explain: z.string().min(1),
  })
  .superRefine((step, ctx) => {
    if (step.answer >= step.options.length) {
      ctx.addIssue({
        code: 'custom',
        message: `quiz.answer (${step.answer}) が options の範囲外です（options.length=${step.options.length}）`,
        path: ['answer'],
      });
    }
  });

const MoshaStepSchema = z.object({
  type: z.literal('mosha'),
  instruction: z.string().min(1),
});

const CritiqueStepSchema = z.object({
  type: z.literal('critique'),
  /** Rubric id */
  rubric: z.string().min(1),
  mode: z.enum(['canvas', 'import']),
  instruction: z.string().min(1),
});

const SubmitStepSchema = z.object({
  type: z.literal('submit'),
  /** Rubric id */
  rubric: z.string().min(1),
  instruction: z.string().min(1),
});

const FreeStepSchema = z.object({
  type: z.literal('free'),
  instruction: z.string().min(1).optional(),
});

export const StepSchema = z.discriminatedUnion('type', [
  ReadStepSchema,
  DrillStepSchema,
  TraceStepSchema,
  CopyStepSchema,
  ConstructStepSchema,
  GestureStepSchema,
  QuizStepSchema,
  MoshaStepSchema,
  CritiqueStepSchema,
  SubmitStepSchema,
  FreeStepSchema,
]);

/* ------------------------------------------------------------------ */
/* Lesson / Unit / Stage                                               */
/* ------------------------------------------------------------------ */

export const LessonSchema = z.object({
  id: z.string().regex(LESSON_ID_RE, 'lesson.id は <unitId>-l<番号>（例: s1-u3-l5）の形式にしてください'),
  title: z.string().min(1),
  minutes: z.number().int().positive(),
  kind: z.enum(['lesson', 'checkpoint', 'graduation']),
  /** ホームの「今日のカード」に出す1〜2文 */
  summary: z.string().min(1),
  steps: z.array(StepSchema).min(1),
});

export const UnitSchema = z
  .object({
    id: z.string().regex(UNIT_ID_RE, 'unit.id は <stageId>-u<番号>（例: s1-u3）の形式にしてください'),
    title: z.string().min(1),
    lessons: z.array(LessonSchema).min(1),
  })
  .superRefine((unit, ctx) => {
    const seenLessonIds = new Set<string>();
    unit.lessons.forEach((lesson, li) => {
      if (!lesson.id.startsWith(`${unit.id}-l`)) {
        ctx.addIssue({
          code: 'custom',
          message: `lesson.id "${lesson.id}" は unit "${unit.id}" の配下（${unit.id}-lN）である必要があります`,
          path: ['lessons', li, 'id'],
        });
      }
      if (seenLessonIds.has(lesson.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `lesson.id "${lesson.id}" が unit "${unit.id}" 内で重複しています`,
          path: ['lessons', li, 'id'],
        });
      }
      seenLessonIds.add(lesson.id);
    });
  });

export const StageSchema = z
  .object({
    id: z.string().regex(STAGE_ID_RE, 'stage.id は s0, s1, s1_5, s2 ... の形式にしてください'),
    /** 0, 1, 1.5, 2 … */
    order: z.number(),
    title: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    weeks: z.number().positive(),
    units: z.array(UnitSchema).min(1),
  })
  .superRefine((stage, ctx) => {
    const seenUnitIds = new Set<string>();
    const seenLessonIds = new Set<string>();
    stage.units.forEach((unit, ui) => {
      if (!unit.id.startsWith(`${stage.id}-u`)) {
        ctx.addIssue({
          code: 'custom',
          message: `unit.id "${unit.id}" は stage "${stage.id}" の配下（${stage.id}-uN）である必要があります`,
          path: ['units', ui, 'id'],
        });
      }
      if (seenUnitIds.has(unit.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `unit.id "${unit.id}" が stage "${stage.id}" 内で重複しています`,
          path: ['units', ui, 'id'],
        });
      }
      seenUnitIds.add(unit.id);

      unit.lessons.forEach((lesson, li) => {
        if (seenLessonIds.has(lesson.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `lesson.id "${lesson.id}" が stage "${stage.id}" 内で重複しています`,
            path: ['units', ui, 'lessons', li, 'id'],
          });
        }
        seenLessonIds.add(lesson.id);
      });
    });
  });

/* ------------------------------------------------------------------ */
/* Rubric                                                              */
/* ------------------------------------------------------------------ */

export const RubricSchema = z.object({
  id: z.string().regex(RUBRIC_ID_RE, 'rubric.id は英小文字で始まる識別子（例: s1-graduation）にしてください'),
  /** 対応する stage.id */
  stage: z.string().regex(STAGE_ID_RE, 'rubric.stage は stage.id の形式にしてください'),
  title: z.string().min(1),
  /** B の AI に渡す観点 */
  points: z.array(z.string().min(1)).min(1),
  /** 「次の1つ」を決めるときの重み付けの説明 */
  focus: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Curriculum（全体）                                                   */
/* ------------------------------------------------------------------ */

export const CurriculumSchema = z
  .object({
    stages: z.array(StageSchema).min(1),
    rubrics: z.array(RubricSchema),
  })
  .superRefine((curriculum, ctx) => {
    const stageIds = new Set<string>();
    const stageOrderOwners = new Map<number, string>();
    const lessonIds = new Set<string>();

    curriculum.stages.forEach((stage, si) => {
      if (stageIds.has(stage.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `stage.id "${stage.id}" がカリキュラム内で重複しています`,
          path: ['stages', si, 'id'],
        });
      }
      stageIds.add(stage.id);

      const owner = stageOrderOwners.get(stage.order);
      if (owner !== undefined && owner !== stage.id) {
        ctx.addIssue({
          code: 'custom',
          message: `stage.order ${stage.order} が stage "${owner}" と重複しています`,
          path: ['stages', si, 'order'],
        });
      } else {
        stageOrderOwners.set(stage.order, stage.id);
      }

      stage.units.forEach((unit, ui) => {
        unit.lessons.forEach((lesson, li) => {
          if (lessonIds.has(lesson.id)) {
            ctx.addIssue({
              code: 'custom',
              message: `lesson.id "${lesson.id}" がカリキュラム全体で重複しています`,
              path: ['stages', si, 'units', ui, 'lessons', li, 'id'],
            });
          }
          lessonIds.add(lesson.id);
        });
      });
    });

    // 注意: rubric.stage が「実在する stage」かどうかはここでは検証しない。
    // ルーブリックは、そのステージの教材本体（Stage JSON）より先に用意して
    // よいため（例: s1 のステージ本体はまだ無いが s1 の卒業課題ルーブリックは
    // ある、という状態を許す）。形式は RubricSchema 側で STAGE_ID_RE により検証済み。
    const rubricIds = new Set<string>();
    curriculum.rubrics.forEach((rubric, ri) => {
      if (rubricIds.has(rubric.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `rubric.id "${rubric.id}" が重複しています`,
          path: ['rubrics', ri, 'id'],
        });
      }
      rubricIds.add(rubric.id);
    });
  });

/* ------------------------------------------------------------------ */
/* 型エクスポート                                                        */
/* ------------------------------------------------------------------ */

export type Step = z.infer<typeof StepSchema>;
export type ReadStep = z.infer<typeof ReadStepSchema>;
export type DrillStep = z.infer<typeof DrillStepSchema>;
export type TraceStep = z.infer<typeof TraceStepSchema>;
export type CopyStep = z.infer<typeof CopyStepSchema>;
export type ConstructStep = z.infer<typeof ConstructStepSchema>;
export type GestureStep = z.infer<typeof GestureStepSchema>;
export type QuizStep = z.infer<typeof QuizStepSchema>;
export type MoshaStep = z.infer<typeof MoshaStepSchema>;
export type CritiqueStep = z.infer<typeof CritiqueStepSchema>;
export type SubmitStep = z.infer<typeof SubmitStepSchema>;
export type FreeStep = z.infer<typeof FreeStepSchema>;

export type Lesson = z.infer<typeof LessonSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type Curriculum = z.infer<typeof CurriculumSchema>;
