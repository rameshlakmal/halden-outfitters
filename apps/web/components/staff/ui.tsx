'use client';
// Building blocks for the staff console: dense tables, tabs, states, a dialog. A work tool: tight spacing,
// motion only as feedback, every state (loading, empty, error) shown in place.
import { WarningCircle, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useEffect, useRef } from 'react';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-3">
      <div className="grid gap-1">
        <h1 className="text-[clamp(28px,4vw,40px)]">{title}</h1>
        {sub && <p className="text-[13px] text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Scrolls sideways inside itself on narrow screens, so the page never does. */
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="max-w-full overflow-x-auto rounded-[2px] border border-line-strong"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="w-full min-w-[640px] border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-[1] border-b border-line-strong bg-surface-2 px-3 py-2 text-left text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-ink-2 uppercase ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-line px-3 py-2 align-middle ${className}`}>{children}</td>;
}

export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <Td key={c}>
              <Skeleton className={`h-4 ${c === 0 ? 'w-16' : 'w-full max-w-40'}`} />
            </Td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-10 text-center text-[14px] text-ink-2">
        {children}
      </td>
    </tr>
  );
}

export function ErrorRow({ cols, error, retry }: { cols: number; error: unknown; retry: () => void }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-8">
        <ErrorBox error={error} retry={retry} />
      </td>
    </tr>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-[2px] border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      <WarningCircle className="size-5 shrink-0" weight="bold" />
      <span className="min-w-0 flex-1">{errorMessage(error)}</span>
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadMore({ hasNext, loading, onClick }: { hasNext: boolean; loading: boolean; onClick: () => void }) {
  if (!hasNext) return null;
  return (
    <div className="flex justify-center">
      <Button variant="outline" size="sm" busy={loading} onClick={onClick}>
        Load more
      </Button>
    </div>
  );
}

export type Tab<T extends string> = { value: T; label: string; count?: number | undefined };

/** Filter tabs that scroll sideways on phones. Arrow keys move between them. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex max-w-full gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = tabs.findIndex((t) => t.value === value);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        if (next) onChange(next.value);
      }}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={`-mb-px flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-[12px] font-bold tracking-[0.08em] whitespace-nowrap uppercase transition-colors pointer-coarse:min-h-11 ${
              on ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-accent'
            }`}
          >
            {t.label}
            {t.count !== undefined && <span className="text-ink-3 tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="grid content-start gap-3 rounded-[2px] border border-line-strong p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[20px]">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Label and value pairs in two columns. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-ink tabular-nums transition-colors hover:text-accent">
      {children}
    </Link>
  );
}

/** A modal dialog with a hard-edged frame, closed by Escape, the X or a click outside. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="pop mx-auto mt-[8vh] max-h-[86dvh] w-[min(520px,calc(100vw-32px))] overflow-y-auto rounded-[2px] border border-ink bg-surface p-0 text-ink shadow-[6px_6px_0_var(--ink)]"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[22px]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="press grid size-10 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2 pointer-coarse:size-11"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="grid gap-4 px-5 py-5">{children}</div>
    </dialog>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-5 place-items-center rounded-[2px] border border-line-strong bg-surface px-1 text-[11px] font-bold">
      {children}
    </kbd>
  );
}

export const textareaClass =
  'min-h-20 w-full rounded-[2px] border border-line-strong bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand';
export const inputClass =
  'h-9 w-full rounded-[2px] border border-line-strong bg-surface px-2.5 text-[14px] text-ink outline-none focus:border-brand pointer-coarse:h-11';
