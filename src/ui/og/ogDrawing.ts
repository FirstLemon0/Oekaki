/**
 * 新しいお絵描きの絵（Drawing.meta.og）の見分け方。ギャラリーの詳細（入口の静的な木）から使うので、
 * 埋め込みのペイントの URL や API には触れない（scripts/check-bundle.mjs が入口の字面を確かめる）。
 */
import type { Drawing, DrawingKind, OgDrawingMeta } from '@/data/types';

/** 続きから描くときに引き継ぐ元の絵 */
export interface ContinueTarget {
  id: string;
  kind: DrawingKind;
  lessonId: string | null;
  createdAt: string;
  docId: string;
}

/** 続きから描く絵の情報（新しいお絵描きの絵でなければ null） */
export function continueTargetOf(d: Drawing | undefined): ContinueTarget | null {
  if (!d) return null;
  const og = (d.meta as { og?: Partial<OgDrawingMeta> } | null | undefined)?.og;
  if (!og || og.engine !== 'og' || typeof og.docId !== 'string') return null;
  return { id: d.id, kind: d.kind, lessonId: d.lessonId, createdAt: d.createdAt, docId: og.docId };
}
