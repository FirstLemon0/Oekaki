/**
 * 教材ローダー
 *
 * content/stages/*.json、content/rubrics/*.json、content/templates/*.json を
 * import.meta.glob で自動登録する（Vite / vitest の両方で動く）。
 * 教材ファイルを追加したら、置くだけで読み込まれる。登録の追記は不要。
 */
import type { Drawing } from '@/scoring/types';
import { CurriculumSchema, type Curriculum, type Lesson, type Stage, type Unit } from './schema';

const stageModules = import.meta.glob('../../content/stages/*.json', { eager: true, import: 'default' });
const rubricModules = import.meta.glob('../../content/rubrics/*.json', { eager: true, import: 'default' });
const templateModules = import.meta.glob('../../content/templates/*.json', { eager: true, import: 'default' });

/** ファイル名順で安定させる（検証エラーの位置が実行ごとに変わらないように） */
function sortedValues(mods: Record<string, unknown>): unknown[] {
  return Object.keys(mods)
    .sort()
    .map((k) => mods[k]);
}

const RAW_STAGES: unknown[] = sortedValues(stageModules);
const RAW_RUBRICS: unknown[] = sortedValues(rubricModules);

/**
 * なぞりテンプレート（trace step の template id → Drawing）。
 * content/templates/<id>.json。x,y は 0..1 正規化。生成元: content/templates/_gen/gen.mjs
 */
const RAW_TEMPLATES: Record<string, Drawing> = Object.fromEntries(
  Object.entries(templateModules).map(([path, mod]) => {
    const id = path.replace(/^.*\//, '').replace(/\.json$/, '');
    return [id, mod as Drawing];
  }),
);

/** なぞりテンプレートを id で取得する。未登録なら undefined。 */
export function getTemplate(id: string): Drawing | undefined {
  return Object.prototype.hasOwnProperty.call(RAW_TEMPLATES, id) ? RAW_TEMPLATES[id] : undefined;
}

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
