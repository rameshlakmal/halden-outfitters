'use client';
// Start a return in three steps: what is going back, why (and where the money goes), then a review. The
// estimate here is a guide worked out from what the order stored for each line; the API works out the real
// refund and the parcel check decides the final one.
import type { Order, Return, ReturnReason } from '@halden/contracts';
import { formatAmount, fromCents, toCents } from '@halden/money';
import { ArrowLeft } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { orderKeys, useOrder } from '@/lib/orders';
import { LABEL_FEE, RETURN_REASON_LABEL, RETURN_REASON_LIST, returnKeys, SHOP_FAULT } from '@/lib/returns';
import { errorMessage } from '../account/forms';
import { ChoiceTile, smallLabel, StepHeading } from '../checkout/choice';
import { shortId } from '../orders/order-list';
import { QtyStepper } from '../shell/qty-stepper';
import { Skeleton } from '../ui/bits';
import { Button, LinkButton } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { ReturnPolicy } from './bits';

type Step = 1 | 2 | 3;
type Method = 'card' | 'store_credit';
type Line = Order['lines'][number];

/** What these units of a line cost, as the order stored it: goods less coupon and points shares, plus tax. */
const share = (l: Line, qty: number) =>
  Math.round(((toCents(l.lineTotal) - toCents(l.discount) - toCents(l.pointsDiscount) + toCents(l.tax)) * qty) / l.qty);

export function ReturnWizard({ orderId }: { orderId: string }) {
  const order = useOrder(orderId);
  if (order.isPending) {
    return (
      <div className="grid gap-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }
  if (order.isError) return <FormAlert>{errorMessage(order.error)}</FormAlert>;
  return <Wizard order={order.data} />;
}

function Wizard({ order: o }: { order: Order }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<Method>('card');
  const [errors, setErrors] = useState<{
    lines?: Record<string, string>;
    pick?: string;
    reason?: string;
    note?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  const back = (
    <Link
      href={`/account/orders/${o.id}`}
      className="link inline-flex items-center gap-1.5 justify-self-start text-[12px] font-bold tracking-[0.08em] uppercase"
    >
      <ArrowLeft weight="bold" className="size-4" /> Order {shortId(o.id)}
    </Link>
  );

  if (!o.allowedActions.includes('return')) {
    return (
      <div className="grid justify-items-start gap-5">
        {back}
        <h1 className="text-3xl font-semibold tracking-tight">Start a return</h1>
        <FormAlert tone="info">
          {o.returns.some((r) => r.status === 'requested' || r.status === 'approved')
            ? 'This order already has an open return. Finish or cancel it before starting another.'
            : o.status === 'delivered' || o.status === 'completed'
              ? 'Nothing on this order can be returned now. Returns are open for 30 days from delivery.'
              : 'Orders can be returned once they have been delivered.'}
        </FormAlert>
        <LinkButton href={`/account/orders/${o.id}`} variant="outline">
          Back to the order
        </LinkButton>
      </div>
    );
  }

  const chosen = o.lines.filter((l) => (picked[l.productId] ?? 0) > 0);
  const shopFault = reason ? SHOP_FAULT.includes(reason) : false;
  const goods = chosen.reduce((n, l) => n + share(l, picked[l.productId]!), 0);
  const everything = o.lines.every((l) => l.returnedQty + (picked[l.productId] ?? 0) >= l.qty);
  const shipping = shopFault && everything ? toCents(o.totals.shipping) : 0;
  const fee = reason && !shopFault ? Math.min(toCents(LABEL_FEE), goods) : 0;
  const estimate = goods - fee + shipping;

  const toggle = (l: Line) =>
    setPicked((p) => ({ ...p, [l.productId]: (p[l.productId] ?? 0) > 0 ? 0 : Math.min(1, l.returnableQty) }));

  const next = () => {
    if (step === 1) {
      if (chosen.length === 0) return setErrors({ pick: 'Choose at least one item.' });
      setErrors({});
      setStep(2);
    } else if (step === 2) {
      const e: typeof errors = {};
      if (!reason) e.reason = 'Choose a reason.';
      if (reason === 'other' && !note.trim()) e.note = 'Tell us what is wrong.';
      setErrors(e);
      if (!Object.keys(e).length) setStep(3);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const items = chosen.map((l) => ({ productId: l.productId, qty: picked[l.productId]! }));
    try {
      const r = await post<Return>(`/orders/${o.id}/returns`, {
        items,
        reason,
        note: note.trim() || undefined,
        refundMethod: method,
      });
      qc.setQueryData(returnKeys.one(r.id), r);
      void qc.invalidateQueries({ queryKey: orderKeys.one(o.id) });
      void qc.invalidateQueries({ queryKey: returnKeys.list });
      toast.show(r.status === 'approved' ? 'Return approved. Your label is ready.' : 'Return sent for review');
      router.push(`/account/returns/${r.id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'validation_failed') {
        const lines: Record<string, string> = {};
        for (const [path, message] of Object.entries(err.fields)) {
          const m = /^items\.(\d+)\./.exec(path);
          const item = m ? items[Number(m[1])] : undefined;
          if (item) lines[item.productId] = message;
        }
        if (Object.keys(lines).length) {
          setErrors({ lines, form: err.message });
          return setStep(1);
        }
        if (err.fields.note) {
          setErrors({ note: err.fields.note });
          return setStep(2);
        }
      }
      setErrors({ form: errorMessage(err) });
      // The order may have changed (window closed, another return opened).
      if (err instanceof ApiError && err.code === 'return_not_allowed')
        void qc.invalidateQueries({ queryKey: orderKeys.one(o.id) });
    }
  };

  return (
    <div className="grid gap-8">
      <header className="grid gap-4">
        {back}
        <h1 className="text-3xl font-semibold tracking-tight">Start a return</h1>
        <ol className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Steps">
          {(['Items', 'Reason', 'Review'] as const).map((name, i) => (
            <li
              key={name}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={`${smallLabel} ${step === i + 1 ? 'text-accent' : step > i + 1 ? 'text-ink' : 'text-ink-3'}`}
            >
              {i + 1}. {name}
            </li>
          ))}
        </ol>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div key={step} className="enter grid gap-6">
          {errors.form && <FormAlert>{errors.form}</FormAlert>}

          {step === 1 && (
            <>
              <StepHeading title="What is going back?">
                Choose the items and how many. Returns are open until{' '}
                {o.returnWindowEndsAt
                  ? new Date(o.returnWindowEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
                  : 'the end of the window'}
                .
              </StepHeading>
              <ul className="grid divide-y divide-line border-y border-line">
                {o.lines.map((l) => {
                  const can = l.returnableQty > 0;
                  const qty = picked[l.productId] ?? 0;
                  const lineError = errors.lines?.[l.productId];
                  return (
                    <li key={l.productId} className="grid gap-2 py-3" data-testid="return-line">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                        <label
                          className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 ${can ? 'cursor-pointer' : 'opacity-60'}`}
                        >
                          <input
                            type="checkbox"
                            checked={qty > 0}
                            disabled={!can}
                            onChange={() => toggle(l)}
                            className="size-5 shrink-0 accent-[var(--ink)]"
                          />
                          <Image
                            src={l.image}
                            alt=""
                            width={56}
                            height={56}
                            sizes="56px"
                            className="size-14 shrink-0 rounded-[2px] bg-surface-2 object-cover"
                          />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="truncate font-medium">{l.name}</span>
                            <span className="text-[14px] text-ink-3">
                              {!l.returnable
                                ? 'Final sale'
                                : can
                                  ? `${l.returnableQty} of ${l.qty} can be returned`
                                  : 'Already returned'}
                            </span>
                          </span>
                        </label>
                        {qty > 0 && l.returnableQty > 1 && (
                          <QtyStepper
                            qty={qty}
                            max={l.returnableQty}
                            label={l.name}
                            onChange={(n) => setPicked((p) => ({ ...p, [l.productId]: n }))}
                          />
                        )}
                      </div>
                      {lineError && <p className="text-[13px] font-medium text-danger">{lineError}</p>}
                    </li>
                  );
                })}
              </ul>
              {errors.pick && <p className="text-[13px] font-medium text-danger">{errors.pick}</p>}
            </>
          )}

          {step === 2 && (
            <>
              <StepHeading title="Why is it going back?">
                Your reason decides the label: free when the problem was ours, {LABEL_FEE} off the refund otherwise.
              </StepHeading>
              <fieldset className="grid gap-2" aria-describedby={errors.reason ? 'return-reason-error' : undefined}>
                <legend className={`${smallLabel} mb-2`}>Reason</legend>
                {RETURN_REASON_LIST.map((r) => (
                  <ChoiceTile
                    key={r}
                    name="reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    testId={`reason-${r}`}
                    aside={
                      SHOP_FAULT.includes(r) ? <span className="text-[13px] text-ink-2">Free label</span> : undefined
                    }
                  >
                    {RETURN_REASON_LABEL[r]}
                  </ChoiceTile>
                ))}
                {errors.reason && (
                  <p id="return-reason-error" className="text-[13px] font-medium text-danger">
                    {errors.reason}
                  </p>
                )}
              </fieldset>
              <div className="grid gap-1.5">
                <label htmlFor="return-note" className={smallLabel}>
                  Note
                  {reason !== 'other' && (
                    <span className="ml-1.5 font-semibold tracking-normal text-ink-3 normal-case">optional</span>
                  )}
                </label>
                <textarea
                  id="return-note"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-invalid={errors.note ? true : undefined}
                  aria-describedby={errors.note ? 'return-note-error' : undefined}
                  className={`w-full rounded-[2px] border bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-brand ${errors.note ? 'border-danger' : 'border-line-strong'}`}
                />
                {errors.note && (
                  <p id="return-note-error" className="text-[13px] font-medium text-danger">
                    {errors.note}
                  </p>
                )}
              </div>
              <fieldset className="grid gap-2">
                <legend className={`${smallLabel} mb-2`}>Refund to</legend>
                <ChoiceTile
                  name="method"
                  checked={method === 'card'}
                  onChange={() => setMethod('card')}
                  testId="method-card"
                >
                  <span className="font-medium">Your card</span>
                  <span className="text-[14px] text-ink-2">
                    {o.payment ? `${o.payment.cardBrand} ending ${o.payment.cardLast4}. ` : ''}Any part paid with store
                    credit comes back as credit.
                  </span>
                </ChoiceTile>
                <ChoiceTile
                  name="method"
                  checked={method === 'store_credit'}
                  onChange={() => setMethod('store_credit')}
                  testId="method-store-credit"
                >
                  <span className="font-medium">Store credit</span>
                  <span className="text-[14px] text-ink-2">Ready to spend the moment we check your parcel.</span>
                </ChoiceTile>
              </fieldset>
            </>
          )}

          {step === 3 && reason && (
            <>
              <StepHeading title="Check and send">
                {shopFault
                  ? 'Sorry about that. Items under 150.00 are usually approved straight away with a free label.'
                  : 'Our support team looks at your request within 2 working days and emails you the label.'}
              </StepHeading>
              <ul className="grid divide-y divide-line border-y border-line">
                {chosen.map((l) => (
                  <li key={l.productId} className="flex items-center justify-between gap-4 py-3 text-[15px]">
                    <span className="min-w-0 truncate">
                      {picked[l.productId]} x {l.name}
                    </span>
                    <span className="tabular-nums">{formatAmount(fromCents(share(l, picked[l.productId]!)))}</span>
                  </li>
                ))}
              </ul>
              <dl className="grid gap-2 text-[15px]">
                <Row term="Reason">{RETURN_REASON_LABEL[reason]}</Row>
                {note.trim() && <Row term="Note">{note.trim()}</Row>}
                <Row term="Refund to">{method === 'card' ? 'Your card' : 'Store credit'}</Row>
                <Row term="Return label">{fee ? `${formatAmount(fromCents(fee))} off the refund` : 'Free'}</Row>
                {shipping > 0 && <Row term="Shipping back">{formatAmount(fromCents(shipping))}</Row>}
                <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
                  <dt className="font-semibold">Estimated refund</dt>
                  <dd className="text-xl font-bold tabular-nums" data-testid="return-estimate">
                    {formatAmount(fromCents(estimate))}
                  </dd>
                </div>
              </dl>
              <p className="text-[14px] text-ink-2">
                This assumes everything comes back as new. Opened items may have a restocking fee, and the final amount
                is set when we check the parcel.
              </p>
            </>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}>
                Back
              </Button>
            ) : (
              <span />
            )}
            {step < 3 ? (
              <Button onClick={next}>Continue</Button>
            ) : (
              <Button onClick={submit} busy={busy}>
                Send return request
              </Button>
            )}
          </div>
        </div>
        <ReturnPolicy />
      </div>
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-2">{term}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
