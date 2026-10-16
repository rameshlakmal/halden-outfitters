'use client';
import { HouseLine, MapPin, ShieldCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/account', label: 'Overview', icon: HouseLine },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/account/security', label: 'Security', icon: ShieldCheck },
];

/** A side list on wide screens, a scrollable tab row on phones. */
export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 md:grid">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const current = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-[2px] px-4 py-2.5 text-[15px] whitespace-nowrap transition-colors ${
                  current ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <Icon className="size-[18px]" weight={current ? 'fill' : 'regular'} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
