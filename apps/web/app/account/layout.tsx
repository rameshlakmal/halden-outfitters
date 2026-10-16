import type { ReactNode } from 'react';
import { AccountNav } from '@/components/account/account-nav';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-8 px-4 pt-8 sm:px-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-14 md:pt-14 lg:px-8">
      <aside className="grid content-start gap-4 md:sticky md:top-24 md:self-start">
        <p className="hidden text-sm font-semibold text-ink-3 md:block">Your account</p>
        <AccountNav />
      </aside>
      <div className="min-w-0 pb-8">{children}</div>
    </div>
  );
}
