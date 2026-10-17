import { type ComponentProps, type ReactNode, useId } from 'react';

const control =
  'w-full rounded-[var(--radius-field)] border bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3 ' +
  'transition-[border-color,box-shadow] duration-150 outline-none ' +
  'focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_22%,transparent)] ' +
  'disabled:bg-surface-2 disabled:text-ink-3';

type FieldProps = {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; className: string }) => ReactNode;
  optional?: boolean;
};

/** Label above, hint and error below; the input is linked to both for screen readers. */
export function Field({ label, error, hint, optional, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {optional && <span className="ml-1.5 font-semibold text-ink-3">optional</span>}
      </label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        className: `${control} ${error ? 'border-danger' : 'border-line'}`,
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<ComponentProps<'input'>, 'children'> & {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  optional?: boolean;
};

export function Input({ label, error, hint, optional, className = '', ...rest }: InputProps) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional}>
      {(p) => <input {...p} {...rest} className={`${p.className} h-11 ${className}`} />}
    </Field>
  );
}

type SelectProps = Omit<ComponentProps<'select'>, 'children'> & {
  label: string;
  error?: string | undefined;
  options: { value: string; label: string }[];
  placeholder?: string;
};

export function Select({ label, error, options, placeholder, className = '', ...rest }: SelectProps) {
  return (
    <Field label={label} error={error}>
      {(p) => (
        <select {...p} {...rest} className={`${p.className} h-11 appearance-none bg-[length:16px] pr-9 ${className}`}>
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** A form-level message (what went wrong overall), announced to screen readers. */
export function FormAlert({
  children,
  tone = 'danger',
}: {
  children: ReactNode;
  tone?: 'danger' | 'success' | 'info';
}) {
  const tones = {
    danger: 'border-danger/30 bg-danger-soft text-danger',
    success: 'border-brand/25 bg-brand-soft text-brand',
    info: 'border-line bg-surface-2 text-ink-2',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-[var(--radius-field)] border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
