import Link from 'next/link';
import type { ReactNode } from 'react';

/** A readable policy page: a short header, then sections in one column of comfortable line length. */
export function PolicyPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-10 sm:px-6 md:grid-cols-[220px_minmax(0,1fr)] md:pt-16 lg:px-8">
      <nav aria-label="Help" className="flex gap-2 md:grid md:content-start md:gap-1">
        <HelpLink href="/help/shipping">Shipping</HelpLink>
        <HelpLink href="/help/returns">Returns</HelpLink>
      </nav>
      <article className="grid max-w-[68ch] gap-10">
        <header className="grid gap-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          <p className="text-lg leading-relaxed text-ink-2">{intro}</p>
        </header>
        {children}
      </article>
    </div>
  );
}

function HelpLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-full px-4 py-2 text-[15px] text-ink-2 hover:bg-surface-2 hover:text-ink">
      {children}
    </Link>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="grid gap-3 leading-relaxed text-ink-2 [&_li]:pl-1 [&_strong]:text-ink [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-[28px] bg-brand-soft px-5 py-4 text-[15px] text-brand">{children}</p>;
}
