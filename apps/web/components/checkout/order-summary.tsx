'use client';
// What's being bought, with the coupon box and the money. Sticky beside the steps on wide screens; on phones a
// collapsible bar above the steps that shows the total.
import type { Cart, Quote } from '@halden/contracts';
import { formatAmount, fromCents, toCents } from '@halden/money';
import { CaretDown } from '@phosphor-icons/react';
import Image from 'next/image';
import { TotalsTable } from '../orders/totals';
import { CouponField } from './coupon-field';

function Lines({ cart }: { cart: Cart }) {
  return (
    <ul className="grid gap-3">
      {cart.lines.map((l) => (
        <li key={l.productId} className="flex items-center gap-3">
          <span className="relative shrink-0">
            <Image
              src={l.image.url}
              alt=""
              width={56}
              height={56}
              sizes="56px"
              className="size-14 rounded-[2px] bg-surface-2 object-cover"
            />
            <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-[2px] bg-ink px-1 text-[11px] font-bold text-bg tabular-nums">
              {l.qty}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{l.name}</span>
          <span className="text-[15px] tabular-nums">{formatAmount(l.lineTotal)}</span>
        </li>
      ))}
    </ul>
  );
}

function Money({ cart, quote }: { cart: Cart; quote: Quote | undefined }) {
  if (quote)
    return (
      <TotalsTable
        totals={quote.totals}
        coupon={cart.coupon?.applied ? cart.coupon.code : null}
        totalTestId="checkout-total"
      />
    );
  return (
    <dl className="grid gap-2 text-[15px]">
      <div className="flex justify-between">
        <dt className="text-ink-2">Subtotal</dt>
        <dd className="tabular-nums">{formatAmount(cart.subtotal)}</dd>
      </div>
      {cart.discount !== '0.00' && (
        <div className="flex justify-between text-accent">
          <dt>Discount</dt>
          <dd className="tabular-nums">-{formatAmount(cart.discount)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-ink-2">Shipping and tax</dt>
        <dd className="text-ink-3">Next step</dd>
      </div>
    </dl>
  );
}

export function OrderSummary({ cart, quote }: { cart: Cart; quote: Quote | undefined }) {
  return (
    <section
      aria-label="Order summary"
      className="grid gap-5 rounded-[2px] border border-line-strong bg-surface p-5 sm:p-6"
    >
      <h2 className="text-2xl">Your order</h2>
      <Lines cart={cart} />
      <div className="border-t border-line pt-4">
        <CouponField cart={cart} />
      </div>
      <div className="border-t border-line pt-4">
        <Money cart={cart} quote={quote} />
      </div>
    </section>
  );
}

export function MobileSummary({ cart, quote }: { cart: Cart; quote: Quote | undefined }) {
  const total = quote ? quote.totals.total : fromCents(toCents(cart.subtotal) - toCents(cart.discount));
  return (
    <details className="group rounded-[2px] border border-line-strong bg-surface md:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-[12px] font-bold tracking-[0.08em] uppercase">
          Order summary
          <CaretDown weight="bold" className="size-4 transition-transform duration-200 group-open:rotate-180" />
        </span>
        <span className="font-bold tabular-nums">{formatAmount(total)}</span>
      </summary>
      <div className="grid gap-5 border-t border-line px-4 pt-4 pb-5">
        <Lines cart={cart} />
        <CouponField cart={cart} />
        <Money cart={cart} quote={quote} />
      </div>
    </details>
  );
}
