/**
 * 重ねる部品: Modal / Sheet / Toast
 *
 * Modal: 幕＋カード。Esc・幕クリックで閉じる。role="dialog" aria-modal。
 * Sheet: 下からせり上がるシート（240ms、上角 20、背景は暗くしない指定は scrim=false）。
 * Modal の出現は stPop（.35s）。
 * Toast: 画面下中央に短く出す。キャンバス画面では出さない（呼び出し側の責務）。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon } from './Icon';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

/** 開いたときにダイアログ内へフォーカスを移し、閉じたら元へ戻す。 */
function useFocusTrapLite(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? el)?.focus();
    return () => prev?.focus?.();
  }, [open]);
  return ref;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  width?: number;
}

export function Modal({ open, onClose, title, children, actions, width = 480 }: ModalProps) {
  const titleId = useId();
  useEscape(open, onClose);
  const ref = useFocusTrapLite(open);
  if (!open) return null;
  return (
    <div class="scrim" onClick={onClose}>
      <div
        ref={ref}
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} class="modal__title">
          {title}
        </h2>
        {children && <div class="modal__body">{children}</div>}
        {actions && <div class="modal__actions">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ComponentChildren;
  /** 幕を出すか（キャンバス上の採点シートなどは false） */
  scrim?: boolean;
}

export function Sheet({ open, onClose, title, children, scrim = true }: SheetProps) {
  const titleId = useId();
  useEscape(open, onClose);
  const ref = useFocusTrapLite(open);
  if (!open) return null;
  const sheet = (
    <div
      ref={ref}
      class="sheet"
      role="dialog"
      aria-modal={scrim ? 'true' : undefined}
      aria-labelledby={title ? titleId : undefined}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="sheet__grip" aria-hidden="true" />
      {title && (
        <h2 id={titleId} class="sheet__title">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
  return scrim ? (
    <div class="scrim scrim--sheet" onClick={onClose}>
      {sheet}
    </div>
  ) : (
    <div class="sheet-host">{sheet}</div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface ToastState {
  id: number;
  text: string;
  /** default = 先頭にチェック、info = アイコンなし、danger = 警告 */
  tone: 'default' | 'info' | 'danger';
}

export const toastSignal = signal<ToastState | null>(null);
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, tone: ToastState['tone'] = 'default', ms = 2600): void {
  toastSeq += 1;
  toastSignal.value = { id: toastSeq, text, tone };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastSignal.value = null;
  }, ms);
}

export function ToastHost() {
  const t = toastSignal.value;
  return (
    <div class="toast-host" aria-live="polite" role="status">
      {t && (
        <div key={t.id} class={t.tone === 'danger' ? 'toast toast--danger' : 'toast'}>
          {t.tone === 'default' && <Icon name="check" size={18} strokeWidth={2.5} class="toast__icon" />}
          <span>{t.text}</span>
        </div>
      )}
    </div>
  );
}
