import { CircleNotch } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'brand' | 'outline' | 'ghost' | 'danger' | 'inverse';
type Size = 'sm' | 'md' | 'lg';

const base =
  'press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[2px] font-bold uppercase tracking-[0.06em] select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2';

const variants: Record<Variant, string> = {
  // Cobalt is the one accent: primary actions only. Its text colour passes AA in both themes.
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-[inset_0_-1px_0_oklch(0_0_0/0.08)]',
  brand: 'bg-brand text-brand-ink hover:opacity-92',
  outline: 'border border-line-strong bg-surface text-ink hover:border-ink-3 hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border border-danger/40 text-danger hover:bg-danger-soft',
  // On photos: a light outline that fills in on hover.
  inverse:
    'border border-[oklch(0.97_0_0)] text-[oklch(0.97_0_0)] hover:bg-[oklch(0.97_0_0)] hover:text-[oklch(0.16_0_0)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-[12px] pointer-coarse:h-11',
  md: 'h-11 px-5 text-[13px]',
  lg: 'h-13 px-7 text-[14px]',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra = '') =>
  `${base} ${variants[variant]} ${sizes[size]} ${extra}`;

type ButtonProps = ComponentProps<'button'> & { variant?: Variant; size?: Size; busy?: boolean; icon?: ReactNode };

export function Button({ variant, size, busy, icon, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size };

export function LinkButton({ variant, size, className = '', ...rest }: LinkButtonProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <CircleNotch weight="bold" className={`${className} animate-spin`} aria-hidden="true" />;
}
