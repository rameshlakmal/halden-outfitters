'use client';
// Admin settings: shipping rates and the tax rate (coupons have their own page). Placed orders keep what they were
// charged; changes apply to new quotes and are written to the audit log.
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, put } from '@/lib/api';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type Rate, staffKeys, useRates, useTax } from './api';
import { ErrorBox, ErrorRow, inputClass, PageHead, Panel, SkeletonRows, Table, Td, Th } from './ui';

export function Settings() {
  return (
    <>
      <PageHead title="Settings" sub="Changes apply to new orders. Placed orders keep what they were charged." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Rates />
        <Tax />
      </div>
    </>
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
      <label className="grid gap-1.5 text-[13px] font-medium">
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
