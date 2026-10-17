'use client';
import { Briefcase, CaretRight, List, ShoppingBag, User, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { bounce } from '@/lib/motion';
import { ADMIN_URL } from '@/lib/admin';
import { useCart, useSession } from '@/lib/queries';
import { preloadCartDrawer, useCartDrawer } from './cart-drawer';
import { SearchButton } from './search';
import { Logo, NAV } from './nav';
import { ThemeToggle } from './theme';

export function TopBar() {
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const { data: me } = useSession();
  const staffRole = !!me && me.role !== 'customer';

  return (
    // A solid editorial bar with a hard rule underneath.
    <header className="sticky top-0 z-30 border-b border-line-strong bg-bg">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-1 px-[var(--gutter)] lg:gap-6">
        <button
          type="button"
          className="press grid size-10 place-items-center pointer-coarse:size-11 rounded-[2px] text-ink-2 hover:bg-surface-2 md:hidden"
          aria-label="Open menu"
          onClick={() => menu.current?.showModal()}
        >
          <List className="size-5" />
        </button>
        <Logo />
        <nav aria-label="Main" className="mx-auto hidden items-center gap-0.5 md:flex">
          {NAV.map((n) => {
            const current = n.href === '/shop' ? pathname === '/shop' : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={current ? 'page' : undefined}
                className={`px-3 py-2 text-[13px] font-bold tracking-[0.08em] uppercase transition-colors ${current ? 'text-accent' : 'text-ink hover:text-accent'}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-0.5 md:ml-0">
          <StaffLink />
          <SearchButton />
          {/* On the narrowest phones the theme switch lives in the menu instead. */}
          <div className="hidden min-[400px]:block">
            <ThemeToggle />
          </div>
          <AccountLink />
          <CartButton />
        </div>
      </div>

      <dialog
        ref={menu}
        onClick={(e) => e.target === menu.current && menu.current?.close()}
        aria-label="Menu"
        className="pop m-0 h-dvh max-h-dvh w-full max-w-none bg-bg p-0 text-ink"
      >
        <div className="flex h-16 items-center justify-between border-b border-line-strong px-[var(--gutter)]">
          <Logo />
          <button
            type="button"
            className="press grid size-11 place-items-center rounded-[2px] hover:bg-surface-2"
            aria-label="Close menu"
            onClick={() => menu.current?.close()}
          >
            <X className="size-6" />
          </button>
        </div>
        {/* Big, thumb-friendly links set in the display face. */}
        <nav aria-label="Mobile" className="grid px-[var(--gutter)] py-4">
          {[
            ...NAV,
            { href: '/account', label: 'Your account' },
            ...(staffRole ? [{ href: ADMIN_URL, label: 'Staff admin' }] : []),
          ].map((n) => {
            const current = n.href === '/shop' ? pathname === '/shop' : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                prefetch={n.href === '/account' || n.href === ADMIN_URL ? false : undefined}
                onClick={() => menu.current?.close()}
                aria-current={current ? 'page' : undefined}
                className={`flex items-center justify-between border-b border-line py-4 text-[clamp(32px,9vw,48px)] leading-none font-extrabold uppercase [font-stretch:72%] transition-colors ${
                  current ? 'text-accent' : 'hover:text-accent'
                }`}
              >
                {n.label}
                <CaretRight weight="bold" className="size-6" />
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between px-[var(--gutter)] py-4 text-sm font-semibold text-ink-2">
          Theme
          <ThemeToggle />
        </div>
      </dialog>
    </header>
  );
}

/** Only for support, warehouse and admin accounts: the way into the staff admin (its own app and sign-in). */
function StaffLink() {
  const { data: me } = useSession();
  if (!me || me.role === 'customer') return null;
  return (
    <a
      href={ADMIN_URL}
      className="hidden h-10 items-center gap-1.5 rounded-[2px] px-3 text-[12px] font-bold tracking-[0.08em] text-ink uppercase transition-colors hover:bg-surface-2 hover:text-accent sm:flex"
    >
      <Briefcase className="size-4" />
      Staff
    </a>
  );
}

function AccountLink() {
  const { data: me } = useSession();
  const initials = me?.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Link
      href={me ? '/account' : '/sign-in'}
      prefetch={false}
      className="press grid size-10 place-items-center pointer-coarse:size-11 rounded-[2px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={me ? `Your account (${me.name})` : 'Sign in'}
    >
      {me ? (
        <span className="grid size-8 place-items-center rounded-[2px] bg-ink text-[12px] font-bold tracking-[0.04em] text-bg">
          {initials}
        </span>
      ) : (
        <User className="size-5" />
      )}
    </Link>
  );
}

function CartButton() {
  const { data: cart } = useCart();
  const { open } = useCartDrawer();
  const count = cart?.itemCount ?? 0;
  const badge = useRef<HTMLSpanElement>(null);
  const last = useRef(count);

  // The count springs when it goes up: feedback that the add worked, even with the drawer closed.
  useEffect(() => {
    if (count > last.current) void bounce(badge.current);
    last.current = count;
  }, [count]);

  return (
    <button
      type="button"
      onClick={open}
      onPointerEnter={preloadCartDrawer}
      onFocus={preloadCartDrawer}
      className="press relative grid size-10 place-items-center pointer-coarse:size-11 rounded-[2px] text-ink hover:bg-surface-2"
      aria-label={`Open cart, ${count} item${count === 1 ? '' : 's'}`}
      data-testid="cart-button"
    >
      <ShoppingBag className="size-[22px]" />
      {count > 0 && (
        <span
          ref={badge}
          className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-[2px] bg-accent px-1 text-[11px] font-bold text-accent-ink tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
