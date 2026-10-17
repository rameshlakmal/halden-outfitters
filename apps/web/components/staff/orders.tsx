'use client';
// Orders for staff: the queue by status, and one order with every action this role may take on it.
import type { CancelReason, Order, OrderStatus } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { formatDateTime, METHOD_LABEL, REASON_LABEL, STATUS_LABEL } from '@/lib/orders';
import { RETURN_STATUS_LABEL } from '@/lib/returns';
import { useSession } from '@/lib/queries';
import { errorMessage } from '../account/forms';
import { paymentText } from '../orders/order-detail';
import { StatusChip, Timeline } from '../orders/status';
import { TotalsTable } from '../orders/totals';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { send, staffKeys, useStaffOrder, useStaffOrders } from './api';
import {
  Dialog,
  EmptyRow,
  ErrorBox,
  ErrorRow,
  Facts,
  inputClass,
  LoadMore,
  PageHead,
  Panel,
  RowLink,
  SkeletonRows,
  Table,
  Tabs,
  Td,
  textareaClass,
  Th,
} from './ui';

const QUEUE_TABS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending_payment', label: 'Awaiting payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'packed', label: 'Packed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function OrderQueue() {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const q = useStaffOrders(status);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHead title="Orders" sub="Newest first. Open an order to act on it." />
      <Tabs label="Order status" tabs={QUEUE_TABS} value={status} onChange={setStatus} />
      <Table label="Orders">
        <thead>
          <tr>
            <Th>Order</Th>
            <Th>Placed</Th>
            <Th>Customer</Th>
            <Th className="text-right">Items</Th>
            <Th className="text-right">Total</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={6} />
          ) : q.isError ? (
            <ErrorRow cols={6} error={q.error} retry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyRow cols={6}>No {status ? STATUS_LABEL[status].toLowerCase() : ''} orders.</EmptyRow>
          ) : (
            rows.map((o) => (
              <tr key={o.id} className="hover:bg-surface-2" data-testid="staff-order-row">
                <Td>
                  <RowLink href={`/staff/orders/${o.id}`}>#{o.id}</RowLink>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{formatDateTime(o.placedAt)}</Td>
                <Td className="max-w-56 truncate">{o.email}</Td>
                <Td className="text-right tabular-nums">{o.itemCount}</Td>
                <Td className="text-right font-semibold tabular-nums">{formatAmount(o.total)}</Td>
                <Td>
                  <StatusChip status={o.status} />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <LoadMore hasNext={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
    </>
  );
}

/** Orders change through several screens: refresh the lists after any action. */
export function useOrderUpdated(id: string) {
  const qc = useQueryClient();
  return (order: Order) => {
    qc.setQueryData(staffKeys.order(id), order);
    void qc.invalidateQueries({ queryKey: ['staff', 'orders'] });
  };
}

export function StaffOrderDetail({ id }: { id: string }) {
  const q = useStaffOrder(id);
  if (q.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const o = q.data;
  return (
    <>
      <PageHead
        title={`Order #${o.id}`}
        sub={
          <>
            {o.email} · placed {formatDateTime(o.placedAt)}
          </>
        }
        actions={<StatusChip status={o.status} />}
      />
      <OrderActions order={o} />
      {o.status !== 'pending_payment' && <Timeline order={o} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-5">
          <Table label="Order lines">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Unit</Th>
                <Th className="text-right">Discount</Th>
                <Th className="text-right">Tax</Th>
                <Th className="text-right">Line</Th>
                <Th className="text-right">Returned</Th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.productId}>
                  <Td>
                    <span className="font-semibold">{l.name}</span>
                    {!l.returnable && (
                      <span className="ml-2 text-[11px] font-bold text-ink-3 uppercase">Final sale</span>
                    )}
                  </Td>
                  <Td className="text-ink-2">{l.sku}</Td>
                  <Td className="text-right tabular-nums">{l.qty}</Td>
                  <Td className="text-right tabular-nums">{formatAmount(l.unitPrice)}</Td>
                  <Td className="text-right tabular-nums">
                    {l.discount === '0.00' ? '' : `-${formatAmount(l.discount)}`}
                  </Td>
                  <Td className="text-right tabular-nums">{formatAmount(l.tax)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatAmount(l.lineTotal)}</Td>
                  <Td className="text-right tabular-nums">{l.returnedQty || ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Panel title="History">
            <ol className="grid gap-1.5 text-[13px]">
              {o.events.map((e, i) => (
                <li key={i} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-ink-3 tabular-nums">{formatDateTime(e.at)}</span>
                  <span>
                    <span className="font-semibold">{STATUS_LABEL[e.to]}</span>
                    <span className="text-ink-3"> by {e.by}</span>
                    {e.note && <span className="text-ink-2">: {e.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
          {(o.returns.length > 0 || o.refunds.length > 0) && (
            <Panel title="Returns and refunds">
              {o.returns.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-[13px]">
                  {o.returns.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/staff/returns/${r.id}`}
                        className="font-semibold transition-colors hover:text-accent"
                      >
                        Return #{r.id}
                      </Link>{' '}
                      <span className="text-ink-3">{RETURN_STATUS_LABEL[r.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
              {o.refunds.length > 0 && (
                <Table label="Refunds">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Kind</Th>
                      <Th>To</Th>
                      <Th>Reason</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.refunds.map((r, i) => (
                      <tr key={i}>
                        <Td className="whitespace-nowrap text-ink-2">{formatDateTime(r.at)}</Td>
                        <Td>{r.kind === 'goodwill' ? 'Goodwill' : 'Return'}</Td>
                        <Td>{r.method === 'card' ? 'Card' : 'Store credit'}</Td>
                        <Td>{r.reason}</Td>
                        <Td className="text-right font-semibold tabular-nums">{formatAmount(r.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          )}
        </div>
        <div className="grid content-start gap-5">
          <Panel title="Money">
            <TotalsTable totals={o.totals} coupon={o.couponCode} />
            {o.payment && (
              <Facts
                rows={[
                  ['Card', `${o.payment.cardBrand} ending ${o.payment.cardLast4}`],
                  ['Payment', paymentText(o.payment)],
                  ['Authorized', formatAmount(o.payment.amount)],
                  ['Captured', formatAmount(o.payment.captured)],
                  ['Refunded', formatAmount(o.payment.refunded)],
                  ...(o.payment.disputed
                    ? ([
                        [
                          'Dispute',
                          <span key="d" className="font-semibold text-danger">
                            Disputed by the card holder
                          </span>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ]}
              />
            )}
            {o.pointsEarned > 0 && <p className="text-[13px] text-ink-2">Earns {o.pointsEarned} points.</p>}
          </Panel>
          <Panel title="Delivery">
            <Facts
              rows={[
                ['Method', `${METHOD_LABEL[o.shipping.method]} (${o.shipping.zone})`],
                ['To', o.shipping.name],
                [
                  'Address',
                  [
                    o.shipping.line1,
                    o.shipping.line2,
                    `${o.shipping.postcode} ${o.shipping.city}`,
                    o.shipping.region,
                    o.shipping.countryName,
                  ]
                    .filter(Boolean)
                    .join(', '),
                ],
                ['Phone', o.shipping.phone ?? 'None'],
                ['Tracking', o.shipping.trackingNumber ?? 'Not shipped'],
                ...(o.returnWindowEndsAt
                  ? ([['Return by', formatDateTime(o.returnWindowEndsAt)]] as [string, string][])
                  : []),
              ]}
            />
          </Panel>
          {o.cancel && (
            <Panel title="Cancelled">
              <p className="text-[13px]">
                {REASON_LABEL[o.cancel.reason]}
                {o.cancel.note ? `: ${o.cancel.note}` : ''} ({formatDateTime(o.cancel.at)})
              </p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function OrderActions({ order: o }: { order: Order }) {
  const updated = useOrderUpdated(o.id);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'ship' | 'cancel' | 'goodwill' | null>(null);
  const actions = o.allowedActions;

  const step = async (path: 'pack' | 'deliver', done: string) => {
    setBusy(path);
    setError(null);
    try {
      updated(await post<Order>(`/staff/orders/${o.id}/${path}`));
      toast.show(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const any = ['pack', 'ship', 'deliver', 'cancel', 'goodwill'].some((a) => actions.includes(a as never));
  if (!any) return null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2" data-testid="order-actions">
        {actions.includes('pack') && (
          <Button size="sm" busy={busy === 'pack'} onClick={() => void step('pack', 'Marked packed')}>
            Mark packed
          </Button>
        )}
        {actions.includes('ship') && (
          <Button size="sm" onClick={() => setDialog('ship')}>
            Ship
          </Button>
        )}
        {actions.includes('deliver') && (
          <Button size="sm" busy={busy === 'deliver'} onClick={() => void step('deliver', 'Marked delivered')}>
            Mark delivered
          </Button>
        )}
        {actions.includes('goodwill') && (
          <Button size="sm" variant="outline" onClick={() => setDialog('goodwill')}>
            Goodwill refund
          </Button>
        )}
        {actions.includes('cancel') && (
          <Button size="sm" variant="danger" onClick={() => setDialog('cancel')}>
            Cancel order
          </Button>
        )}
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <ShipDialog order={o} open={dialog === 'ship'} onClose={() => setDialog(null)} onDone={updated} />
      <StaffCancelDialog order={o} open={dialog === 'cancel'} onClose={() => setDialog(null)} onDone={updated} />
      {dialog === 'goodwill' && <GoodwillDialog order={o} onClose={() => setDialog(null)} onDone={updated} />}
    </div>
  );
}

export function ShipDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: { id: string };
  open: boolean;
  onClose: () => void;
  onDone: (o: Order) => void;
}) {
  const toast = useToast();
  const [tracking, setTracking] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tracking.trim().length < 4) return setError('Enter the tracking number (at least 4 characters).');
    setBusy(true);
    setError(null);
    try {
      onDone(await post<Order>(`/staff/orders/${order.id}/ship`, { trackingNumber: tracking.trim() }));
      toast.show(`Order #${order.id} shipped; card charged`);
      setTracking('');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.fields.trackingNumber ? err.fields.trackingNumber : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Ship #${order.id}`}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <p className="text-[14px] text-ink-2">
          Shipping charges the card for the authorized amount and takes the held stock off the shelf.
        </p>
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Tracking number
          <input
            className={inputClass}
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            autoFocus
            autoComplete="off"
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" size="sm" busy={busy}>
            Ship and charge
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const STAFF_REASONS: CancelReason[] = [
  'customer_request',
  'out_of_stock',
  'fraud_suspected',
  'changed_mind',
  'ordered_by_mistake',
  'found_cheaper',
  'delivery_too_slow',
  'other',
];

function StaffCancelDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  onDone: (o: Order) => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<CancelReason>('customer_request');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason === 'other' && !note.trim()) return setError('Add a note for "Something else".');
    setBusy(true);
    setError(null);
    try {
      onDone(await post<Order>(`/orders/${order.id}/cancel`, { reason, note: note.trim() || undefined }));
      toast.show(`Order #${order.id} cancelled`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Cancel #${order.id}`}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <p className="text-[14px] text-ink-2">
          The card hold is released, the stock and any coupon use, points and store credit go back, and the customer is
          emailed.
        </p>
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Reason
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
            {STAFF_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Note{' '}
          {reason !== 'other' && <span className="font-semibold tracking-normal text-ink-3 normal-case">optional</span>}
          <textarea className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Keep the order
          </Button>
          <Button type="submit" variant="danger" size="sm" busy={busy}>
            Cancel order
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function GoodwillDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const { data: me } = useSession();
  const toast = useToast();
  // One key per dialog: a double click or a retry after a timeout refunds once.
  const [key] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'card' | 'store_credit'>('card');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const given = order.refunds.filter((r) => r.kind === 'goodwill').reduce((n, r) => n + Number(r.amount), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const value = Number(amount);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || value <= 0) next.amount = 'An amount above 0.00, like 12.50.';
    if (reason.trim().length < 3) next.reason = 'Say why (at least 3 characters).';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const updated = await send<Order>(
        'POST',
        `/staff/orders/${order.id}/goodwill`,
        { amount: value.toFixed(2), reason: reason.trim(), method },
        { 'idempotency-key': key },
      );
      onDone(updated);
      toast.show(`Refunded ${value.toFixed(2)}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.fields.amount || err.fields.reason))
        setErrors({ amount: err.fields.amount, reason: err.fields.reason });
      else setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Goodwill refund #${order.id}`}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <p className="text-[14px] text-ink-2">
          A refund without a return, for example for a late delivery.{' '}
          {me?.role === 'support'
            ? `Support can refund up to 50.00 per order; ${Math.max(0, 50 - given).toFixed(2)} is left on this one.`
            : 'Admins can refund any amount up to what is left to refund.'}
        </p>
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Amount
          <input
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-invalid={errors.amount ? true : undefined}
          />
          {errors.amount && (
            <span className="text-[13px] font-medium tracking-normal text-danger normal-case">{errors.amount}</span>
          )}
        </label>
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Reason
          <input
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            aria-invalid={errors.reason ? true : undefined}
          />
          {errors.reason && (
            <span className="text-[13px] font-medium tracking-normal text-danger normal-case">{errors.reason}</span>
          )}
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">Refund to</legend>
          {(['card', 'store_credit'] as const).map((m) => (
            <label key={m} className="flex min-h-9 items-center gap-2 text-[14px] pointer-coarse:min-h-11">
              <input
                type="radio"
                name="method"
                checked={method === m}
                onChange={() => setMethod(m)}
                className="accent-[var(--accent)]"
              />
              {m === 'card' ? 'The card (anything over the capture goes to store credit)' : 'Store credit (instant)'}
            </label>
          ))}
        </fieldset>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" size="sm" busy={busy}>
            Refund
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
