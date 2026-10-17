'use client';
// All of the customer's returns, newest first, ten at a time.
import { formatAmount } from '@halden/money';
import { ArrowUUpLeft, CaretRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { formatDate } from '@/lib/orders';
import { RETURN_REASON_LABEL, type ReturnSummaryT, useReturnList } from '@/lib/returns';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button, LinkButton } from '../ui/button';
import { FormAlert } from '../ui/field';
import { shortId } from '../orders/order-list';
import { ReturnChip } from './bits';

const DONE = ['refunded', 'partially_refunded'];

function ReturnCard({ r }: { r: ReturnSummaryT }) {
  return (
    <Link
      href={`/account/returns/${r.id}`}
      data-testid="return-card"
      className="group grid gap-3 rounded-[2px] border border-line-strong bg-surface p-4 transition-[border-color] duration-150 hover:border-ink sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5"
    >
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <ReturnChip status={r.status} />
          <span className="text-[13px] text-ink-3 tabular-nums">
            Return {r.id}, order {shortId(r.orderId)}
          </span>
        </span>
        <span className="text-[15px] text-ink-2">
          {RETURN_REASON_LABEL[r.reason]}, {r.itemCount} item{r.itemCount === 1 ? '' : 's'}, started{' '}
          {formatDate(r.requestedAt)}
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 sm:justify-end">
        {DONE.includes(r.status) && (
          <span className="text-lg font-bold tabular-nums">{formatAmount(r.refundTotal)}</span>
        )}
        <CaretRight
          weight="bold"
          className="ml-auto size-5 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

export function ReturnList() {
  const list = useReturnList();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Returns</h1>
        <p className="text-ink-2">Start a return from the order it belongs to. Track it and its refund here.</p>
      </header>
      {list.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-20 rounded-[2px]" />
          <Skeleton className="h-20 rounded-[2px]" />
        </div>
      ) : list.isError ? (
        <FormAlert>
          {errorMessage(list.error)}{' '}
          <button type="button" className="link font-semibold" onClick={() => list.refetch()}>
            Try again
          </button>
        </FormAlert>
      ) : items.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-[2px] border border-dashed border-line-strong px-6 py-10">
          <ArrowUUpLeft className="size-8 text-ink-3" weight="thin" />
          <p className="font-medium">No returns</p>
          <p className="max-w-[44ch] text-sm text-ink-2">
            Something not right? Open a delivered order and choose Start a return within 30 days of delivery.
          </p>
          <LinkButton href="/account/orders" variant="outline" size="sm">
            Your orders
          </LinkButton>
        </div>
      ) : (
        <>
          <ul className="grid gap-3">
            {items.map((r) => (
              <li key={r.id} className="enter">
                <ReturnCard r={r} />
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-center"
              busy={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
