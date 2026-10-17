'use client';
// Admin settings: coupons, shipping rates and the tax rate. Placed orders keep what they were charged; changes
// apply to new quotes and are written to the audit log.
import { formatAmount } from '@halden/money';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, patch, put } from '@/lib/api';
import { formatDate } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type Coupon, type Rate, staffKeys, useCoupons, useRates, useTax } from './api';
import { Dialog, EmptyRow, ErrorBox, ErrorRow, inputClass, PageHead, Panel, SkeletonRows, Table, Td, Th } from './ui';

export function Settings() {
  return (
    <>
      <PageHead title="Settings" sub="Changes apply to new orders. Placed orders keep what they were charged." />
      <Coupons />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Rates />
        <Tax />
      </div>
    </>
  );
}

const couponValue = (c: Coupon) =>
  c.kind === 'percent'
    ? `${Number(c.value)}% off`
    : c.kind === 'fixed'
      ? `${formatAmount(c.value)} off`
      : 'Free shipping';

function Coupons() {
  const q = useCoupons();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (c: Coupon) => {
    setBusy(c.code);
    try {
      await patch(`/staff/coupons/${c.code}`, { active: !c.active });
      toast.show(`${c.code} ${c.active ? 'switched off' : 'switched on'}`);
      void qc.invalidateQueries({ queryKey: staffKeys.coupons });
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="coupons">
      <h2 id="coupons" className="text-[22px]">
        Coupons
      </h2>
      <Table label="Coupons">
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Gives</Th>
            <Th>Rules</Th>
            <Th className="text-right">Used</Th>
            <Th>Ends</Th>
            <Th>On</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={7} rows={5} />
          ) : q.isError ? (
            <ErrorRow cols={7} error={q.error} retry={() => void q.refetch()} />
          ) : q.data.items.length === 0 ? (
            <EmptyRow cols={7}>No coupons.</EmptyRow>
          ) : (
            q.data.items.map((c) => (
              <tr key={c.code} className={c.active ? '' : 'text-ink-3'}>
                <Td className="font-bold">{c.code}</Td>
                <Td className="whitespace-nowrap">{couponValue(c)}</Td>
                <Td className="text-ink-2">
                  {[
                    c.minSubtotal && `from ${formatAmount(c.minSubtotal)}`,
                    c.perCustomerLimit && `${c.perCustomerLimit} per customer`,
                    c.firstOrderOnly && 'first order',
                    !c.excludesSaleItems && 'sale items too',
                  ]
                    .filter(Boolean)
                    .join(', ') || c.description}
                </Td>
                <Td className="text-right tabular-nums">
                  {c.uses}
                  {c.maxUses ? ` of ${c.maxUses}` : ''}
                </Td>
                <Td className="whitespace-nowrap">{c.endsAt ? formatDate(c.endsAt) : 'Never'}</Td>
                <Td>
                  <label className="inline-flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={c.active}
                      disabled={busy === c.code}
                      onChange={() => void toggle(c)}
                      className="size-4 accent-[var(--accent)]"
                      aria-label={`${c.code} active`}
                    />
                  </label>
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      {editing && <CouponDialog coupon={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function CouponDialog({ coupon: c, onClose }: { coupon: Coupon; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [maxUses, setMaxUses] = useState(c.maxUses ? String(c.maxUses) : '');
  const [endsAt, setEndsAt] = useState(c.endsAt ? c.endsAt.slice(0, 10) : '');
  const [description, setDescription] = useState(c.description);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const uses = maxUses.trim() === '' ? null : Number(maxUses);
    if (uses !== null && (!Number.isInteger(uses) || uses < 1))
      return setError('Use limit: a whole number of 1 or more, or empty for no limit.');
    if (description.trim().length < 3) return setError('Description: at least 3 characters.');
    setBusy(true);
    setError(null);
    try {
      await patch(`/staff/coupons/${c.code}`, {
        maxUses: uses,
        // The end of that day in UTC, so the code works all day.
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : null,
        description: description.trim(),
      });
      toast.show(`${c.code} saved`);
      void qc.invalidateQueries({ queryKey: staffKeys.coupons });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && Object.keys(err.fields).length
          ? Object.values(err.fields).join(' ')
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Edit ${c.code}`}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Description
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
            Use limit
            <input
              className={inputClass}
              inputMode="numeric"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="No limit"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
            Last day
            <input className={inputClass} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
        <p className="text-[13px] text-ink-3">Used {c.uses} times so far. Cancelled orders give their use back.</p>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" size="sm" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Rates() {
  const q = useRates();
  return (
    <section className="grid min-w-0 content-start gap-3" aria-labelledby="rates">
      <h2 id="rates" className="text-[22px]">
        Shipping rates
      </h2>
      <Table label="Shipping rates">
        <thead>
          <tr>
            <Th>Zone</Th>
            <Th>Method</Th>
            <Th>Days</Th>
            <Th>Price</Th>
            <Th>Free from</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={6} rows={5} />
          ) : q.isError ? (
            <ErrorRow cols={6} error={q.error} retry={() => void q.refetch()} />
          ) : (
            q.data.items.map((r) => <RateRow key={`${r.zone}/${r.method}`} rate={r} />)
          )}
        </tbody>
      </Table>
    </section>
  );
}

function RateRow({ rate: r }: { rate: Rate }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [price, setPrice] = useState(r.price);
  const [freeFrom, setFreeFrom] = useState(r.freeFrom ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = price !== r.price || freeFrom !== (r.freeFrom ?? '');
  const ok = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok(price) || (freeFrom.trim() !== '' && !ok(freeFrom)))
      return setError('Amounts like 7.95; leave Free from empty for never.');
    setBusy(true);
    setError(null);
    try {
      await put(`/staff/shipping-rates/${r.zone}/${r.method}`, {
        price: Number(price).toFixed(2),
        freeFrom: freeFrom.trim() === '' ? null : Number(freeFrom).toFixed(2),
      });
      toast.show(`${r.zoneName} ${r.method} saved`);
      void qc.invalidateQueries({ queryKey: staffKeys.rates });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const form = `rate-${r.zone}-${r.method}`;
  return (
    <tr>
      <Td className="font-semibold">{r.zoneName}</Td>
      <Td className="capitalize">{r.method}</Td>
      <Td className="whitespace-nowrap text-ink-2">
        {r.daysMin} to {r.daysMax}
      </Td>
      <Td>
        <input
          form={form}
          className={`${inputClass} w-24`}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-label={`${r.zoneName} ${r.method} price`}
        />
      </Td>
      <Td>
        <input
          form={form}
          className={`${inputClass} w-24`}
          inputMode="decimal"
          value={freeFrom}
          onChange={(e) => setFreeFrom(e.target.value)}
          placeholder="Never"
          aria-label={`${r.zoneName} ${r.method} free from`}
        />
        {error && <span className="mt-1 block text-[12px] text-danger">{error}</span>}
      </Td>
      <Td className="text-right">
        <form id={form} onSubmit={save}>
          <Button type="submit" size="sm" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} busy={busy}>
            Save
          </Button>
        </form>
      </Td>
    </tr>
  );
}

function Tax() {
  const q = useTax();
  return (
    <Panel title="Tax rate">
      {q.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : q.isError ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : (
        <TaxForm key={q.data.ratePercent} current={q.data.ratePercent} />
      )}
    </Panel>
  );
}

function TaxForm({ current }: { current: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rate, setRate] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(rate.trim())) return setError('A percentage like 8 or 7.5.');
    setBusy(true);
    setError(null);
    try {
      const saved = await put<{ ratePercent: string }>('/staff/tax', { ratePercent: rate.trim() });
      qc.setQueryData(staffKeys.tax, saved);
      toast.show(`Tax is now ${saved.ratePercent}%`);
    } catch (err) {
      setError(err instanceof ApiError && err.fields.ratePercent ? err.fields.ratePercent : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <p className="text-[13px] text-ink-2">Charged on goods after discounts, not on shipping.</p>
      <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
        Percent
        <input
          className={`${inputClass} w-28`}
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && <FormAlert>{error}</FormAlert>}
      <div>
        <Button type="submit" size="sm" busy={busy} disabled={rate.trim() === current}>
          Save
        </Button>
      </div>
    </form>
  );
}
