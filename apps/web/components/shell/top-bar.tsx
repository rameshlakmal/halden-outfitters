'use client';
import { List, ShoppingBag, User, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { bounce } from '@/lib/motion';
import { useCart, useSession } from '@/lib/queries';
import { preloadCartDrawer, useCartDrawer } from './cart-drawer';
import { SearchButton } from './search';
import { Logo, NAV } from './nav';
import { ThemeToggle } from './theme';

export function TopBar() {
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);

  return (
    // A solid editorial bar with a hard rule underneath.
    <header className="sticky top-0 z-30 border-b border-line-strong bg-bg">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-1 px-4 sm:px-6 lg:gap-6 lg:px-8">
        <button
          type="button"
          className="press grid size-10 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2 md:hidden"
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
          <SearchButton />
          <ThemeToggle />
          <AccountLink />
          <CartButton />
        </div>
      </div>

      <dialog
        ref={menu}
        onClick={(e) => e.target === menu.current && menu.current?.close()}
        aria-label="Menu"
        className="pop m-0 h-dvh max-h-dvh w-[min(320px,86vw)] bg-surface p-0 text-ink"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <Logo />
          <button
            type="button"
            className="press grid size-10 place-items-center rounded-[2px] hover:bg-surface-2"
            aria-label="Close menu"
            onClick={() => menu.current?.close()}
          >
            <X className="size-5" />
          </button>
        </div>
        <nav aria-label="Mobile" className="grid gap-1 p-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => menu.current?.close()}
              className="rounded-[2px] px-3 py-3 text-lg hover:bg-surface-2"
            >
              {n.label}
            </Link>
          ))}
          <Link
            href="/account"
            prefetch={false}
            onClick={() => menu.current?.close()}
            className="rounded-[2px] px-3 py-3 text-lg hover:bg-surface-2"
          >
            Your account
          </Link>
        </nav>
      </dialog>
    </header>
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
      className="press grid size-10 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={me ? `Your account (${me.name})` : 'Sign in'}
    >
      {me ? (
        <span className="grid size-8 place-items-center rounded-[2px] bg-brand-soft text-[13px] font-semibold text-brand">
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
      className="press relative grid size-10 place-items-center rounded-[2px] text-ink hover:bg-surface-2"
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
