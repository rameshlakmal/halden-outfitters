'use client';
import type { Role } from '@halden/contracts';
import { Mountains } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, useDashboard } from '@/lib/staff';
import { isActive, NAV } from './nav';

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 px-2.5 py-1 text-[17px] font-bold"
      aria-label="Halden admin, dashboard"
    >
      <Mountains weight="fill" className="size-6 text-accent" />
      Halden admin
    </Link>
  );
}

/** The grouped section list. Counters show open work (from the dashboard query, refreshed every minute). */
export function SideNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data } = useDashboard(30);
  return (
    <nav aria-label="Sections" className="grid gap-0.5">
      {NAV.map(({ group, items }) => {
        const visible = items.filter((i) => can(role, i.section));
        if (!visible.length) return null;
        return (
          <div key={group ?? 'top'} className="grid gap-0.5">
            {group && <p className="px-3 pt-4 pb-1.5 text-xs text-ink-3">{group}</p>}
            {visible.map((item) => {
              const active = isActive(item.href, pathname);
              const n = data && item.count ? item.count(data.queues) : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-[14.5px] transition-colors ${
                    active ? 'bg-brand-soft font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <item.icon className="size-[18px] shrink-0" weight={active ? 'fill' : 'regular'} />
                  {item.label}
                  {n > 0 && (
                    <span
                      className="tabular ml-auto rounded-full bg-accent px-1.5 py-px text-[11.5px] text-accent-ink"
                      aria-label={`${n} open`}
                    >
                      {n}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
