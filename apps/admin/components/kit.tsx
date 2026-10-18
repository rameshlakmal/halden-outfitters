// Small building blocks. Shapes: cards 14px, fields 10px; buttons, nav items and tags are pills.
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const BUTTON = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-accent-ink hover:opacity-90',
} as const;

const buttonClass = (variant: keyof typeof BUTTON, size: 'md' | 'sm') =>
  `inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${
    size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]'
  } ${BUTTON[variant]}`;

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON; size?: 'md' | 'sm' }) {
  return <button type="button" className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof BUTTON; size?: 'md' | 'sm' }) {
  return <Link className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function Card({ className = '', ...props }: ComponentProps<'section'>) {
  return <section className={`rounded-[var(--radius-card)] border border-line bg-surface ${className}`} {...props} />;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-4">
      <h2 className="text-sm font-semibold">{children}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

const TAG = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-brand-soft text-accent-text',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-surface-2 text-success',
} as const;

export function Tag({ tone = 'neutral', children }: { tone?: keyof typeof TAG; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TAG[tone]}`}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-[var(--radius-field)] bg-surface-2 ${className}`} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-1 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-[52ch] text-sm text-ink-3">{children}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="grid gap-1">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// The mountains logo from icon.svg, split so the loader can draw the ridge and then raise the sun.
const RIDGE =
  'M254.88,195.92l-54.56-92.08A15.87,15.87,0,0,0,186.55,96h0a15.85,15.85,0,0,0-13.76,7.84l-15.64,26.39a4,4,0,0,0,0,4.07l26.8,45.47a8.13,8.13,0,0,1-1.89,10.55,8,8,0,0,1-11.8-2.26L101.79,71.88a16,16,0,0,0-27.58,0L1.11,195.94a8,8,0,0,0,1,9.52A8.23,8.23,0,0,0,8.23,208H247.77a8.29,8.29,0,0,0,6.09-2.55A8,8,0,0,0,254.88,195.92Z';

/** The loading screen: the logo's ridge draws itself, fills, and the sun pops in (CSS in globals.css). */
export function BrandLoader({ label = 'Loading', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`grid place-items-center ${className}`}>
      <svg viewBox="0 -8 256 256" className="brand-loader size-14" aria-hidden="true">
        <path className="ridge" pathLength={1} d={RIDGE} />
        <path className="peaks" d={`${RIDGE}M64.43,120,88,80l23.57,40Z`} />
        <circle className="sun" cx="164" cy="52" r="24" />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
