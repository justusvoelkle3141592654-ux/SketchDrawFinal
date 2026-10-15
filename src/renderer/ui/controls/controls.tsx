// Small reusable controls with accessible names, tooltips and visible focus.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export function IconButton(props: {
  icon: IconName;
  label: string;
  tip?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
  testId?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${props.pressed ? 'is-on' : ''} ${props.className ?? ''}`}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      data-tip={props.tip ?? props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      data-testid={props.testId}
    >
      <Icon name={props.icon} size={props.size ?? 18} />
    </button>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'danger' | 'default' | 'ghost';
  disabled?: boolean;
  title?: string;
  autoFocus?: boolean;
  testId?: string;
  icon?: IconName;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`btn btn-${props.kind ?? 'default'}`}
      onClick={props.onClick}
      disabled={props.disabled}
      data-tip={props.title}
      autoFocus={props.autoFocus}
      data-testid={props.testId}
    >
      {props.icon ? <Icon name={props.icon} size={16} /> : null}
      <span>{props.children}</span>
    </button>
  );
}

const fmt = (v: number, decimals: number) =>
  Number.isInteger(v) && decimals === 0 ? String(v) : v.toFixed(decimals);

/**
 * Slider with numeric entry. `onChange` fires continuously; `onCommit` once when interaction ends.
 * Values are shown in `display` units (e.g. % = value × 100).
 */
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  unit?: string;
  displayScale?: number;
  decimals?: number;
  defaultValue?: number;
  hint?: string;
  disabled?: boolean;
  /** Non-linear mapping for large ranges (e.g. brush size). */
  curve?: 'linear' | 'pow';
  testId?: string;
}) {
  const id = useId();
  const scale = props.displayScale ?? 1;
  const decimals = props.decimals ?? 0;
  const [text, setText] = useState(fmt(props.value * scale, decimals));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(fmt(props.value * scale, decimals));
  }, [props.value, scale, decimals]);
  const pow = props.curve === 'pow';
  const toPos = (v: number) =>
    pow
      ? Math.pow((v - props.min) / (props.max - props.min), 1 / 2.4)
      : (v - props.min) / (props.max - props.min);
  const fromPos = (t: number) =>
    pow ? props.min + Math.pow(t, 2.4) * (props.max - props.min) : props.min + t * (props.max - props.min);
  const clamp = (v: number) => Math.min(props.max, Math.max(props.min, v));
  const roundStep = (v: number) => {
    const st = props.step ?? (props.max - props.min) / 1000;
    return Math.round(v / st) * st;
  };
  const commitText = () => {
    editing.current = false;
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) {
      setText(fmt(props.value * scale, decimals));
      return;
    }
    const v = clamp(n / scale);
    props.onChange(v);
    props.onCommit?.(v);
  };
  return (
    <div className={`slider ${props.disabled ? 'is-disabled' : ''}`} data-tip={props.hint}>
      <label htmlFor={id} className="slider-label">
        {props.label}
      </label>
      <input
        id={id}
        className="slider-range"
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(toPos(clamp(props.value)) * 1000)}
        disabled={props.disabled}
        aria-valuetext={`${fmt(props.value * scale, decimals)}${props.unit ?? ''}`}
        onChange={(e) => props.onChange(clamp(roundStep(fromPos(Number(e.target.value) / 1000))))}
        onPointerUp={() => props.onCommit?.(props.value)}
        onKeyUp={() => props.onCommit?.(props.value)}
        data-testid={props.testId}
        style={{ ['--pos' as string]: `${toPos(clamp(props.value)) * 100}%` }}
      />
      <span className="slider-num">
        <input
          aria-label={`${props.label} value`}
          value={text}
          disabled={props.disabled}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              editing.current = false;
              setText(fmt(props.value * scale, decimals));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {props.unit ? <span className="slider-unit">{props.unit}</span> : null}
      </span>
      {props.defaultValue !== undefined ? (
        <button
          type="button"
          className="slider-reset"
          aria-label={`Reset ${props.label}`}
          data-tip={`Reset to ${fmt(props.defaultValue * scale, decimals)}${props.unit ?? ''}`}
          disabled={props.disabled || Math.abs(props.value - props.defaultValue) < 1e-9}
          onClick={() => {
            props.onChange(props.defaultValue!);
            props.onCommit?.(props.defaultValue!);
          }}
        >
          <Icon name="reset" size={13} />
        </button>
      ) : null}
    </div>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="toggle-row" data-tip={props.hint}>
      <label htmlFor={id}>{props.label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={`switch ${props.checked ? 'is-on' : ''}`}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
        data-testid={props.testId}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export function Select<T extends string>(props: {
  label?: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
  compact?: boolean;
  testId?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`select-row ${props.compact ? 'is-compact' : ''}`} data-tip={props.hint}>
      {props.label ? <label htmlFor={id}>{props.label}</label> : null}
      <select
        id={id}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onChange(e.target.value as T)}
        data-testid={props.testId}
        disabled={props.disabled}
      >
        {props.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { id: T; label: string; icon?: IconName; tip?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={props.value === o.id}
          className={props.value === o.id ? 'is-on' : ''}
          onClick={() => props.onChange(o.id)}
          data-tip={o.tip ?? o.label}
          aria-label={o.label}
        >
          {o.icon ? <Icon name={o.icon} size={16} /> : o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  testId?: string;
  integer?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    let n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return setText(String(props.value));
    if (props.integer) n = Math.round(n);
    if (props.min !== undefined) n = Math.max(props.min, n);
    if (props.max !== undefined) n = Math.min(props.max, n);
    setText(String(n));
    props.onChange(n);
  };
  return (
    <div className="number-field">
      <label htmlFor={id}>{props.label}</label>
      <span className="number-input">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          data-testid={props.testId}
        />
        {props.unit ? <span className="unit">{props.unit}</span> : null}
      </span>
    </div>
  );
}

export function Section(props: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{props.title}</h3>
        {props.actions}
      </header>
      <div className="section-body">{props.children}</div>
    </section>
  );
}
