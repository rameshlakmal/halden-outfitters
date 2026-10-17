'use client';
// After Place order (or the bank step): confirmed, still waiting for the bank, or cancelled.
import { formatAmount } from '@halden/money';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { animate } from '@/lib/motion';
import { formatDateTime, METHOD_LABEL, REASON_LABEL, useOrder } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { WaitingForBank } from '../orders/order-detail';
import { shortId } from '../orders/order-list';
import { TotalsTable } from '../orders/totals';
import { Skeleton } from '../ui/bits';
import { LinkButton } from '../ui/button';
import { FormAlert } from '../ui/field';

export function Confirmation({ id }: { id: string }) {
  const order = useOrder(id, { poll: true });
  const mark = useRef<HTMLSpanElement>(null);
  const status = order.data?.status;

  useEffect(() => {
    if (!status || status === 'pending_payment') return;
    void animate(
      mark.current,
      [
        { opacity: 0, transform: 'scale(0.6)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 420 },
    );
  }, [status]);

  if (order.isPending) {
    return (
      <div className="grid gap-6" aria-busy="true">
        <Skeleton className="h-14 w-80" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }
  if (order.isError) {
    return (
      <div className="grid justify-items-start gap-4">
        <FormAlert>{errorMessage(order.error)}</FormAlert>
        <LinkButton href="/account/orders" variant="outline">
          Your orders
        </LinkButton>
      </div>
    );
  }

  const o = order.data;
  const s = o.shipping;

  if (o.status === 'pending_payment') {
    return (
      <div className="grid gap-6">
        <h1 className="text-5xl">Almost there</h1>
        <WaitingForBank order={o} />
        <p className="text-ink-2">This page updates on its own when your bank answers.</p>
      </div>
    );
  }

  if (o.status === 'cancelled') {
    const paymentProblem = o.cancel?.reason === 'payment_failed' || o.cancel?.reason === 'payment_timeout';
    return (
      <div className="grid justify-items-start gap-5" data-testid="confirmation-cancelled">
        <span ref={mark} className="text-danger">
          <XCircle weight="fill" className="size-14" />
        </span>
        <h1 className="text-5xl">Order not placed</h1>
        <p className="max-w-[56ch] leading-relaxed text-ink-2">
          {o.cancel ? REASON_LABEL[o.cancel.reason] : 'The order was cancelled'}. Nothing was charged.
          {paymentProblem && ' You can try again with another card.'}
        </p>
        <div className="flex flex-wrap gap-3">
          {paymentProblem && <LinkButton href="/cart">Back to cart</LinkButton>}
          <LinkButton href={`/account/orders/${o.id}`} variant="outline">
            View order
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-10" data-testid="confirmation">
      <header className="grid justify-items-start gap-4">
        <span ref={mark} className="text-accent">
          <CheckCircle weight="fill" className="size-14" />
        </span>
        <h1 className="text-5xl sm:text-6xl">Thank you</h1>
        <p className="max-w-[60ch] text-lg leading-relaxed text-ink-2">
          Order <strong className="text-ink tabular-nums">{shortId(o.id)}</strong> is confirmed. We sent the details to{' '}
          <strong className="text-ink">{o.email}</strong>. Your card is charged {formatAmount(o.totals.amountDue)} when
          we ship.
        </p>
      </header>

      <div className="grid gap-8 sm:grid-cols-2">
        <section aria-label="Delivery" className="grid content-start gap-1 text-[15px] leading-relaxed">
          <h2 className="mb-2 text-[12px] font-bold tracking-[0.08em] uppercase">Delivery</h2>
          <span className="font-semibold">{s.name}</span>
          <span className="text-ink-2">
            {s.line1}
            {s.line2 && <>, {s.line2}</>}
          </span>
          <span className="text-ink-2">
            {s.postcode} {s.city}, {s.countryName}
          </span>
          <span className="mt-2">{METHOD_LABEL[s.method]} delivery</span>
          <span className="text-ink-3">Placed {formatDateTime(o.placedAt)}</span>
        </section>
        <section aria-label="Totals" className="grid content-start gap-3">
          <h2 className="text-[12px] font-bold tracking-[0.08em] uppercase">Totals</h2>
          <TotalsTable totals={o.totals} coupon={o.couponCode} totalTestId="confirmation-total" />
        </section>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <LinkButton href={`/account/orders/${o.id}`}>View order</LinkButton>
        <LinkButton href="/shop" variant="outline">
          Keep shopping
        </LinkButton>
      </div>
    </div>
  );
}
