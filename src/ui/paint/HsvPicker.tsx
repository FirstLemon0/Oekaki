/**
 * HSV ピッカー（自作）。上に彩度／明度の正方形、下に色相バー。どちらも Canvas で描く。
 * つまみは 48px の当たり判定（見た目は 22px の輪）。面のどこを押してもそこへ動き、そのままドラッグできる。
 *
 * - onInput: ドラッグ中（線の色をその場で変える）
 * - onCommit: 指を離したとき（直近の色に記憶する）
 * 無彩色（灰・黒）では色相が決まらないので、ピッカーが持っている色相を保つ（つまみが赤へ飛ばない）。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { hexToHsv, hsvToHex, type Hsv } from './color';

const SV_W = 264;
const SV_H = 148;
const HUE_H = 28;

function drawSv(canvas: HTMLCanvasElement, hue: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = hsvToHex({ h: hue, s: 1, v: 1 });
  ctx.fillRect(0, 0, w, h);
  const white = ctx.createLinearGradient(0, 0, w, 0);
  white.addColorStop(0, 'rgba(255,255,255,1)');
  white.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = white;
  ctx.fillRect(0, 0, w, h);
  const black = ctx.createLinearGradient(0, 0, 0, h);
  black.addColorStop(0, 'rgba(0,0,0,0)');
  black.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = black;
  ctx.fillRect(0, 0, w, h);
}

function drawHue(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, hsvToHex({ h: i * 60, s: 1, v: 1 }));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function useDrag(onMove: (fx: number, fy: number) => void, onEnd: () => void) {
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const active = useRef<number | null>(null);
  const at = (el: HTMLElement, e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0;
    moveRef.current(Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)));
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      active.current = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      at(el, e);
    },
    onPointerMove: (e: PointerEvent) => {
      if (active.current !== e.pointerId) return;
      at(e.currentTarget as HTMLElement, e);
    },
    onPointerUp: (e: PointerEvent) => {
      if (active.current !== e.pointerId) return;
      active.current = null;
      endRef.current();
    },
    onPointerCancel: (e: PointerEvent) => {
      if (active.current !== e.pointerId) return;
      active.current = null;
      endRef.current();
    },
  };
}

export function HsvPicker({
  color,
  onInput,
  onCommit,
}: {
  /** 今の色 `#rrggbb` */
  color: string;
  onInput: (hex: string) => void;
  onCommit: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color) ?? { h: 0, s: 0, v: 0 });
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);

  // 外から色が変わった（パレット・スポイト）: 同じ色でなければ読み直す（色相は保つ）
  useEffect(() => {
    if (hsvToHex(hsvRef.current) === color.toLowerCase()) return;
    const next = hexToHsv(color, hsvRef.current.h);
    if (next) setHsv(next);
  }, [color]);

  useEffect(() => {
    if (svRef.current) drawSv(svRef.current, hsv.h);
  }, [hsv.h]);
  useEffect(() => {
    if (hueRef.current) drawHue(hueRef.current);
  }, []);

  const set = (next: Hsv) => {
    setHsv(next);
    hsvRef.current = next;
    onInput(hsvToHex(next));
  };
  const commit = () => onCommit(hsvToHex(hsvRef.current));

  const svDrag = useDrag((fx, fy) => set({ h: hsvRef.current.h, s: fx, v: 1 - fy }), commit);
  const hueDrag = useDrag((fx) => set({ ...hsvRef.current, h: Math.min(359.9, fx * 360) }), commit);

  const hex = hsvToHex(hsv);
  const step = (e: KeyboardEvent, which: 'sv' | 'hue') => {
    const d = e.shiftKey ? 10 : 1;
    const cur = hsvRef.current;
    let next: Hsv | null = null;
    if (which === 'hue') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = { ...cur, h: Math.min(359.9, cur.h + d) };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = { ...cur, h: Math.max(0, cur.h - d) };
    } else {
      if (e.key === 'ArrowRight') next = { ...cur, s: Math.min(1, cur.s + d / 100) };
      if (e.key === 'ArrowLeft') next = { ...cur, s: Math.max(0, cur.s - d / 100) };
      if (e.key === 'ArrowUp') next = { ...cur, v: Math.min(1, cur.v + d / 100) };
      if (e.key === 'ArrowDown') next = { ...cur, v: Math.max(0, cur.v - d / 100) };
    }
    if (next) {
      e.preventDefault();
      set(next);
      commit();
    }
  };

  return (
    <div class="pt-hsv" data-testid="hsv-picker">
      <div
        class="pt-hsv__sv"
        role="slider"
        tabIndex={0}
        aria-label="彩度と明るさ"
        aria-valuetext={`彩度 ${Math.round(hsv.s * 100)}% 明るさ ${Math.round(hsv.v * 100)}%`}
        onKeyDown={(e) => step(e as unknown as KeyboardEvent, 'sv')}
        {...svDrag}
      >
        <canvas ref={svRef} width={SV_W} height={SV_H} />
        <span class="pt-hsv__knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} aria-hidden="true">
          <span class="pt-hsv__ring" style={{ background: hex }} />
        </span>
      </div>
      <div
        class="pt-hsv__hue"
        role="slider"
        tabIndex={0}
        aria-label="色相"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={(e) => step(e as unknown as KeyboardEvent, 'hue')}
        {...hueDrag}
      >
        <canvas ref={hueRef} width={SV_W} height={HUE_H} />
        <span class="pt-hsv__knob" style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%' }} aria-hidden="true">
          <span class="pt-hsv__ring" style={{ background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }} />
        </span>
      </div>
      <div class="pt-hsv__foot">
        <span class="pt-hsv__chip" style={{ background: hex }} aria-hidden="true" />
        <span class="num pt-hsv__hex">{hex}</span>
      </div>
    </div>
  );
}
