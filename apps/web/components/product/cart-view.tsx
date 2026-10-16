'use client';
import { formatAmount } from '@halden/money';
import { ShoppingBagOpen, WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useCart } from '@/lib/queries';
import { DrawerLine } from '../shell/cart-line';
import { Skeleton } from '../ui/bits';
import { buttonClass, LinkButton } from '../ui/button';

export function CartView() {
  const { data: cart, isPending, isError, refetch } = useCart();

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-10 sm:px-6 lg:px-8">
      <h1 className="mb-8 text-4xl font-semibold tracking-tight">Your cart</h1>
      {isPending ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-[2px]" />
            ))}
          </div>
          <Skeleton className="h-56 rounded-[2px]" />
        </div>
      ) : isError ? (
        <div role="alert" className="grid justify-items-start gap-3 rounded-[2px] border border-line bg-surface p-6">
          <p className="font-medium">We couldn't load your cart.</p>
          <button type="button" onClick={() => refetch()} className={buttonClass('outline', 'sm')}>
            Try again
          </button>
        </div>
      ) : cart.lines.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-[2px] border border-dashed border-line-strong px-6 py-20 text-center">
          <ShoppingBagOpen className="size-12 text-ink-3" weight="thin" />
          <p className="text-lg font-medium">Your cart is empty</p>
          <p className="max-w-[40ch] text-ink-2">Find something for your next night out.</p>
          <LinkButton href="/shop" className="mt-2">
            Browse the shop
          </LinkButton>
        </div>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
          <div className="rounded-[2px] border border-line bg-surface px-5">
            <ul className="divide-y divide-line">
              {cart.lines.map((line) => (
                <DrawerLine key={line.productId} line={line} list="page" />
              ))}
            </ul>
          </div>
          <aside className="grid gap-4 rounded-[2px] bg-surface-2 p-6 lg:sticky lg:top-24" aria-label="Order summary">
            <h2 className="text-lg font-semibold">Summary</h2>
            <dl className="grid gap-2 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-ink-2">Items ({cart.itemCount})</dt>
                <dd className="tabular-nums">{formatAmount(cart.subtotal)}</dd>
              </div>
              {cart.savings !== '0.00' && (
                <div className="flex justify-between text-brand">
                  <dt>Sale savings</dt>
                  <dd className="tabular-nums">{formatAmount(cart.savings)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-2">Shipping and tax</dt>
                <dd className="text-ink-3">At checkout</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-line pt-3 text-lg font-semibold">
                <dt>Subtotal</dt>
                <dd className="tabular-nums" data-testid="cart-subtotal">
                  {formatAmount(cart.subtotal)}
                </dd>
              </div>
            </dl>
            {!cart.canCheckOut && (
              <p className="flex gap-2 rounded-[2px] bg-warning-soft p-3 text-sm text-ink">
                <WarningCircle className="size-5 shrink-0 text-danger" />
                Some items can't be bought as they are. Fix the lines marked in red to check out.
              </p>
            )}
            <Link
              href="/checkout"
              aria-disabled={!cart.canCheckOut}
              className={buttonClass(
                'primary',
                'lg',
                `w-full ${cart.canCheckOut ? '' : 'pointer-events-none opacity-55'}`,
              )}
            >
              Check out
            </Link>
            <Link href="/shop" className="text-center text-sm text-ink-2 hover:text-ink">
              Keep shopping
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
