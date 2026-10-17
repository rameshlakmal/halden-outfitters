import type { ReactNode } from 'react';

/** A radio drawn as a tile: ink border when chosen, a square check at the left. */
export function ChoiceTile({
  name,
  checked,
  onChange,
  children,
  aside,
  testId,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  aside?: ReactNode;
  testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-[2px] border bg-surface px-4 py-3.5 transition-[border-color] duration-150 has-[:focus-visible]:outline-2 ${
        checked ? 'border-ink shadow-[inset_0_0_0_1px_var(--ink)]' : 'border-line-strong hover:border-ink-3'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[2px] border ${checked ? 'border-ink bg-ink' : 'border-line-strong'}`}
      >
        {checked && <span className="size-2 bg-bg" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 text-[15px] leading-relaxed">{children}</span>
      {aside && <span className="shrink-0 text-[15px] font-semibold tabular-nums">{aside}</span>}
    </label>
  );
}

export function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1">
      <h2 className="text-3xl">{title}</h2>
      {children && <p className="max-w-[60ch] text-[15px] text-ink-2">{children}</p>}
    </div>
  );
}

export const smallLabel = 'text-[12px] font-bold tracking-[0.08em] uppercase';
