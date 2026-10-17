'use client';
// One return: where it is, the label while it can be used, what came back in what condition, and the refund.
import type { Return } from '@halden/contracts';
import { formatAmount, fromCents, toCents } from '@halden/money';
import { ArrowLeft, Check, Copy, Tag, X } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { formatDate, formatDateTime, orderKeys } from '@/lib/orders';
import { CONDITION_LABEL, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, returnKeys, useReturn } from '@/lib/returns';
import { errorMessage } from '../account/forms';
import { shortId } from '../orders/order-list';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { ReturnChip } from './bits';

const label = 'text-[12px] font-bold tracking-[0.08em] uppercase';
const FINAL = ['refunded', 'partially_refunded'];

export function ReturnDetail({ id }: { id: string }) {
  const ret = useReturn(id);
  const [cancelling, setCancelling] = useState(false);

  if (ret.isPending) {
    return (
      <div className="grid gap-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (ret.isError) {
    return (
      <div className="grid justify-items-start gap-4">
        <FormAlert>{errorMessage(ret.error)}</FormAlert>
        <Link href="/account/returns" className="link font-semibold">
          All returns
        </Link>
      </div>
    );
  }

  const r = ret.data;
  const final = FINAL.includes(r.status);
  const canCancel = r.allowedActions.includes('cancel');

  return (
    <div className="grid gap-10">
      <header className="grid gap-4">
        <Link
          href="/account/returns"
          className="link inline-flex items-center gap-1.5 justify-self-start text-[12px] font-bold tracking-[0.08em] uppercase"
        >
          <ArrowLeft weight="bold" className="size-4" /> All returns
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Return {r.id}</h1>
            <p className="flex flex-wrap items-center gap-3 text-ink-2">
              <span data-testid="return-status">
                <ReturnChip status={r.status} />
              </span>
              <span>
                For{' '}
                <Link href={`/account/orders/${r.orderId}`} className="link font-medium text-ink">
                  order {shortId(r.orderId)}
                </Link>
                , started {formatDate(r.requestedAt)}
              </span>
            </p>
          </div>
          {canCancel && (
            <Button variant="danger" onClick={() => setCancelling(true)}>
              Cancel return
            </Button>
          )}
        </div>
      </header>

      <Status r={r} />

      <section aria-label="Items" className="grid gap-3">
        <h2 className={label}>Items</h2>
        <ul className="grid divide-y divide-line border-y border-line">
          {r.lines.map((l) => (
            <li key={l.productId} className="flex items-center gap-4 py-3">
              <Image
                src={l.image}
                alt=""
                width={56}
                height={56}
                sizes="56px"
                className="size-14 shrink-0 rounded-[2px] bg-surface-2 object-cover"
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">
                  {l.qty} x {l.name}
                </span>
                {l.condition && (
                  <span className="text-[14px] text-ink-3">
                    Checked: {CONDITION_LABEL[l.condition]}
                    {l.restocked ? '' : ', not resold'}
                  </span>
                )}
              </span>
              {final && <span className="tabular-nums">{formatAmount(l.refundAmount)}</span>}
            </li>
          ))}
        </ul>
        <p className="text-[15px] text-ink-2">
          {RETURN_REASON_LABEL[r.reason]}
          {r.note && <>: {r.note}</>}
        </p>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section aria-label="Refund" className="grid content-start gap-3">
          <h2 className={label}>{final ? 'Refund' : 'Expected refund'}</h2>
          <Breakdown r={r} final={final} />
        </section>
        <section aria-label="History" className="grid content-start gap-3">
          <h2 className={label}>History</h2>
          <ol className="grid gap-3 border-l-2 border-line pl-4">
            {r.events.map((e, i) => (
              <li key={i} className="relative grid gap-0.5 text-[15px]">
                <span aria-hidden="true" className="absolute top-1.5 -left-[21px] size-2 bg-accent" />
                <span className="font-medium">{RETURN_STATUS_LABEL[e.to]}</span>
                <span className="text-[13px] text-ink-3">{formatDateTime(e.at)}</span>
                {e.note && <span className="text-[14px] text-ink-2">{e.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {canCancel && <CancelReturnDialog r={r} open={cancelling} onClose={() => setCancelling(false)} />}
    </div>
  );
}

function Status({ r }: { r: Return }) {
  if (r.status === 'approved' && r.label) return <LabelCard code={r.label.code} expiresAt={r.label.expiresAt} />;
  const box = (icon: ReactNode, title: string, body: ReactNode) => (
    <div className="grid gap-2 rounded-[2px] border border-line-strong p-4">
      <p className="flex items-center gap-2 font-semibold">
        {icon} {title}
      </p>
      <p className="text-[15px] text-ink-2">{body}</p>
    </div>
  );
  switch (r.status) {
    case 'requested':
      return box(
        <Tag weight="bold" className="size-5 text-accent" />,
        'Waiting for review',
        'Our support team looks at your request within 2 working days. We email you the label once it is approved.',
      );
    case 'rejected':
      return box(
        <X weight="bold" className="size-5 text-danger" />,
        'Not approved',
        r.rejectedReason ?? 'Contact support for details.',
      );
    case 'expired':
      return box(
        <X weight="bold" className="size-5 text-ink-3" />,
        'Label expired',
        'The label was not used within 14 days, so this return closed. You can start a new one while the order is still in its return window.',
      );
    case 'cancelled':
      return box(
        <X weight="bold" className="size-5 text-ink-3" />,
        'Cancelled',
        'You cancelled this return. Nothing was sent back.',
      );
    case 'refunded':
    case 'partially_refunded':
      return box(
        <Check weight="bold" className="size-5 text-accent" />,
        `Refunded ${formatAmount(r.refundTotal)}`,
        `${r.refundMethod === 'card' ? 'Sent to your card' : 'Added to your store credit'}${r.refundedAt ? ` on ${formatDate(r.refundedAt)}` : ''}${r.pointsRefund > 0 ? `, with ${r.pointsRefund} points back` : ''}.${r.status === 'partially_refunded' ? ' Some items were damaged after delivery and could not be refunded.' : ''}`,
      );
    default:
      return box(
        <Check weight="bold" className="size-5 text-accent" />,
        'Received',
        'We have your parcel and are checking it.',
      );
  }
}

function LabelCard({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is selectable */
    }
  };
  return (
    <div
      data-testid="return-label"
      className="grid gap-3 rounded-[2px] border border-accent bg-surface p-4 shadow-[4px_4px_0_var(--accent)] sm:p-5"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Tag weight="bold" className="size-5 text-accent" /> Your return label
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xl font-bold tracking-wide break-all select-all" data-testid="label-code">
          {code}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={copy}
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-[15px] text-ink-2">
        Pack the items, write this code on the parcel and drop it at any carrier point by {formatDate(expiresAt)}. After
        that the label expires.
      </p>
    </div>
  );
}

function Breakdown({ r, final }: { r: Return; final: boolean }) {
  const rows: [string, string, boolean?][] = [];
  if (final) {
    const goods = r.lines.reduce((n, l) => n + toCents(l.refundAmount), 0) + toCents(r.restockingFee);
    rows.push(['Items', fromCents(goods)]);
    if (toCents(r.restockingFee) > 0) rows.push(['Restocking fee', r.restockingFee, true]);
  } else {
    rows.push([
      'Items, if they come back as new',
      fromCents(toCents(r.estimate) + toCents(r.labelFee) - toCents(r.shippingRefund)),
    ]);
  }
  if (toCents(r.labelFee) > 0) rows.push(['Return label', r.labelFee, true]);
  if (final && toCents(r.shippingRefund) > 0) rows.push(['Shipping', r.shippingRefund]);
  const total = final ? r.refundTotal : r.estimate;
  return (
    <dl className="grid gap-2 text-[15px]">
      {rows.map(([term, amount, minus]) => (
        <div key={term} className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">{term}</dt>
          <dd className="tabular-nums">
            {minus ? '-' : ''}
            {formatAmount(amount)}
          </dd>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-3">
        <dt className="font-semibold">{final ? 'Refunded' : 'Estimate'}</dt>
        <dd className="text-xl font-bold tabular-nums" data-testid="return-total">
          {formatAmount(total)}
        </dd>
      </div>
      {final && r.pointsRefund > 0 && (
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">Points back</dt>
          <dd className="tabular-nums">{r.pointsRefund.toLocaleString('en-GB')}</dd>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-2">Paid to</dt>
        <dd>{r.refundMethod === 'card' ? 'Your card' : 'Store credit'}</dd>
      </div>
    </dl>
  );
}

function CancelReturnDialog({ r, open, onClose }: { r: Return; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await post<Return>(`/returns/${r.id}/cancel`);
      qc.setQueryData(returnKeys.one(r.id), updated);
      void qc.invalidateQueries({ queryKey: returnKeys.list });
      void qc.invalidateQueries({ queryKey: orderKeys.one(r.orderId) });
      toast.show('Return cancelled');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      void qc.invalidateQueries({ queryKey: returnKeys.one(r.id) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Cancel this return"
      className="pop mx-auto mt-[8vh] max-h-[86dvh] w-[min(480px,calc(100vw-32px))] overflow-y-auto rounded-[2px] border border-ink bg-surface p-0 text-ink shadow-[6px_6px_0_var(--ink)]"
    >
      <div className="grid">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-2xl">Cancel this return?</h2>
          <button
            type="button"
            onClick={onClose}
            className="press grid size-11 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="grid gap-4 px-5 py-5">
          {error && <FormAlert>{error}</FormAlert>}
          <p className="text-[15px] text-ink-2">
            {r.label ? 'The label stops working. ' : ''}You can start a new return while the order is still in its
            return window.
          </p>
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Keep return
          </Button>
          <Button variant="danger" busy={busy} onClick={confirm}>
            Cancel return
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
