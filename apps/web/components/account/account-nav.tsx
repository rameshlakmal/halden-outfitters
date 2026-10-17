'use client';
import {
  ArrowUUpLeft,
  ChatCircleText,
  Coins,
  HouseLine,
  MapPin,
  Package,
  ShieldCheck,
  Wallet,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/account', label: 'Overview', icon: HouseLine },
  { href: '/account/orders', label: 'Orders', icon: Package },
  { href: '/account/returns', label: 'Returns', icon: ArrowUUpLeft },
  { href: '/account/points', label: 'Points', icon: Coins },
  { href: '/account/store-credit', label: 'Store credit', icon: Wallet },
  { href: '/account/reviews', label: 'Reviews', icon: ChatCircleText },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/account/security', label: 'Security', icon: ShieldCheck },
];

/** A side list on wide screens, a scrollable tab row on phones. */
export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Account"
      className="-mx-[var(--gutter)] overflow-x-auto px-[var(--gutter)] [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0"
    >
      <ul className="flex gap-1 md:grid">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const current = href === '/account' ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-[2px] px-4 text-[12px] font-bold tracking-[0.08em] whitespace-nowrap uppercase transition-colors ${
                  current ? 'bg-ink text-bg' : 'text-ink hover:bg-surface-2 hover:text-accent'
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
