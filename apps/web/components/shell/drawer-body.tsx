'use client';
// The drawer's contents, loaded the first time the cart opens (or earlier, when the pointer nears the cart
// button or a product is added), so this code isn't part of every page's first load.
import { formatAmount } from '@halden/money';
import { ShoppingBagOpen, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useCart } from '@/lib/queries';
import { Skeleton } from '../ui/bits';
import { buttonClass } from '../ui/button';
import { DrawerLine } from './cart-line';

export default function DrawerBody({ onClose }: { onClose: () => void }) {
  const { data: cart, isPending } = useCart();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">
          Your cart {cart && cart.itemCount > 0 && <span className="text-ink-3">({cart.itemCount})</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="press grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
          aria-label="Close cart"
          autoFocus
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5">
        {isPending ? (
          <div className="grid gap-4 py-5">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="size-20 rounded-[18px]" />
                <div className="grid flex-1 content-start gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !cart || cart.lines.length === 0 ? (
          <div className="grid h-full place-content-center justify-items-center gap-3 py-16 text-center">
            <ShoppingBagOpen className="size-12 text-ink-3" weight="thin" />
            <p className="font-medium">Your cart is empty</p>
            <p className="max-w-[28ch] text-sm text-ink-3">Tents, stoves and packs are waiting in the shop.</p>
            <Link href="/shop" onClick={onClose} className={buttonClass('outline', 'sm', 'mt-2')}>
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {cart.lines.map((line) => (
              <DrawerLine key={line.productId} line={line} onNavigate={onClose} list="drawer" />
            ))}
          </ul>
        )}
      </div>

      {cart && cart.lines.length > 0 && (
        <footer className="grid gap-3 border-t border-line px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-baseline justify-between">
            <span className="text-ink-2">Subtotal</span>
            <span className="text-lg font-semibold tabular-nums">{formatAmount(cart.subtotal)}</span>
          </div>
          <p className="text-[13px] text-ink-3">Shipping and tax are worked out at checkout.</p>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/cart" onClick={onClose} className={buttonClass('outline', 'md')}>
              View cart
            </Link>
            <Link
              href="/checkout"
              onClick={onClose}
              aria-disabled={!cart.canCheckOut}
              className={buttonClass('primary', 'md', cart.canCheckOut ? '' : 'pointer-events-none opacity-55')}
            >
              Check out
            </Link>
          </div>
        </footer>
      )}
    </div>
  );
}
