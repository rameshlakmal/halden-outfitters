'use client';
// Coupon management (admin): create, schedule, limit, switch on and off. A coupon's code, kind and value are fixed
// once created (orders keep pointing at them); everything else can change. Every change is in the audit log.
import { formatAmount } from '@halden/money';
import { Plus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, get, patch, post } from '@/lib/api';
import { formatDate } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type Coupon, staffKeys, useCoupons } from './api';
import { Dialog, EmptyRow, ErrorRow, inputClass, PageHead, SkeletonRows, Table, Td, Th } from './ui';

type Kind = Coupon['kind'];
const KIND_LABEL: Record<Kind, string> = {
  percent: 'Percent off',
  fixed: 'Amount off',
  free_shipping: 'Free shipping',
};

const what = (c: Coupon) =>
  c.kind === 'percent'
    ? `${Number(c.value)}% off`
    : c.kind === 'fixed'
      ? `${formatAmount(c.value)} off`
      : 'Free shipping';

/** Where the coupon is in its life, for the shopper at this moment (browser time; the shop clock may run ahead). */
function state(c: Coupon, now = Date.now()): { label: string; tone: string } {
  if (!c.active) return { label: 'Off', tone: 'bg-surface-2 text-ink-3' };
  if (c.startsAt && new Date(c.startsAt).getTime() > now)
    return { label: 'Scheduled', tone: 'bg-surface-2 text-ink-2' };
  if (c.endsAt && new Date(c.endsAt).getTime() <= now) return { label: 'Ended', tone: 'bg-surface-2 text-ink-3' };
  if (c.maxUses !== null && c.uses >= c.maxUses) return { label: 'Used up', tone: 'bg-danger-soft text-danger' };
  return { label: 'Live', tone: 'bg-brand-soft text-accent-text' };
}

const rules = (c: Coupon) =>
  [
    c.minSubtotal && `from ${formatAmount(c.minSubtotal)}`,
    c.perCustomerLimit && `${c.perCustomerLimit} per customer`,
    c.firstOrderOnly && 'first order only',
    c.excludesSaleItems && 'not on sale items',
    c.excludedCategories.length > 0 && `not ${c.excludedCategories.join(', ')}`,
  ]
    .filter(Boolean)
    .join(', ');

export function Coupons() {
  const q = useCoupons();
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);

  const items = q.data?.items ?? [];
  return (
    <>
      <PageHead
        title="Coupons"
        sub="Codes shoppers type at checkout. One coupon per order; placed orders keep their discount."
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-4" weight="bold" />}
            onClick={() => setEditing('new')}
          >
            New coupon
          </Button>
        }
      />
      <Table label="Coupons">
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Gives</Th>
            <Th>Rules</Th>
            <Th>Runs</Th>
            <Th className="text-right">Uses</Th>
            <Th>State</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.isPending && <SkeletonRows cols={7} rows={5} />}
          {q.isError && <ErrorRow cols={7} error={q.error} retry={() => void q.refetch()} />}
          {q.isSuccess && items.length === 0 && <EmptyRow cols={7}>No coupons yet. Create the first one.</EmptyRow>}
          {items.map((c) => {
            const s = state(c);
            return (
              <tr key={c.code} data-testid="coupon-row">
                <Td>
                  <p className="tabular font-semibold">{c.code}</p>
                  <p className="max-w-56 truncate text-xs text-ink-3">{c.description}</p>
                </Td>
                <Td className="whitespace-nowrap">{what(c)}</Td>
                <Td className="max-w-64 text-ink-2">{rules(c) || 'none'}</Td>
                <Td className="whitespace-nowrap text-ink-2">
                  {c.startsAt ? formatDate(c.startsAt) : 'now'} to {c.endsAt ? formatDate(c.endsAt) : 'no end'}
                </Td>
                <Td className="tabular text-right whitespace-nowrap">
                  {c.uses}
                  {c.maxUses !== null && <span className="text-ink-3"> / {c.maxUses}</span>}
                </Td>
                <Td>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <CouponSwitch coupon={c} />
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {editing && <CouponForm coupon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** A date-time input value ("2026-12-01T09:00") from an ISO string, in the browser's time zone. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function CouponForm({ coupon: c, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => get<{ items: { slug: string; name: string }[] }>('/categories'),
    staleTime: 300_000,
  });
  const [kind, setKind] = useState<Kind>(c?.kind ?? 'percent');
  const [excluded, setExcluded] = useState<string[]>(c?.excludedCategories ?? []);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (name: string) => {
      const v = String(f.get(name) ?? '').trim();
      return v === '' ? null : Number(v);
    };
    const amount = (name: string) => {
      const v = String(f.get(name) ?? '').trim();
      return v === '' ? null : Number(v).toFixed(2);
    };
    const shared = {
      description: String(f.get('description') ?? '').trim(),
      minSubtotal: amount('minSubtotal'),
      maxUses: num('maxUses'),
      perCustomerLimit: num('perCustomerLimit'),
      firstOrderOnly: f.get('firstOrderOnly') === 'on',
      excludesSaleItems: f.get('excludesSaleItems') === 'on',
      startsAt: fromLocal(String(f.get('startsAt') ?? '')),
      endsAt: fromLocal(String(f.get('endsAt') ?? '')),
      active: f.get('active') === 'on',
    };
    setBusy(true);
    setError(null);
    setFields({});
    try {
      if (c) {
        await patch(`/staff/coupons/${c.code}`, shared);
        toast.show(`${c.code} saved`);
      } else {
        const created = await post<Coupon>('/staff/coupons', {
          ...shared,
          code: String(f.get('code') ?? ''),
          kind,
          value: kind === 'free_shipping' ? '0.00' : (amount('value') ?? ''),
          excludedCategories: excluded,
        });
        toast.show(`${created.code} created`);
      }
      void qc.invalidateQueries({ queryKey: staffKeys.coupons });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setFields(err.fields);
        setError('Please check the highlighted fields.');
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const label = 'grid gap-1.5 text-[13px] font-medium';
  const fieldError = (name: string) =>
    fields[name] ? <span className="text-[12.5px] font-normal text-danger">{fields[name]}</span> : null;
  const invalid = (name: string) => (fields[name] ? `${inputClass} border-danger` : inputClass);

  return (
    <Dialog open onClose={onClose} title={c ? `Edit ${c.code}` : 'New coupon'}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <label className={label}>
            Code
            <input
              name="code"
              className={`${invalid('code')} uppercase`}
              defaultValue={c?.code}
              disabled={!!c}
              placeholder="SUMMER15"
              autoComplete="off"
            />
            {fieldError('code')}
          </label>
          <label className={label}>
            Kind
            <select
              className={inputClass}
              value={kind}
              disabled={!!c}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {kind !== 'free_shipping' && (
          <label className={label}>
            {kind === 'percent' ? 'Percent off (1 to 100)' : 'Amount off'}
            <input
              name="value"
              className={invalid('value')}
              inputMode="decimal"
              defaultValue={c ? Number(c.value).toString() : ''}
              disabled={!!c}
            />
            {fieldError('value')}
          </label>
        )}
        {c && (
          <p className="-mt-2 text-[12.5px] text-ink-3">
            Code, kind and value are fixed. Make a new coupon to change them.
          </p>
        )}
        <label className={label}>
          Description (staff only)
          <input name="description" className={invalid('description')} defaultValue={c?.description} maxLength={200} />
          {fieldError('description')}
        </label>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-[13px] font-semibold">Limits</legend>
          <label className={label}>
            Minimum spend
            <input
              name="minSubtotal"
              className={invalid('minSubtotal')}
              inputMode="decimal"
              defaultValue={c?.minSubtotal ?? ''}
              placeholder="None"
            />
            {fieldError('minSubtotal')}
          </label>
          <label className={label}>
            Total uses
            <input
              name="maxUses"
              className={invalid('maxUses')}
              inputMode="numeric"
              defaultValue={c?.maxUses ?? ''}
              placeholder="No limit"
            />
            {fieldError('maxUses')}
          </label>
          <label className={label}>
            Uses per customer
            <input
              name="perCustomerLimit"
              className={invalid('perCustomerLimit')}
              inputMode="numeric"
              defaultValue={c?.perCustomerLimit ?? ''}
              placeholder="No limit"
            />
            {fieldError('perCustomerLimit')}
          </label>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-[13px] font-semibold">Schedule (your time zone)</legend>
          <label className={label}>
            Starts
            <input
              name="startsAt"
              type="datetime-local"
              className={invalid('startsAt')}
              defaultValue={toLocal(c?.startsAt ?? null)}
            />
            {fieldError('startsAt')}
          </label>
          <label className={label}>
            Ends
            <input
              name="endsAt"
              type="datetime-local"
              className={invalid('endsAt')}
              defaultValue={toLocal(c?.endsAt ?? null)}
            />
            {fieldError('endsAt')}
          </label>
        </fieldset>

        <fieldset className="grid gap-2 text-[14px]">
          <legend className="mb-1 text-[13px] font-semibold">Rules</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="firstOrderOnly" defaultChecked={c?.firstOrderOnly ?? false} /> First order only
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="excludesSaleItems" defaultChecked={c?.excludesSaleItems ?? true} /> Not on sale
            items
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={c?.active ?? true} /> Switched on
          </label>
        </fieldset>

        {!c && (
          <fieldset className="grid gap-2 text-[14px]">
            <legend className="mb-1 text-[13px] font-semibold">Not for these categories</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(categories.data?.items ?? []).map((cat) => (
                <label key={cat.slug} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={excluded.includes(cat.slug)}
                    onChange={(e) =>
                      setExcluded((x) => (e.target.checked ? [...x, cat.slug] : x.filter((s) => s !== cat.slug)))
                    }
                  />
                  {cat.name}
                </label>
              ))}
            </div>
            {fieldError('excludedCategories')}
          </fieldset>
        )}

        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" size="sm" busy={busy}>
            {c ? 'Save' : 'Create coupon'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The on/off switch of one coupon. It keeps its own state, set in the click itself: the query cache tells React about
 * changes a moment later, and a controlled checkbox that doesn't change during its click is put back by React.
 */
function CouponSwitch({ coupon: c }: { coupon: Coupon }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [on, setOn] = useState(c.active);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) setOn(c.active);
  }, [c.active, busy]);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    setBusy(true);
    // A list refresh already on its way would bring back the old value: cancel it, keeping what's shown.
    void qc.cancelQueries({ queryKey: staffKeys.coupons }, { revert: false });
    try {
      const saved = await patch<Coupon>(`/staff/coupons/${c.code}`, { active: next });
      qc.setQueryData<{ items: Coupon[] }>(
        staffKeys.coupons,
        (old) => old && { items: old.items.map((x) => (x.code === saved.code ? saved : x)) },
      );
      setOn(saved.active);
      toast.show(`${c.code} ${saved.active ? 'switched on' : 'switched off'}`);
    } catch (err) {
      setOn(!next);
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="mr-2 inline-flex items-center gap-2 text-[13px] text-ink-2">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={busy}
        onChange={() => void toggle()}
        className="size-4"
        aria-label={`${c.code} ${on ? 'on' : 'off'}`}
      />
      On
    </label>
  );
}
