'use client';
// Halden Points and store credit: balances, how they work, and every change.
import { formatAmount, toCents } from '@halden/money';
import { Coins, Mountains, Wallet } from '@phosphor-icons/react';
import Link from 'next/link';
import { formatDate } from '@/lib/orders';
import { CREDIT_REASON_LABEL, POINTS_KIND_LABEL, usePoints, useStoreCredit } from '@/lib/returns';
import { shortId } from '../orders/order-list';
import { Skeleton } from '../ui/bits';
import { FormAlert } from '../ui/field';
import { errorMessage } from './forms';
import { Section } from './section';

const big = 'text-4xl font-bold tracking-tight tabular-nums';
const label = 'text-[12px] font-bold tracking-[0.08em] uppercase text-ink-2';
const n = (x: number) => x.toLocaleString('en-GB');

function Loading() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function OrderLink({ id }: { id: string | null }) {
  if (!id) return null;
  return (
    <Link href={`/account/orders/${id}`} className="link text-[13px] text-ink-3">
      Order {shortId(id)}
    </Link>
  );
}

export function PointsPage() {
  const q = usePoints();
  if (q.isPending) return <Loading />;
  if (q.isError) return <FormAlert>{errorMessage(q.error)}</FormAlert>;
  const p = q.data;
  const summit = p.tier === 'summit';
  return (
    <div className="grid gap-10">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Halden Points</h1>
        <p className="text-ink-2">Earned on what you pay for goods, spent at checkout.</p>
      </header>

      <div className="grid gap-px overflow-hidden rounded-[2px] border border-line-strong bg-line-strong sm:grid-cols-3">
        <div className="grid gap-1 bg-surface p-5">
          <span className={label}>Available</span>
          <span className={big} data-testid="points-available">
            {n(p.available)}
          </span>
          <span className="text-[14px] text-ink-2">Worth {formatAmount(Math.floor(p.available / 100) * 500)} off</span>
        </div>
        <div className="grid gap-1 bg-surface p-5">
          <span className={label}>Pending</span>
          <span className={big} data-testid="points-pending">
            {n(p.pending)}
          </span>
          <span className="text-[14px] text-ink-2">Ready when the return window closes</span>
        </div>
        <div className="grid gap-1 bg-surface p-5">
          <span className={label}>Tier</span>
          <span className="flex items-center gap-2 text-2xl font-bold">
            <Mountains
              weight={summit ? 'fill' : 'regular'}
              className={`size-6 ${summit ? 'text-accent' : 'text-ink-3'}`}
            />
            {summit ? 'Summit' : 'Base'}
          </span>
          <span className="text-[14px] text-ink-2">{summit ? '1.5 points per 1.00' : '1 point per 1.00'}</span>
        </div>
      </div>

      {p.nextExpiry && (
        <FormAlert tone="info">
          {n(p.nextExpiry.points)} points expire on {formatDate(p.nextExpiry.at)}. Spend them before then.
        </FormAlert>
      )}

      <Section title="How points work">
        <ul className="grid max-w-[64ch] gap-2 text-[15px] leading-relaxed text-ink-2">
          <li>You earn 1 point for every 1.00 you pay for goods. Tax and shipping do not earn points.</li>
          <li>
            Summit members earn 1.5 points per 1.00. You are Summit when your completed orders of the last 365 days add
            up to 500.00 or more.
          </li>
          <li>Points are pending until the order&apos;s 30-day return window closes, then you can spend them.</li>
          <li>Every 100 points take 5.00 off at checkout, up to half of your subtotal after any coupon.</li>
          <li>Points expire 12 months after they become available. Returned items lose their points.</li>
        </ul>
      </Section>

      <Section title="History">
        {p.history.length === 0 ? (
          <p className="text-[15px] text-ink-2">No points yet. Your first delivered order starts the count.</p>
        ) : (
          <ul className="grid divide-y divide-line border-y border-line" data-testid="points-history">
            {p.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-3">
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium">{POINTS_KIND_LABEL[h.kind] ?? h.kind}</span>
                  <span className="flex flex-wrap gap-x-3 text-[13px] text-ink-3">
                    {formatDate(h.at)}
                    {h.bucket === 'pending' && <span>Pending</span>}
                    <OrderLink id={h.orderId} />
                  </span>
                  {h.note && <span className="text-[13px] text-ink-2">{h.note}</span>}
                </span>
                <span className={`font-semibold tabular-nums ${h.points > 0 ? 'text-ink' : 'text-ink-3'}`}>
                  {h.points > 0 ? '+' : ''}
                  {n(h.points)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function StoreCreditPage() {
  const q = useStoreCredit();
  if (q.isPending) return <Loading />;
  if (q.isError) return <FormAlert>{errorMessage(q.error)}</FormAlert>;
  const c = q.data;
  return (
    <div className="grid gap-10">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Store credit</h1>
        <p className="text-ink-2">Refunds you chose to keep with us, ready to spend at checkout.</p>
      </header>
      <div className="grid gap-1 justify-self-start rounded-[2px] border border-line-strong bg-surface p-5 pr-10">
        <span className={label}>Balance</span>
        <span className={big} data-testid="credit-balance">
          {formatAmount(c.balance)}
        </span>
        <span className="text-[14px] text-ink-2">
          Turn on Use store credit at checkout. It pays first and your card covers the rest.
        </span>
      </div>
      <Section title="History">
        {c.history.length === 0 ? (
          <p className="text-[15px] text-ink-2">
            No store credit yet. Choose store credit when you start a return to get your refund straight away.
          </p>
        ) : (
          <ul className="grid divide-y divide-line border-y border-line" data-testid="credit-history">
            {c.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-3">
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium">{CREDIT_REASON_LABEL[h.reason] ?? h.reason}</span>
                  <span className="flex flex-wrap gap-x-3 text-[13px] text-ink-3">
                    {formatDate(h.at)}
                    <OrderLink id={h.orderId} />
                  </span>
                </span>
                <span className={`font-semibold tabular-nums ${toCents(h.amount) > 0 ? 'text-ink' : 'text-ink-3'}`}>
                  {toCents(h.amount) > 0 ? '+' : ''}
                  {formatAmount(h.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** The overview's block: balances worth knowing about, linked to their pages. */
export function RewardsSummary() {
  const points = usePoints();
  const credit = useStoreCredit();
  const p = points.data;
  const balance = credit.data ? toCents(credit.data.balance) : 0;
  if (!p || (p.available === 0 && p.pending === 0 && balance === 0)) return null;
  return (
    <Section title="Points and credit">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/account/points"
          className="group flex items-center gap-4 rounded-[2px] border border-line-strong bg-surface p-4 transition-[border-color] duration-150 hover:border-ink"
        >
          <Coins className="size-7 text-accent" />
          <span className="grid gap-0.5">
            <span className="text-xl font-bold tabular-nums">{n(p.available)} points</span>
            <span className="text-[14px] text-ink-2">
              {p.pending > 0 ? `${n(p.pending)} pending` : 'Available to spend'}
            </span>
          </span>
        </Link>
        {balance > 0 && credit.data && (
          <Link
            href="/account/store-credit"
            className="group flex items-center gap-4 rounded-[2px] border border-line-strong bg-surface p-4 transition-[border-color] duration-150 hover:border-ink"
          >
            <Wallet className="size-7 text-accent" />
            <span className="grid gap-0.5">
              <span className="text-xl font-bold tabular-nums">{formatAmount(credit.data.balance)}</span>
              <span className="text-[14px] text-ink-2">Store credit</span>
            </span>
          </Link>
        )}
      </div>
    </Section>
  );
}
