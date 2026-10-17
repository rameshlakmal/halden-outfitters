'use client';
// The warehouse's two queues: confirmed orders to pack, packed orders to ship. One action per row, with keys:
// focus a row, then P packs it; in the ship queue, S jumps to its tracking box and Enter ships.
import type { Order } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { type StaffOrderSummary, useStaffOrders } from './api';
import { EmptyRow, ErrorRow, inputClass, Kbd, LoadMore, PageHead, RowLink, SkeletonRows, Table, Td, Th } from './ui';

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['staff', 'orders'] });
}

export function Warehouse() {
  return (
    <>
      <PageHead
        title="Warehouse"
        sub={
          <>
            Focus a row and press <Kbd>P</Kbd> to pack, or <Kbd>S</Kbd> to type its tracking number; <Kbd>Enter</Kbd>{' '}
            ships.
          </>
        }
      />
      <Queue kind="pack" />
      <Queue kind="ship" />
    </>
  );
}

function Queue({ kind }: { kind: 'pack' | 'ship' }) {
  const q = useStaffOrders(kind === 'pack' ? 'confirmed' : 'packed');
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="grid gap-3" aria-labelledby={`queue-${kind}`}>
      <h2 id={`queue-${kind}`} className="flex items-baseline gap-2 text-[22px]">
        {kind === 'pack' ? 'To pack' : 'To ship'}
        {!q.isPending && (
          <span className="text-[14px] font-semibold text-ink-3">
            {rows.length}
            {q.hasNextPage ? '+' : ''}
          </span>
        )}
      </h2>
      <Table label={kind === 'pack' ? 'Orders to pack' : 'Orders to ship'}>
        <thead>
          <tr>
            <Th>Order</Th>
            <Th>Placed</Th>
            <Th>Customer</Th>
            <Th className="text-right">Items</Th>
            <Th className="text-right">Total</Th>
            <Th className="w-[320px]">{kind === 'pack' ? '' : 'Tracking number'}</Th>
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={6} rows={3} />
          ) : q.isError ? (
            <ErrorRow cols={6} error={q.error} retry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyRow cols={6}>
              {kind === 'pack'
                ? 'Nothing to pack. Confirmed orders appear here.'
                : 'Nothing to ship. Packed orders appear here.'}
            </EmptyRow>
          ) : (
            rows.map((o) => (kind === 'pack' ? <PackRow key={o.id} order={o} /> : <ShipRow key={o.id} order={o} />))
          )}
        </tbody>
      </Table>
      <LoadMore hasNext={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
    </section>
  );
}

function Cells({ o }: { o: StaffOrderSummary }) {
  return (
    <>
      <Td>
        <RowLink href={`/orders/${o.id}`}>#{o.id}</RowLink>
      </Td>
      <Td className="whitespace-nowrap text-ink-2">{formatDateTime(o.placedAt)}</Td>
      <Td className="max-w-52 truncate">{o.email}</Td>
      <Td className="text-right tabular-nums">{o.itemCount}</Td>
      <Td className="text-right tabular-nums">{formatAmount(o.total)}</Td>
    </>
  );
}

function PackRow({ order: o }: { order: StaffOrderSummary }) {
  const refresh = useRefresh();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pack = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await post<Order>(`/staff/orders/${o.id}/pack`);
      toast.show(`#${o.id} packed`);
      refresh();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      void pack();
    }
  };
  return (
    <tr
      tabIndex={0}
      onKeyDown={onKey}
      className="outline-offset-[-2px] hover:bg-surface-2 focus-visible:bg-surface-2"
      data-testid="pack-row"
    >
      <Cells o={o} />
      <Td className="text-right">
        <Button size="sm" busy={busy} onClick={() => void pack()}>
          Mark packed
        </Button>
      </Td>
    </tr>
  );
}

function ShipRow({ order: o }: { order: StaffOrderSummary }) {
  const refresh = useRefresh();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [tracking, setTracking] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ship = async () => {
    if (busy) return;
    if (tracking.trim().length < 4) {
      setError('At least 4 characters.');
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post<Order>(`/staff/orders/${o.id}/ship`, { trackingNumber: tracking.trim() });
      toast.show(`#${o.id} shipped; card charged`);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      input.current?.focus();
    }
  };
  return (
    <tr
      tabIndex={0}
      onKeyDown={onKey}
      className="outline-offset-[-2px] hover:bg-surface-2 focus-visible:bg-surface-2"
      data-testid="ship-row"
    >
      <Cells o={o} />
      <Td>
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ship();
          }}
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <input
              ref={input}
              className={inputClass}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="HX..."
              aria-label={`Tracking number for order ${o.id}`}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
            />
            {error && <span className="text-[12px] font-medium text-danger">{error}</span>}
          </div>
          <Button type="submit" size="sm" busy={busy}>
            Ship
          </Button>
        </form>
      </Td>
    </tr>
  );
}
