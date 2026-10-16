import type { ReactNode } from 'react';

/** One block of an account page: a heading, a line of context, then the content. Grouped by space and a rule, not a card. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5 border-t border-line pt-8 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="max-w-[60ch] text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
