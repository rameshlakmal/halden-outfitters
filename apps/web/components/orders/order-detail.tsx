'use client';
// One order: where it is, what's in it, what it cost, where it goes and how it was paid. Cancel while allowed.
import type { Order } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { ArrowLeft, Bank, Truck } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { formatDate, formatDateTime, METHOD_LABEL, useOrder } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { CancelDialog } from './cancel-dialog';
import { useTimeLeft } from './countdown';
import { shortId } from './order-list';
import { StatusChip, Timeline } from './status';
import { TotalsTable } from './totals';

const label = 'text-[12px] font-bold tracking-[0.08em] uppercase';

export function paymentText(p: NonNullable<Order['payment']>): string {
  switch (p.status) {
    case 'requires_action':
      return 'Waiting for your bank to confirm.';
    case 'authorized':
      return `${formatAmount(p.amount)} held on your card. It is charged when we ship.`;
    case 'captured':
      return `${formatAmount(p.captured)} charged.`;
    case 'voided':
      return 'The hold was released. Nothing was charged.';
    case 'failed':
      return 'The payment did not go through. Nothing was charged.';
    case 'partially_refunded':
      return `${formatAmount(p.captured)} charged, ${formatAmount(p.refunded)} refunded.`;
    case 'refunded':
      return `${formatAmount(p.refunded)} refunded in full.`;
  }
}

export function WaitingForBank({ order }: { order: Order }) {
  const left = useTimeLeft(order.paymentExpiresAt);
  return (
    <div
      data-testid="waiting-for-bank"
      className="grid gap-2 rounded-[2px] border border-accent bg-surface p-4 shadow-[4px_4px_0_var(--accent)]"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Bank weight="bold" className="size-5 text-accent" /> Waiting for your bank
      </p>
      <p className="text-[15px] text-ink-2">
        Your bank asked you to confirm this payment.{' '}
        {left
          ? `You have ${left} left. If it is not confirmed in time, the order is cancelled and nothing is charged.`
          : 'Time is up. The order will be cancelled in a moment and nothing is charged.'}
      </p>
    </div>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const order = useOrder(id, { poll: true });
  const [cancelling, setCancelling] = useState(false);

  if (order.isPending) {
    return (
      <div className="grid gap-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }
  if (order.isError) {
    return (
      <div className="grid justify-items-start gap-4">
        <FormAlert>{errorMessage(order.error)}</FormAlert>
        <Link href="/account/orders" className="link font-semibold">
          All orders
        </Link>
      </div>
    );
  }

  const o = order.data;
  const s = o.shipping;
  const canCancel = o.allowedActions.includes('cancel');
  const count = o.lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="grid gap-10">
      <header className="grid gap-4">
        <Link
          href="/account/orders"
          className="link inline-flex items-center gap-1.5 justify-self-start text-[12px] font-bold tracking-[0.08em] uppercase"
        >
          <ArrowLeft weight="bold" className="size-4" /> All orders
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Order {shortId(o.id)}</h1>
            <p className="flex flex-wrap items-center gap-3 text-ink-2">
              <StatusChip status={o.status} />
              Placed {formatDateTime(o.placedAt)}
            </p>
          </div>
          {canCancel && (
            <Button variant="danger" onClick={() => setCancelling(true)}>
              Cancel order
            </Button>
          )}
        </div>
      </header>

      {o.allowedActions.includes('pay') && <WaitingForBank order={o} />}
      {o.status !== 'pending_payment' && <Timeline order={o} />}

      {s.trackingNumber && (
        <div className="flex flex-wrap items-center gap-3 rounded-[2px] border border-line-strong bg-surface px-4 py-3">
          <Truck weight="bold" className="size-5 text-accent" />
          <span className={label}>Tracking</span>
          <span className="font-mono tabular-nums" data-testid="tracking-number">
            {s.trackingNumber}
          </span>
        </div>
      )}

      <section aria-label="Items" className="grid gap-3">
        <h2 className={label}>
          {count} item{count === 1 ? '' : 's'}
        </h2>
        <ul className="grid divide-y divide-line border-y border-line">
          {o.lines.map((l) => (
            <li key={l.productId} className="flex items-center gap-4 py-3">
              <Image
                src={l.image}
                alt=""
                width={64}
                height={64}
                sizes="64px"
                className="size-16 shrink-0 rounded-[2px] bg-surface-2 object-cover"
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <Link href={`/products/${l.slug}`} className="link truncate font-medium">
                  {l.name}
                </Link>
                <span className="text-[14px] text-ink-3 tabular-nums">
                  {l.qty} x {formatAmount(l.unitPrice)}
                </span>
              </span>
              <span className="tabular-nums">{formatAmount(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section aria-label="Delivery" className="grid content-start gap-1 text-[15px] leading-relaxed">
          <h2 className={`${label} mb-2`}>Delivery</h2>
          <span className="font-semibold">{s.name}</span>
          <span className="text-ink-2">
            {s.line1}
            {s.line2 && <>, {s.line2}</>}
          </span>
          <span className="text-ink-2">
            {s.postcode} {s.city}
            {s.region && <>, {s.region}</>}
          </span>
          <span className="text-ink-2">{s.countryName}</span>
          {s.phone && <span className="text-ink-3">{s.phone}</span>}
          <span className="mt-2">{METHOD_LABEL[s.method]} delivery</span>
        </section>
        <section aria-label="Payment" className="grid content-start gap-1 text-[15px] leading-relaxed">
          <h2 className={`${label} mb-2`}>Payment</h2>
          {o.payment ? (
            <>
              <span className="font-semibold">
                {o.payment.cardBrand} ending {o.payment.cardLast4}
              </span>
              <span className="text-ink-2" data-testid="payment-status">
                {paymentText(o.payment)}
              </span>
              {o.payment.disputed && <span className="font-medium text-danger">Disputed with your bank.</span>}
            </>
          ) : (
            <span className="text-ink-2">Paid with points and store credit. No card was used.</span>
          )}
          {o.pointsEarned > 0 && o.status !== 'cancelled' && (
            <span className="mt-2 text-ink-2">Earns {o.pointsEarned.toLocaleString('en-GB')} Halden Points.</span>
          )}
          {o.returnWindowEndsAt && (
            <span className="text-ink-2">Returns open until {formatDate(o.returnWindowEndsAt)}.</span>
          )}
        </section>
      </div>

      <section aria-label="Totals" className="grid max-w-md gap-3">
        <h2 className={label}>Totals</h2>
        <TotalsTable totals={o.totals} coupon={o.couponCode} totalTestId="order-total" />
      </section>

      {canCancel && <CancelDialog order={o} open={cancelling} onClose={() => setCancelling(false)} />}
    </div>
  );
}
