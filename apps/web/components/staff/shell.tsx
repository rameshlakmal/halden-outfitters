'use client';
// The staff console frame: a compact sidebar on wide screens, a menu row on phones, only the sections the
// signed-in role can use. Signed out goes to sign-in; customers see that this is for staff.
import type { Me } from '@halden/contracts';
import {
  ArrowLeft,
  ArrowUUpLeft,
  ChatCircleText,
  ClipboardText,
  Flask,
  GearSix,
  Package,
  Storefront,
  Tag,
  Truck,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useSession } from '@/lib/queries';
import { Skeleton } from '../ui/bits';
import { LinkButton } from '../ui/button';
import { can, ROLE_LABEL, type Section } from './api';

export const SECTIONS: { section: Section; href: string; label: string; icon: Icon; blurb: string }[] = [
  {
    section: 'orders',
    href: '/staff/orders',
    label: 'Orders',
    icon: Package,
    blurb: 'Every order, its payment, cancels and goodwill refunds.',
  },
  {
    section: 'warehouse',
    href: '/staff/warehouse',
    label: 'Warehouse',
    icon: Truck,
    blurb: 'Pack confirmed orders and ship packed ones.',
  },
  {
    section: 'returns',
    href: '/staff/returns',
    label: 'Returns',
    icon: ArrowUUpLeft,
    blurb: 'Approve requests, receive parcels and grade each line.',
  },
  {
    section: 'products',
    href: '/staff/products',
    label: 'Products',
    icon: Tag,
    blurb: 'Prices, details and stock, with every movement.',
  },
  {
    section: 'reviews',
    href: '/staff/reviews',
    label: 'Reviews',
    icon: ChatCircleText,
    blurb: 'Reviews held for a look, hidden and published.',
  },
  {
    section: 'customers',
    href: '/staff/customers',
    label: 'Customers',
    icon: UsersThree,
    blurb: 'Find accounts; admins change roles.',
  },
  {
    section: 'settings',
    href: '/staff/settings',
    label: 'Settings',
    icon: GearSix,
    blurb: 'Coupons, shipping rates and the tax rate.',
  },
  {
    section: 'audit',
    href: '/staff/audit',
    label: 'Audit log',
    icon: ClipboardText,
    blurb: 'Who changed what, before and after.',
  },
  {
    section: 'qa',
    href: '/qa',
    label: 'QA lab',
    icon: Flask,
    blurb: 'Planted bugs, the shop clock, sweeps and webhooks.',
  },
];

function useStaffGate(): { me: Me | null; state: 'loading' | 'signed_out' | 'customer' | 'ok' } {
  const { data, isPending } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!isPending && data === null) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [isPending, data, router, pathname]);
  if (isPending) return { me: null, state: 'loading' };
  if (!data) return { me: null, state: 'signed_out' };
  if (data.role === 'customer') return { me: data, state: 'customer' };
  return { me: data, state: 'ok' };
}

export function StaffShell({ children }: { children: ReactNode }) {
  const { me, state } = useStaffGate();
  const pathname = usePathname();

  if (state === 'customer') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-[var(--gutter)] py-16">
        <h1 className="text-[clamp(32px,6vw,48px)]">Staff only</h1>
        <p className="leading-relaxed text-ink-2">
          The staff console is for Halden support, warehouse and admin accounts. You are signed in as a customer.
        </p>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/account">Your account</LinkButton>
          <LinkButton href="/shop" variant="outline">
            Back to the shop
          </LinkButton>
        </div>
      </div>
    );
  }

  const items = SECTIONS.filter((s) => can(me?.role, s.section));
  const active = SECTIONS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  const allowed = !active || can(me?.role, active.section);

  return (
    <div className="mx-auto grid max-w-[1600px] gap-5 px-[var(--gutter)] pt-4 pb-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8 lg:pt-6">
      <aside className="grid content-start gap-3 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between gap-2 lg:grid lg:justify-start">
          <Link
            href="/staff"
            className="text-[13px] font-bold tracking-[0.08em] uppercase transition-colors hover:text-accent"
          >
            Staff console
          </Link>
          {me ? (
            <span className="inline-flex h-6 items-center rounded-[2px] bg-ink px-2 text-[11px] font-bold tracking-[0.08em] text-bg uppercase">
              {ROLE_LABEL[me.role]}
            </span>
          ) : (
            <Skeleton className="h-6 w-20" />
          )}
        </div>
        <nav
          aria-label="Staff"
          className="-mx-[var(--gutter)] overflow-x-auto px-[var(--gutter)] [scrollbar-width:none] lg:mx-0 lg:overflow-visible lg:px-0"
        >
          <ul className="flex gap-1 lg:grid">
            {state === 'loading'
              ? Array.from({ length: 5 }, (_, i) => (
                  <li key={i}>
                    <Skeleton className="h-9 w-28 lg:w-full" />
                  </li>
                ))
              : items.map(({ href, label, icon: Ico }) => {
                  const current = active?.href === href;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={current ? 'page' : undefined}
                        className={`flex min-h-9 items-center gap-2 rounded-[2px] px-3 text-[12px] font-bold tracking-[0.08em] whitespace-nowrap uppercase transition-colors pointer-coarse:min-h-11 ${
                          current ? 'bg-ink text-bg' : 'text-ink hover:bg-surface-2 hover:text-accent'
                        }`}
                      >
                        <Ico className="size-4" weight={current ? 'fill' : 'regular'} />
                        {label}
                      </Link>
                    </li>
                  );
                })}
          </ul>
        </nav>
        <Link
          href="/shop"
          className="hidden items-center gap-1.5 text-[12px] font-bold tracking-[0.08em] text-ink-2 uppercase transition-colors hover:text-accent lg:flex"
        >
          <Storefront className="size-4" /> Back to the shop
        </Link>
      </aside>
      <div className="grid min-w-0 content-start gap-5">
        {state !== 'ok' ? (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : allowed ? (
          children
        ) : (
          <div className="grid max-w-xl gap-3 py-8">
            <h1 className="text-[clamp(28px,4vw,40px)]">Not for your role</h1>
            <p className="text-ink-2">
              {active?.label} is not part of the {ROLE_LABEL[me!.role].toLowerCase()} role. Ask an admin if you need it.
            </p>
            <Link
              href="/staff"
              className="inline-flex items-center gap-1.5 font-semibold transition-colors hover:text-accent"
            >
              <ArrowLeft className="size-4" /> Staff console
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** The console's front page: the sections this role can use. */
export function StaffHome() {
  const { data: me } = useSession();
  const items = SECTIONS.filter((s) => can(me?.role, s.section));
  return (
    <>
      <header className="border-b border-line-strong pb-3">
        <h1 className="text-[clamp(28px,4vw,40px)]">Hello{me ? `, ${me.name.split(' ')[0]}` : ''}</h1>
      </header>
      <ul className="grid divide-y divide-line border-y border-line">
        {items.map(({ href, label, blurb, icon: Ico }) => (
          <li key={href}>
            <Link href={href} className="group flex items-center gap-3 py-3 transition-colors hover:text-accent">
              <Ico className="size-5 shrink-0" />
              <span className="w-32 shrink-0 text-[13px] font-bold tracking-[0.08em] uppercase">{label}</span>
              <span className="min-w-0 text-[14px] text-ink-2 group-hover:text-ink">{blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
