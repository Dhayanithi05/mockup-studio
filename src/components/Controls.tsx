import { useId, type ReactNode } from 'react';
import { beginHistoryGroup, endHistoryGroup } from '../state/store';
export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="property-section">
      <div className="section-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: (string | [string, string])[];
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select aria-label={label} id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const [v, t] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={v} value={v}>
              {t}
            </option>
          );
        })}
      </select>
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="number-input">
        <input
          aria-label={label}
          id={id}
          type="number"
          onFocus={beginHistoryGroup}
          onBlur={endHistoryGroup}
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(3))}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
  display,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  display?: string;
}) {
  const id = useId();
  return (
    <label className="slider-field" htmlFor={id}>
      <span>
        {label}
        <b>{display || `${Number(value.toFixed(1))}${suffix}`}</b>
      </span>
      <input
        aria-label={label}
        id={id}
        type="range"
        onPointerDown={beginHistoryGroup}
        onPointerUp={endHistoryGroup}
        onPointerCancel={endHistoryGroup}
        onKeyDown={(e) => {
          if (!e.repeat) beginHistoryGroup();
        }}
        onKeyUp={endHistoryGroup}
        onBlur={endHistoryGroup}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
