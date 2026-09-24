/** 表示用の小さな整形関数 */
import type { DrawingKind } from '@/data/types';
import type { Lesson, Step } from '@/content';

export const nf = new Intl.NumberFormat('ja-JP');

export function formatStageOrder(order: number): string {
  return Number.isInteger(order) ? String(order) : order.toFixed(1);
}

/** s1-u3-l5 → 5 */
export function lessonNumber(lessonId: string): number {
  const m = /-l(\d+)$/.exec(lessonId);
  return m ? Number(m[1]) : 0;
}

/** s1-u3 → 3 */
export function unitNumber(unitId: string): number {
  const m = /-u(\d+)$/.exec(unitId);
  return m ? Number(m[1]) : 0;
}

const STEP_LABEL: Record<Step['type'], string> = {
  read: '説明',
  drill: 'ドリル',
  trace: 'なぞり',
  copy: '見て描く',
  construct: '構築',
  gesture: 'ジェスチャー',
  quiz: 'クイズ',
  mosha: '模写',
  critique: '批評',
  submit: '提出',
  free: '自由',
};

/** 「ドリル 2 ＋ 説明 1」 */
export function stepComposition(lesson: Lesson): string {
  const counts = new Map<Step['type'], number>();
  for (const s of lesson.steps) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  const order = [...counts.entries()].sort((a, b) => {
    // ドリルを先頭に、あとは多い順
    if (a[0] === 'drill') return -1;
    if (b[0] === 'drill') return 1;
    return b[1] - a[1];
  });
  return order.map(([t, n]) => `${STEP_LABEL[t]} ${n}`).join(' ＋ ');
}

const DRILL_LABEL: Record<string, { name: string; unit: string }> = {
  line: { name: '直線ドリル', unit: '本' },
  curve: { name: '曲線ドリル', unit: '本' },
  circle: { name: '円ドリル', unit: '個' },
  ellipse: { name: '楕円ドリル', unit: '個' },
  pressure: { name: '筆圧ドリル', unit: '本' },
  hatching: { name: 'ハッチング', unit: '本' },
};

export function drillName(drillType: string): string {
  return DRILL_LABEL[drillType]?.name.replace('ドリル', '') ?? drillType;
}

/** 「楕円ドリル 20 個」。ドリルが無ければステップ構成 */
export function lessonHeadline(lesson: Lesson): string {
  const drill = lesson.steps.find((s) => s.type === 'drill');
  if (drill && drill.type === 'drill') {
    const d = DRILL_LABEL[drill.drill];
    if (d) return `${d.name} ${drill.count} ${d.unit}`;
  }
  return stepComposition(lesson);
}

export const KIND_LABEL: Record<DrawingKind, string> = {
  drill: 'ドリル',
  lesson: 'レッスン',
  free: '自由',
  before: 'Before',
  after: 'After',
  submit: '卒業課題',
};

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function formatMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function yyyymmdd(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
