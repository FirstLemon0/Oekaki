/**
 * 描きかけの下書き（sessionStorage）。実機フィードバック: 戻る操作で描いた線が消えた。
 *
 * 描いている間は、線が変わるたび（1 秒まとめて）に getHistory() と紙の大きさを保存する。
 * 同じステップを開き直したとき、下書きがあれば「続きから／捨てる」を出して loadHistory で戻す。
 * 保存が済んだら（または捨てたら）消す。容量が足りないなどで保存できないときは静かに諦める。
 *
 * キー: `seichotsu.draft.<lessonId>.<stepIndex>`（自由お絵描きは `seichotsu.draft.free`）
 */
import type { StrokeHistory } from '@/canvas';
import { readStrokeHistory } from './lesson/stateBridge';

const PREFIX = 'seichotsu.draft.';

export interface Draft {
  history: StrokeHistory;
  /** 保存したときの紙の大きさ（CSS px）。開き直したときに大きさが違えば rescaleMap で合わせる */
  size: { width: number; height: number };
  savedAt: string;
}

/** 下書きのキー。lessonId が null（自由お絵描き）なら `free` */
export function draftKey(lessonId: string | null, stepIndex?: number | string): string {
  if (lessonId === null) return `${PREFIX}free`;
  return `${PREFIX}${lessonId}.${stepIndex ?? 0}`;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, history: StrokeHistory, size: { width: number; height: number }): void {
  const s = storage();
  if (!s) return;
  try {
    if (history.strokes.length === 0) {
      s.removeItem(key);
      return;
    }
    const body: Draft = {
      history: { strokes: history.strokes, styles: history.styles.map((st) => st ?? null) as StrokeHistory['styles'] },
      size: { width: size.width, height: size.height },
      savedAt: new Date().toISOString(),
    };
    s.setItem(key, JSON.stringify(body));
  } catch {
    // 容量不足など: 静かに諦める
  }
}

export function loadDraft(key: string): Draft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const history = readStrokeHistory({ history: o.history });
    const size = o.size as { width?: unknown; height?: unknown } | undefined;
    if (!history || !size || !(Number(size.width) > 0) || !(Number(size.height) > 0)) return null;
    return {
      history,
      size: { width: Number(size.width), height: Number(size.height) },
      savedAt: typeof o.savedAt === 'string' ? o.savedAt : '',
    };
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // 何もしない
  }
}
