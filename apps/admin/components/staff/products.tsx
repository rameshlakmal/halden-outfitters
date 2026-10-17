'use client';
// Products for staff: stock at a glance, and one product's details (admin edits them with optimistic locking:
// the save carries the version that was loaded, and a newer save by someone else is never overwritten).
import type { StaffProduct } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { MagnifyingGlass, Plus, WarningCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useDeferredValue, useEffect, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';
import { useSession } from '@/lib/queries';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button, LinkButton } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { send, STOCK_REASON_LABEL, staffKeys, useMovements, useStaffProduct, useStaffProducts } from './api';
import {
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
  Td,
  textareaClass,
  Th,
} from './ui';

const low = (p: StaffProduct) => p.stock.available <= p.stock.lowStockThreshold;

export function ProductList() {
  const { data: me } = useSession();
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  // The dashboard's low-stock tile links here with ?low=1 (read after mount, so server and browser render alike).
  useEffect(() => {
    if (new URLSearchParams(location.search).has('low')) setLowOnly(true);
  }, []);
  const q = useStaffProducts(useDeferredValue(search.trim()), lowOnly);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHead
        title="Products"
        sub="Available is on hand minus what open orders hold."
        actions={
          me?.role === 'admin' && (
            <LinkButton href="/products/new" size="sm" variant="primary">
              <Plus className="size-4" weight="bold" /> New product
            </LinkButton>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full max-w-sm">
          <span className="sr-only">Search products by name or SKU</span>
          <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <input
            className={`${inputClass} pl-8`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or SKU"
            type="search"
          />
        </label>
        <label className="flex min-h-9 items-center gap-2 text-[13px] font-semibold pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Low stock only
        </label>
      </div>
      <Table label="Products">
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>SKU</Th>
            <Th>Category</Th>
            <Th className="text-right">Price</Th>
            <Th className="text-right">On hand</Th>
            <Th className="text-right">Held</Th>
            <Th className="text-right">Available</Th>
            <Th>State</Th>
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={8} />
          ) : q.isError ? (
            <ErrorRow cols={8} error={q.error} retry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyRow cols={8}>{lowOnly ? 'Nothing is low on stock.' : 'No products match.'}</EmptyRow>
          ) : (
            rows.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2">
                <Td>
                  <RowLink href={`/products/${p.id}`}>{p.name}</RowLink>
                </Td>
                <Td className="text-ink-2">{p.sku}</Td>
                <Td className="text-ink-2">{p.category.name}</Td>
                <Td className="text-right tabular-nums">
                  {formatAmount(p.price)}
                  {p.compareAtPrice && (
                    <span className="ml-1.5 text-ink-3 line-through">{formatAmount(p.compareAtPrice)}</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{p.stock.onHand}</Td>
                <Td className="text-right tabular-nums text-ink-2">{p.stock.reserved || ''}</Td>
                <Td className={`text-right font-semibold tabular-nums ${low(p) ? 'text-danger' : ''}`}>
                  {low(p) && (
                    <WarningCircle weight="bold" className="mr-1 inline size-3.5 align-[-2px]" aria-label="Low stock" />
                  )}
                  {p.stock.available}
                </Td>
                <Td className="text-ink-2">{p.active ? 'On sale' : 'Hidden'}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <LoadMore hasNext={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
    </>
  );
}

export function StaffProductDetail({ id }: { id: string }) {
  const q = useStaffProduct(id);
  const { data: me } = useSession();
  if (q.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const p = q.data;
  const canStock = me?.role === 'warehouse' || me?.role === 'admin';
  return (
    <>
      <PageHead
        title={p.name}
        sub={`${p.sku} · ${p.category.name} · version ${p.version}, saved ${formatDateTime(p.updatedAt)}`}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {me?.role === 'admin' ? <EditForm key={p.version} product={p} /> : <ReadOnly product={p} />}
        </div>
        <div className="grid content-start gap-5">
          <Panel title="Stock">
            <Facts
              rows={[
                ['On hand', String(p.stock.onHand)],
                ['Held for orders', String(p.stock.reserved)],
                [
                  'Available',
                  <span key="a" className={`font-semibold ${low(p) ? 'text-danger' : ''}`}>
                    {p.stock.available}
                    {low(p) ? ` (at or under ${p.stock.lowStockThreshold})` : ''}
                  </span>,
                ],
              ]}
            />
            {canStock && <StockForm product={p} />}
          </Panel>
          <Movements id={p.id} />
        </div>
      </div>
    </>
  );
}

function ReadOnly({ product: p }: { product: StaffProduct }) {
  return (
    <Panel title="Details">
      <p className="text-[13px] text-ink-3">Only admins can edit products.</p>
      <Facts
        rows={[
          ['Price', formatAmount(p.price)],
          ['Old price', p.compareAtPrice ? formatAmount(p.compareAtPrice) : 'None (not on sale)'],
          ['Summary', p.summary],
          ['Shown in shop', p.active ? 'Yes' : 'No'],
          ['Featured', p.featured ? 'Yes' : 'No'],
          ['Returnable', p.returnable ? 'Yes' : 'No, final sale'],
          ['Low stock at', String(p.stock.lowStockThreshold)],
        ]}
      />
    </Panel>
  );
}

type Draft = {
  name: string;
  summary: string;
  description: string;
  price: string;
  compareAtPrice: string;
  active: boolean;
  featured: boolean;
  returnable: boolean;
  lowStockThreshold: string;
};

const toDraft = (p: StaffProduct): Draft => ({
  name: p.name,
  summary: p.summary,
  description: p.description,
  price: p.price,
  compareAtPrice: p.compareAtPrice ?? '',
  active: p.active,
  featured: p.featured,
  returnable: p.returnable,
  lowStockThreshold: String(p.stock.lowStockThreshold),
});

const amount = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Number(s).toFixed(2) : null);

function EditForm({ product }: { product: StaffProduct }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const original = toDraft(product);
    const next: Record<string, string> = {};
    const price = amount(draft.price);
    if (!price || Number(price) <= 0) next.price = 'A price above 0.00.';
    const compare = draft.compareAtPrice.trim() === '' ? null : amount(draft.compareAtPrice);
    if (draft.compareAtPrice.trim() !== '' && !compare) next.compareAtPrice = 'An amount like 75.00, or empty.';
    const threshold = Number(draft.lowStockThreshold);
    if (!Number.isInteger(threshold) || threshold < 0) next.lowStockThreshold = 'A whole number, 0 or more.';
    setErrors(next);
    if (Object.keys(next).length) return;

    const edit: Record<string, unknown> = {};
    for (const k of ['name', 'summary', 'description', 'active', 'featured', 'returnable'] as const) {
      if (draft[k] !== original[k]) edit[k] = typeof draft[k] === 'string' ? (draft[k] as string).trim() : draft[k];
    }
    if (price !== product.price) edit.price = price;
    if (compare !== product.compareAtPrice) edit.compareAtPrice = compare;
    if (threshold !== product.stock.lowStockThreshold) edit.lowStockThreshold = threshold;
    if (Object.keys(edit).length === 0) return setFormError('Nothing has changed.');

    setBusy(true);
    setFormError(null);
    try {
      const saved = await send<StaffProduct>('PATCH', `/staff/products/${product.id}`, edit, {
        'if-match': `"${product.version}"`,
      });
      qc.setQueryData(staffKeys.product(product.id), saved);
      void qc.invalidateQueries({ queryKey: ['staff', 'products'] });
      toast.show('Product saved');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'precondition_failed') setConflict(err.message);
      else if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const text = (k: 'name' | 'summary', label: string) => (
    <label className="grid gap-1.5 text-[13px] font-medium">
      {label}
      <input
        className={inputClass}
        value={draft[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      />
      {errors[k] && <span className="text-[13px] font-medium text-danger">{errors[k]}</span>}
    </label>
  );
  const money = (k: 'price' | 'compareAtPrice' | 'lowStockThreshold', label: string, hint?: string) => (
    <label className="grid content-start gap-1.5 text-[13px] font-medium">
      {label}
      <input
        className={inputClass}
        inputMode={k === 'lowStockThreshold' ? 'numeric' : 'decimal'}
        value={draft[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      />
      {errors[k] ? (
        <span className="text-[13px] font-medium text-danger">{errors[k]}</span>
      ) : (
        hint && <span className="text-[12px] font-normal text-ink-3">{hint}</span>
      )}
    </label>
  );
  const check = (k: 'active' | 'featured' | 'returnable', label: string) => (
    <label className="flex min-h-9 items-center gap-2 text-[14px] pointer-coarse:min-h-11">
      <input
        type="checkbox"
        checked={draft[k]}
        onChange={(e) => set(k, e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} noValidate>
      <Panel title="Details">
        {conflict && (
          <div
            role="alert"
            className="grid gap-2 rounded-[var(--radius-field)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            <p className="font-semibold">Someone else saved this product.</p>
            <p>{conflict} Your changes were not saved. Reload to see their version, then make your change again.</p>
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void qc.invalidateQueries({ queryKey: staffKeys.product(product.id) })}
              >
                Reload the product
              </Button>
            </div>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {text('name', 'Name')}
          {text('summary', 'Summary')}
        </div>
        <label className="grid gap-1.5 text-[13px] font-medium">
          Description
          <textarea
            className={`${textareaClass} min-h-32`}
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
          />
          {errors.description && <span className="text-[13px] font-medium text-danger">{errors.description}</span>}
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          {money('price', 'Price', 'Placed orders keep their price.')}
          {money('compareAtPrice', 'Old price', 'Set it to show the product on sale.')}
          {money('lowStockThreshold', 'Low stock at')}
        </div>
        <div className="flex flex-wrap gap-x-6">
          {check('active', 'Shown in the shop')}
          {check('featured', 'Featured')}
          {check('returnable', 'Returnable')}
        </div>
        {formError && (
          <FormAlert tone={formError === 'Nothing has changed.' ? 'info' : 'danger'}>{formError}</FormAlert>
        )}
        <div className="flex justify-end">
          <Button type="submit" busy={busy} disabled={!!conflict}>
            Save
          </Button>
        </div>
      </Panel>
    </form>
  );
}

function StockForm({ product }: { product: StaffProduct }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<keyof typeof STOCK_REASON_LABEL>('restock');
  const [change, setChange] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let n = Number(change);
    if (!Number.isInteger(n) || n === 0) return setError('A whole number of units, not 0.');
    // Restocks add, write-offs remove: the sign follows the reason, so the number can be typed either way.
    if (reason === 'restock') n = Math.abs(n);
    if (reason === 'write_off') n = -Math.abs(n);
    setBusy(true);
    setError(null);
    try {
      const saved = await post<StaffProduct>(`/staff/products/${product.id}/stock`, {
        change: n,
        reason,
        note: note.trim() || undefined,
      });
      qc.setQueryData(staffKeys.product(product.id), saved);
      void qc.invalidateQueries({ queryKey: staffKeys.movements(product.id) });
      void qc.invalidateQueries({ queryKey: ['staff', 'products'] });
      toast.show(`${n > 0 ? '+' : ''}${n} ${STOCK_REASON_LABEL[reason].toLowerCase()}`);
      setChange('');
      setNote('');
    } catch (err) {
      setError(err instanceof ApiError && err.fields.change ? err.fields.change : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-[13px] font-medium">
          Change
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            {Object.entries(STOCK_REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[13px] font-medium">
          Units {reason === 'adjustment' && <span className="font-normal text-ink-3">+ or -</span>}
          <input
            className={inputClass}
            inputMode="numeric"
            value={change}
            onChange={(e) => setChange(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </label>
      </div>
      <label className="grid gap-1.5 text-[13px] font-medium">
        Note <span className="font-normal text-ink-3">optional</span>
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </label>
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" size="sm" busy={busy}>
        Record
      </Button>
    </form>
  );
}

function Movements({ id }: { id: string }) {
  const q = useMovements(id);
  return (
    <Panel title="Movements">
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : q.isError ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="text-[13px] text-ink-2">No movements yet.</p>
      ) : (
        <ol className="grid divide-y divide-line text-[13px]">
          {q.data.items.map((m, i) => (
            <li key={i} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 py-1.5">
              <span className={`text-right font-bold tabular-nums ${m.change < 0 ? 'text-danger' : ''}`}>
                {m.change > 0 ? '+' : ''}
                {m.change}
              </span>
              <span className="min-w-0">
                <span className="font-semibold capitalize">{m.reason.replace('_', ' ')}</span>
                {m.orderId && <span className="text-ink-2"> order #{m.orderId}</span>}
                {m.note && <span className="text-ink-2">: {m.note}</span>}
                <span className="block text-ink-3">
                  {formatDateTime(m.at)}
                  {m.by ? `, ${m.by}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
