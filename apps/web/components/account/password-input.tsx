'use client';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { Field } from '../ui/field';

type Props = Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
};

/** A password field with a show/hide button, so people can check what they typed. */
export function PasswordInput({ label, error, hint, className = '', ref, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => (
        <div className="relative">
          <input
            {...p}
            {...rest}
            ref={ref}
            type={visible ? 'text' : 'password'}
            className={`${p.className} h-11 pr-12 ${className}`}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="press absolute top-1/2 right-1 grid size-9 -translate-y-1/2 pointer-coarse:size-10 place-items-center rounded-[2px] text-ink-3 hover:bg-surface-2 hover:text-ink"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            {visible ? <EyeSlash className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
      )}
    </Field>
  );
}
