'use client';
// The order history: a card per order with its pictures, status, total and date. Ten at a time.
import type { OrderSummary } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { CaretRight, Package } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { formatDate, useLatestOrders, useOrderList } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Section } from '../account/section';
import { Skeleton } from '../ui/bits';
import { Button, LinkButton } from '../ui/button';
import { FormAlert } from '../ui/field';
import { StatusChip } from './status';

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export function OrderCard({ order: o }: { order: OrderSummary }) {
  const shown = o.images.slice(0, 3);
  const more = o.itemCount - shown.length;
  return (
    <Link
      href={`/account/orders/${o.id}`}
      data-testid="order-card"
      className="group grid gap-4 rounded-[2px] border border-line-strong bg-surface p-4 transition-[border-color] duration-150 hover:border-ink sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5"
    >
      <span className="flex items-center gap-2">
        {shown.map((src, i) => (
          <Image
            key={`${src}-${i}`}
            src={src}
            alt=""
            width={56}
            height={56}
            sizes="56px"
            className="size-14 rounded-[2px] bg-surface-2 object-cover"
          />
        ))}
        {more > 0 && (
          <span className="grid size-14 place-items-center rounded-[2px] border border-line text-[13px] font-bold text-ink-2">
            +{more}
          </span>
        )}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip status={o.status} />
          <span className="text-[13px] text-ink-3 tabular-nums">No. {shortId(o.id)}</span>
        </span>
        <span className="text-[15px] text-ink-2">
          Placed {formatDate(o.placedAt)}, {o.itemCount} item{o.itemCount === 1 ? '' : 's'}
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="text-lg font-bold tabular-nums">{formatAmount(o.total)}</span>
        <CaretRight
          weight="bold"
          className="size-5 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

function Empty() {
  return (
    <div className="grid justify-items-start gap-3 rounded-[2px] border border-dashed border-line-strong px-6 py-10">
      <Package className="size-8 text-ink-3" weight="thin" />
      <p className="font-medium">No orders yet</p>
      <p className="max-w-[44ch] text-sm text-ink-2">When you place an order it shows here, with its tracking.</p>
      <LinkButton href="/shop" variant="outline" size="sm">
        Browse the shop
      </LinkButton>
    </div>
  );
}

function ListSkeleton({ n }: { n: number }) {
  return (
    <div className="grid gap-3" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-[2px]" />
      ))}
    </div>
  );
}

export function OrderList() {
  const list = useOrderList();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="text-ink-2">Track a parcel, cancel before it ships, or check what you paid.</p>
      </header>
      {list.isPending ? (
        <ListSkeleton n={3} />
      ) : list.isError ? (
        <FormAlert>
          {errorMessage(list.error)}{' '}
          <button type="button" className="link font-semibold" onClick={() => list.refetch()}>
            Try again
          </button>
        </FormAlert>
      ) : items.length === 0 ? (
        <Empty />
      ) : (
        <>
          <ul className="grid gap-3">
            {items.map((o) => (
              <li key={o.id} className="enter">
                <OrderCard order={o} />
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

/** The overview's block: the three most recent orders and a way to the rest. */
export function LatestOrders() {
  const latest = useLatestOrders();
  const items = latest.data?.items ?? [];
  return (
    <Section
      title="Orders"
      description="Your most recent orders."
      action={
        items.length > 0 ? (
          <Link href="/account/orders" className="link text-[12px] font-bold tracking-[0.08em] uppercase">
            All orders
          </Link>
        ) : undefined
      }
    >
      {latest.isPending ? (
        <ListSkeleton n={2} />
      ) : latest.isError ? (
        <FormAlert>{errorMessage(latest.error)}</FormAlert>
      ) : items.length === 0 ? (
        <Empty />
      ) : (
        <ul className="grid gap-3">
          {items.map((o) => (
            <li key={o.id}>
              <OrderCard order={o} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
