'use client';
// Returns for staff: support approves or rejects requests; the warehouse receives the parcel and grades each
// line, which sets the refund, the restock or write-off and the points given back.
import type { Return, ReturnStatus } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { post } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';
import { RETURN_REASON_LABEL, RETURN_STATUS_LABEL } from '@/lib/returns';
import { errorMessage } from '../account/forms';
import { ReturnChip } from '../returns/bits';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type Condition, CONDITION_EFFECT, CONDITION_LABEL, staffKeys, useStaffReturn, useStaffReturns } from './api';
import {
  Dialog,
  EmptyRow,
  ErrorBox,
  ErrorRow,
  Facts,
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

const TABS: { value: ReturnStatus | ''; label: string }[] = [
  { value: 'requested', label: 'To review' },
  { value: 'approved', label: 'On the way' },
  { value: '', label: 'All' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partly refunded' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function ReturnQueue() {
  const [status, setStatus] = useState<ReturnStatus | ''>('requested');
  const q = useStaffReturns(status);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHead title="Returns" sub="Requests to review, parcels on the way, and finished returns." />
      <Tabs label="Return status" tabs={TABS} value={status} onChange={setStatus} />
      <Table label="Returns">
        <thead>
          <tr>
            <Th>Return</Th>
            <Th>Order</Th>
            <Th>Requested</Th>
            <Th>Reason</Th>
            <Th className="text-right">Items</Th>
            <Th className="text-right">Refund</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={7} />
          ) : q.isError ? (
            <ErrorRow cols={7} error={q.error} retry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyRow cols={7}>
              No returns {status ? `that are ${RETURN_STATUS_LABEL[status].toLowerCase()}` : 'yet'}.
            </EmptyRow>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <RowLink href={`/staff/returns/${r.id}`}>#{r.id}</RowLink>
                </Td>
                <Td>
                  <RowLink href={`/staff/orders/${r.orderId}`}>#{r.orderId}</RowLink>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{formatDateTime(r.requestedAt)}</Td>
                <Td>{RETURN_REASON_LABEL[r.reason]}</Td>
                <Td className="text-right tabular-nums">{r.itemCount}</Td>
                <Td className="text-right tabular-nums">
                  {r.refundTotal === '0.00' ? '' : formatAmount(r.refundTotal)}
                </Td>
                <Td>
                  <ReturnChip status={r.status} />
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

export function StaffReturnDetail({ id }: { id: string }) {
  const q = useStaffReturn(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  if (q.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const r = q.data;
  const done = (updated: Return, message: string) => {
    qc.setQueryData(staffKeys.return(id), updated);
    void qc.invalidateQueries({ queryKey: ['staff', 'returns'] });
    void qc.invalidateQueries({ queryKey: staffKeys.order(updated.orderId) });
    toast.show(message);
  };
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      done(await post<Return>(`/staff/returns/${id}/approve`), 'Approved; label emailed');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title={`Return #${r.id}`}
        sub={
          <>
            For{' '}
            <Link
              href={`/staff/orders/${r.orderId}`}
              className="font-semibold text-ink transition-colors hover:text-accent"
            >
              order #{r.orderId}
            </Link>{' '}
            · requested {formatDateTime(r.requestedAt)}
          </>
        }
        actions={<ReturnChip status={r.status} />}
      />
      {(r.allowedActions.includes('approve') || r.allowedActions.includes('reject')) && (
        <div className="flex flex-wrap gap-2">
          {r.allowedActions.includes('approve') && (
            <Button size="sm" busy={busy} onClick={() => void approve()}>
              Approve and send label
            </Button>
          )}
          {r.allowedActions.includes('reject') && (
            <Button size="sm" variant="danger" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          )}
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          {r.allowedActions.includes('receive') ? (
            <ReceiveForm ret={r} onDone={(u) => done(u, `Received; refund ${formatAmount(u.refundTotal)}`)} />
          ) : (
            <Table label="Returned lines">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">Qty</Th>
                  <Th>Condition</Th>
                  <Th>Stock</Th>
                  <Th className="text-right">Points</Th>
                  <Th className="text-right">Refund</Th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.productId}>
                    <Td className="font-semibold">{l.name}</Td>
                    <Td className="text-right tabular-nums">{l.qty}</Td>
                    <Td>
                      {l.condition ? CONDITION_LABEL[l.condition] : <span className="text-ink-3">Not received</span>}
                    </Td>
                    <Td>{l.condition ? (l.restocked ? 'Restocked' : 'Written off') : ''}</Td>
                    <Td className="text-right tabular-nums">{l.pointsRefund || ''}</Td>
                    <Td className="text-right font-semibold tabular-nums">
                      {l.condition ? formatAmount(l.refundAmount) : ''}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Panel title="History">
            <ol className="grid gap-1.5 text-[13px]">
              {r.events.map((e, i) => (
                <li key={i} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                  <span className="text-ink-3 tabular-nums">{formatDateTime(e.at)}</span>
                  <span>
                    <span className="font-semibold">{RETURN_STATUS_LABEL[e.to]}</span>
                    {e.note && <span className="text-ink-2">: {e.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="grid content-start gap-5">
          <Panel title="Request">
            <Facts
              rows={[
                ['Reason', RETURN_REASON_LABEL[r.reason]],
                ['Shop fault', r.shopFault ? 'Yes: free label, no restocking fee' : 'No'],
                ['Note', r.note ?? 'None'],
                ['Refund to', r.refundMethod === 'card' ? 'Card' : 'Store credit'],
                [
                  'Approval',
                  r.autoApproved ? 'Automatic' : r.decidedAt ? `By support, ${formatDateTime(r.decidedAt)}` : 'Waiting',
                ],
                ...(r.label
                  ? ([['Label', `${r.label.code} (use by ${formatDateTime(r.label.expiresAt)})`]] as [string, string][])
                  : []),
                ...(r.rejectedReason ? ([['Rejected', r.rejectedReason]] as [string, string][]) : []),
              ]}
            />
          </Panel>
          <Panel title="Refund">
            <Facts
              rows={[
                ['Estimate', formatAmount(r.estimate)],
                ['Label fee', r.labelFee === '0.00' ? 'None' : `-${formatAmount(r.labelFee)}`],
                ['Restocking fee', r.restockingFee === '0.00' ? 'None' : `-${formatAmount(r.restockingFee)}`],
                ['Shipping back', r.shippingRefund === '0.00' ? 'None' : formatAmount(r.shippingRefund)],
                ['Points back', String(r.pointsRefund)],
                [
                  'Refunded',
                  <span key="t" className="font-bold tabular-nums">
                    {r.refundedAt ? formatAmount(r.refundTotal) : 'Not yet'}
                  </span>,
                ],
              ]}
            />
          </Panel>
        </div>
      </div>
      <RejectDialog
        id={id}
        open={rejecting}
        onClose={() => setRejecting(false)}
        onDone={(u) => done(u, 'Rejected; customer emailed')}
      />
    </>
  );
}

const CONDITIONS = Object.keys(CONDITION_LABEL) as Condition[];

function ReceiveForm({ ret, onDone }: { ret: Return; onDone: (r: Return) => void }) {
  const [grades, setGrades] = useState<Record<string, Condition | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = ret.lines.filter((l) => !grades[l.productId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing.length) return setError(`Grade every line: ${missing.map((l) => l.name).join(', ')}.`);
    setBusy(true);
    setError(null);
    try {
      onDone(
        await post<Return>(`/staff/returns/${ret.id}/receive`, {
          items: ret.lines.map((l) => ({ productId: l.productId, condition: grades[l.productId] })),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4" data-testid="receive-form">
      <Panel title="Receive the parcel">
        <p className="text-[13px] text-ink-2">
          Grade each line as you unpack it. The refund is paid as soon as you confirm.
        </p>
        <div className="grid divide-y divide-line border-y border-line">
          {ret.lines.map((l) => (
            <fieldset key={l.productId} className="grid gap-2 py-3">
              <legend className="mb-2 text-[14px] font-semibold">
                {l.qty} x {l.name}
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {CONDITIONS.map((c) => (
                  <label
                    key={c}
                    className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-[2px] border px-3 py-2 text-[13px] transition-colors ${
                      grades[l.productId] === c ? 'border-accent bg-surface-2' : 'border-line hover:border-ink-3'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`grade-${l.productId}`}
                      value={c}
                      checked={grades[l.productId] === c}
                      onChange={() => setGrades((g) => ({ ...g, [l.productId]: c }))}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span className="grid">
                      <span className="font-semibold">{CONDITION_LABEL[c]}</span>
                      <span className="text-ink-2">{CONDITION_EFFECT[c](ret.shopFault)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end">
          <Button type="submit" busy={busy}>
            Confirm and refund
          </Button>
        </div>
      </Panel>
    </form>
  );
}

function RejectDialog({
  id,
  open,
  onClose,
  onDone,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDone: (r: Return) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Tell the customer why (at least 3 characters).');
    setBusy(true);
    setError(null);
    try {
      onDone(await post<Return>(`/staff/returns/${id}/reject`, { reason: reason.trim() }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Reject return #${id}`}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Reason (emailed to the customer)
          <textarea
            className={textareaClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
        </label>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant="danger" size="sm" busy={busy}>
            Reject
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
