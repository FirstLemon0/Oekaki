/**
 * 入力部品: Segment / Toggle / Slider / Stepper / TextField
 */
import type { JSX } from 'preact';
import { Icon } from './Icon';

// ---------------------------------------------------------------------------
// Segment（単一選択）
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'md' | 'sm';
}

export function Segment<T extends string>({ options, value, onChange, label, size = 'md' }: SegmentProps<T>) {
  return (
    <div class={`segment segment--${size}`} role="radiogroup" aria-label={label}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            class={selected ? 'segment__item is-selected' : 'segment__item'}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class={checked ? 'toggle is-on' : 'toggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="toggle__knob" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onInput: (value: number) => void;
  label: string;
  width?: number;
}

export function Slider({ value, min = 0, max = 100, step = 1, onInput, label, width }: SliderProps) {
  const ratio = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      class="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      style={{ '--fill': `${ratio}%`, width: width ? `${width}px` : undefined } as JSX.CSSProperties}
      onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}
    />
  );
}

// ---------------------------------------------------------------------------
// Stepper（− N ＋）
// ---------------------------------------------------------------------------

export interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label: string;
}

export function Stepper({ value, min = 0, max = 99, onChange, label }: StepperProps) {
  return (
    <div class="stepper" role="group" aria-label={label}>
      <button
        type="button"
        class="stepper__btn"
        aria-label={`${label}を減らす`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Icon name="minus" size={20} />
      </button>
      <span class="stepper__value num" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        class="stepper__btn"
        aria-label={`${label}を増やす`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TextField（テキスト・マスク付き）
// ---------------------------------------------------------------------------

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  type?: 'text' | 'password' | 'time';
  placeholder?: string;
  width?: number;
  autoComplete?: string;
}

export function TextField({ value, onChange, label, type = 'text', placeholder, width, autoComplete = 'off' }: TextFieldProps) {
  return (
    <input
      class="field"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      autoComplete={autoComplete}
      spellcheck={false}
      style={width ? { width: `${width}px` } : undefined}
      onChange={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
    />
  );
}
