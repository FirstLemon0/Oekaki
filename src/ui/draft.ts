/**
 * 描きかけの下書き（sessionStorage）。実機フィードバック: 戻る操作で描いた線が消えた。
 *
 * 描いている間は、線が変わるたび（1 秒まとめて）に getHistory() と紙の大きさを保存する。
 * フルツール（お絵描き v2）でレイヤー・塗りつぶしなどを使っているときは文書（getDocument()）だけを残し
 * （history は二重に持たない。読み出しで文書から作る）、開き直したときは loadDocument で戻す。
 * 同じステップを開き直したとき、下書きがあれば「続きから／捨てる」を出して loadHistory で戻す。
 * 保存が済んだら（または捨てたら）消す。
 *
 * 容量と描き味:
 * - 画面に触れている（ペン・指が下りている）あいだは文字列化しない。離れてから（requestIdleCallback）書く。
 * - 文字列が 1MB を超える下書きは保存を諦め、古い下書きも残さずに「大きすぎて残せなかった」印だけ置く
 *   （古い op を捨てて保存すると、戻したときに絵の一部だけがよみがえるため）。
 * - setItem が失敗したら（容量不足など）その下書きを消して静かに諦める（古い下書きを残さない）。
 *
 * キー: `seichotsu.draft.<lessonId>.<stepIndex>`（自由お絵描きは `seichotsu.draft.free`）
 */
import type { StrokeHistory } from '@/canvas';
import { readStrokeHistory } from './lesson/stateBridge';
import { readDrawingDoc } from './paint/canvasDoc';
import type { CanvasDocument } from './paint/types';

const PREFIX = 'seichotsu.draft.';

/** これより長い（文字数）下書きは保存しない。sessionStorage はおおむね 5MB（UTF-16 で 2.5M 文字）なので余裕を見る */
export const DRAFT_MAX_CHARS = 1_000_000;

export interface Draft {
  history: StrokeHistory;
  /** レイヤー等を使った絵の文書（あれば loadDocument で戻す） */
  doc?: CanvasDocument;
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

// ---------------------------------------------------------------------------
// 画面に触れているか（触れている間は文字列化しない）
// ---------------------------------------------------------------------------

const down = new Set<number>();
/** 触れているあいだ待たせている保存（キーごとに最新だけ） */
const pending = new Map<string, () => void>();
let tracking = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** 指が離れたと分からないまま（pointerup を取りこぼした等）でも、これ以上は待たない */
const MAX_WAIT_MS = 5000;

function trackPointers(): void {
  if (tracking || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  tracking = true;
  const opt = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', (e) => down.add(e.pointerId), opt);
  const up = (e: PointerEvent) => {
    down.delete(e.pointerId);
    if (down.size === 0 && pending.size > 0) whenIdle(() => {
      // まだ触れている（次の線を描き始めた）なら、次に離れたときまで待つ
      if (down.size === 0) flushPending();
    });
  };
  window.addEventListener('pointerup', up, opt);
  window.addEventListener('pointercancel', up, opt);
}

function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 1000 });
  else setTimeout(fn, 0);
}

function flushPending(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const jobs = [...pending.values()];
  pending.clear();
  jobs.forEach((f) => f());
}

/** 画面に触れているか（テスト用に公開） */
export function isPointerDown(): boolean {
  return down.size > 0;
}

// ---------------------------------------------------------------------------
// 保存・読み出し
// ---------------------------------------------------------------------------

/** 大きすぎて残せなかった印 */
interface TooLargeMark {
  tooLarge: true;
  savedAt: string;
}

function isTooLargeMark(o: unknown): o is TooLargeMark {
  return typeof o === 'object' && o !== null && (o as { tooLarge?: unknown }).tooLarge === true;
}

function writeDraft(
  key: string,
  history: StrokeHistory,
  size: { width: number; height: number },
  doc: CanvasDocument | null | undefined,
): void {
  const s = storage();
  if (!s) return;
  try {
    if (history.strokes.length === 0 && !(doc && doc.ops.length > 0)) {
      s.removeItem(key);
      return;
    }
    const savedAt = new Date().toISOString();
    // 文書があれば history は持たない（二重保存しない。読み出しで文書から作る）
    const body: Omit<Draft, 'history'> & { history?: Draft['history'] } = doc
      ? { doc, size: { width: size.width, height: size.height }, savedAt }
      : {
          history: { strokes: history.strokes, styles: history.styles.map((st) => st ?? null) as StrokeHistory['styles'] },
          size: { width: size.width, height: size.height },
          savedAt,
        };
    const json = JSON.stringify(body);
    if (json.length > DRAFT_MAX_CHARS) {
      const mark: TooLargeMark = { tooLarge: true, savedAt };
      s.setItem(key, JSON.stringify(mark));
      return;
    }
    s.setItem(key, json);
  } catch {
    // 容量不足など: 古い下書きを残さずに静かに諦める
    try {
      s.removeItem(key);
    } catch {
      // 何もしない
    }
  }
}

/**
 * 下書きを保存する。画面に触れていなければすぐ、触れていれば離れてから（アイドル時に）書く。
 * 待っている間に同じキーへ保存・clearDraft が来たら、古い保存は捨てる。
 */
export function saveDraft(
  key: string,
  history: StrokeHistory,
  size: { width: number; height: number },
  doc?: CanvasDocument | null,
): void {
  trackPointers();
  if (down.size > 0) {
    pending.set(key, () => writeDraft(key, history, size, doc));
    // pointerup を取りこぼしても、いつまでも書かないままにはしない
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        down.clear();
        whenIdle(flushPending);
      }, MAX_WAIT_MS);
    }
    return;
  }
  pending.delete(key);
  writeDraft(key, history, size, doc);
}

/** 下書きが大きすぎて残せなかったか（「続きから」を出せない理由を知らせる用） */
export function draftTooLarge(key: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const raw = s.getItem(key);
    return raw !== null && isTooLargeMark(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * 文書の中の、アクティブレイヤーの線（最後の全消去より後）。getHistory() と同じ考え方。
 * 文書だけの下書きを文書の無い画面で開いたときの互換用。
 */
export function historyFromDoc(doc: CanvasDocument): StrokeHistory {
  const out: StrokeHistory = { strokes: [], styles: [] };
  for (const op of doc.ops) {
    if (op.layer !== doc.active) continue;
    if (op.kind === 'layer-clear') {
      out.strokes = [];
      out.styles = [];
    } else if (op.kind === 'stroke') {
      out.strokes.push(op.points);
      out.styles.push(op.style);
    }
  }
  return out;
}

export function loadDraft(key: string): Draft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (isTooLargeMark(o)) return null;
    const doc = readDrawingDoc({ doc: o.doc });
    const history = readStrokeHistory({ history: o.history }) ?? (doc ? historyFromDoc(doc) : undefined);
    const size = o.size as { width?: unknown; height?: unknown } | undefined;
    if (!history || !size || !(Number(size.width) > 0) || !(Number(size.height) > 0)) return null;
    return {
      history,
      ...(doc ? { doc } : {}),
      size: { width: Number(size.width), height: Number(size.height) },
      savedAt: typeof o.savedAt === 'string' ? o.savedAt : '',
    };
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  pending.delete(key);
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // 何もしない
  }
}
