'use client';
// Filters live in the URL, so a filtered list can be shared, bookmarked and reloaded. Changes replace the
// URL inside a transition: the old grid stays visible (dimmed) until the new one is ready.
import { CaretDown, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export const PRICE_BANDS = [
  { value: '', label: 'Any price' },
  { value: '0-50', label: 'Under 50' },
  { value: '50-100', label: '50 to 100' },
  { value: '100-200', label: '100 to 200' },
  { value: '200-', label: '200 and up' },
];

const SORTS = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price, low to high' },
  { value: 'price-desc', label: 'Price, high to low' },
  { value: 'rating', label: 'Best rated' },
];

export function ShopToolbar({
  categories,
  current,
}: {
  categories: { slug: string; name: string }[];
  current: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false }));
  };
  const toggle = (key: string) => set({ [key]: params.get(key) === 'true' ? null : 'true' });
  const qs = params.toString();
  const active = ['inStock', 'onSale', 'price'].some((k) => params.has(k));

  return (
    <div className="grid gap-4" data-pending={pending || undefined}>
      <nav
        aria-label="Categories"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        <Chip href={`/shop${qs ? `?${qs}` : ''}`} active={current === null}>
          All gear
        </Chip>
        {categories.map((c) => (
          <Chip key={c.slug} href={`/shop/${c.slug}${qs ? `?${qs}` : ''}`} active={current === c.slug}>
            {c.name}
          </Chip>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <Toggle on={params.get('inStock') === 'true'} onClick={() => toggle('inStock')}>
          In stock
        </Toggle>
        <Toggle on={params.get('onSale') === 'true'} onClick={() => toggle('onSale')}>
          On sale
        </Toggle>
        <Dropdown
          label="Price"
          value={params.get('price') ?? ''}
          options={PRICE_BANDS}
          onChange={(v) => set({ price: v })}
        />
        {active && (
          <button
            type="button"
            onClick={() => set({ inStock: null, onSale: null, price: null })}
            className="press inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-ink-2 hover:text-ink"
          >
            <X className="size-4" /> Clear filters
          </button>
        )}
        <div className="ml-auto">
          <Dropdown
            label="Sort"
            value={params.get('sort') ?? 'featured'}
            options={SORTS}
            onChange={(v) => set({ sort: v === 'featured' ? null : v })}
          />
        </div>
      </div>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`press shrink-0 rounded-full border px-4 py-2 text-sm whitespace-nowrap ${
        active
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`press h-9 rounded-full border px-4 text-sm ${
        on
          ? 'border-brand bg-brand-soft font-medium text-brand'
          : 'border-line-strong bg-surface text-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="relative inline-flex h-9 items-center rounded-full border border-line-strong bg-surface pr-8 pl-4 text-sm text-ink-2 hover:text-ink">
      <span className="mr-1.5 text-ink-3">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent font-medium text-ink outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown className="pointer-events-none absolute right-3 size-4 text-ink-3" />
    </label>
  );
}
