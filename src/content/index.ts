/**
 * 教材ローダー
 *
 * content/stages/*.json と content/rubrics/*.json は明示 import する（vitest の
 * node 環境でも動くように import.meta.glob は使わない）。新しい教材ファイルを
 * 追加したら、下の RAW_STAGES / RAW_RUBRICS に追記すること。
 */
import stageS0 from '@content/stages/s0.json';
import rubricS1 from '@content/rubrics/s1.json';

import { CurriculumSchema, type Curriculum, type Lesson, type Stage, type Unit } from './schema';

const RAW_STAGES: unknown[] = [stageS0];
const RAW_RUBRICS: unknown[] = [rubricS1];

/**
 * 起動時に全教材データを zod で検証して返す。
 * 検証に失敗した場合は、どの項目が原因かが分かるエラーメッセージで throw する。
 */
export function loadCurriculum(): Curriculum {
  const result = CurriculumSchema.safeParse({
    stages: RAW_STAGES,
    rubrics: RAW_RUBRICS,
  });

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`教材データの検証に失敗しました:\n${details}`);
  }

  return result.data;
}

/** パス上の1レッスンぶんのノード */
export interface PathNode {
  stage: Stage;
  unit: Unit;
  lesson: Lesson;
  /** flattenPath 内での通し番号（0始まり） */
  index: number;
}

/**
 * ステージ順→ユニット順→レッスン順で並べた、一本道のパス配列を作る。
 * 並び順は各配列の記述順（stage は order の昇順）。
 */
export function flattenPath(curriculum: Curriculum): PathNode[] {
  const sortedStages = [...curriculum.stages].sort((a, b) => a.order - b.order);

  const nodes: PathNode[] = [];
  let index = 0;
  for (const stage of sortedStages) {
    for (const unit of stage.units) {
      for (const lesson of unit.lessons) {
        nodes.push({ stage, unit, lesson, index });
        index += 1;
      }
    }
  }
  return nodes;
}

/**
 * パス上で、まだ完了していない最初のレッスンを返す。
 * 全て完了している場合は undefined。
 */
export function nextLesson(path: PathNode[], completedIds: Set<string>): PathNode | undefined {
  return path.find((node) => !completedIds.has(node.lesson.id));
}

/** 指定ステージの完了数と総数 */
export interface StageProgress {
  done: number;
  total: number;
}

export function stageProgress(path: PathNode[], completedIds: Set<string>, stageId: string): StageProgress {
  const nodesInStage = path.filter((node) => node.stage.id === stageId);
  const done = nodesInStage.filter((node) => completedIds.has(node.lesson.id)).length;
  return { done, total: nodesInStage.length };
}

export type { Curriculum, Stage, Unit, Lesson, Step, Rubric } from './schema';
