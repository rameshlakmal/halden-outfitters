'use client';
// Filters live in the URL, so a filtered list can be shared, bookmarked and reloaded. Changes replace the
// URL inside a transition: the old grid stays visible (dimmed) until the new one is ready.
// Wide screens show every filter inline; phones get one row (Filters + Sort) and a bottom sheet.
import { Check, SlidersHorizontal, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useTransition } from 'react';
import { Listbox } from '../ui/listbox';

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
  const sheet = useRef<HTMLDialogElement>(null);

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false }));
  };
  const toggle = (key: string) => set({ [key]: params.get(key) === 'true' ? null : 'true' });
  const clear = () => set({ inStock: null, onSale: null, price: null });
  const qs = params.toString();
  const activeCount = ['inStock', 'onSale', 'price'].filter((k) => params.has(k)).length;
  const sort = (
    <Listbox
      label="Sort"
      value={params.get('sort') ?? 'featured'}
      options={SORTS}
      onChange={(v) => set({ sort: v === 'featured' ? null : v })}
      align="right"
    />
  );

  return (
    <div className="grid gap-4" data-pending={pending || undefined}>
      <nav
        aria-label="Categories"
        className="-mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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

      {/* Wide screens: every filter in one row. */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <Toggle on={params.get('inStock') === 'true'} onClick={() => toggle('inStock')}>
          In stock
        </Toggle>
        <Toggle on={params.get('onSale') === 'true'} onClick={() => toggle('onSale')}>
          On sale
        </Toggle>
        <Listbox
          label="Price"
          value={params.get('price') ?? ''}
          options={PRICE_BANDS}
          onChange={(v) => set({ price: v })}
        />
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clear}
            className="press inline-flex h-10 items-center gap-1 px-3 text-[12px] font-bold tracking-[0.08em] text-ink-2 uppercase hover:text-accent"
          >
            <X weight="bold" className="size-4" /> Clear filters
          </button>
        )}
        <div className="ml-auto">{sort}</div>
      </div>

      {/* Phones: Filters opens a bottom sheet; Sort stays one tap away. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => sheet.current?.showModal()}
          className="press inline-flex h-10 items-center gap-2 rounded-[2px] border border-line-strong bg-surface px-3.5 text-[12px] font-bold tracking-[0.08em] uppercase"
        >
          <SlidersHorizontal weight="bold" className="size-4" />
          Filters
          {activeCount > 0 && (
            <span className="grid size-5 place-items-center rounded-[2px] bg-accent text-[11px] text-accent-ink">
              {activeCount}
            </span>
          )}
        </button>
        {sort}
      </div>

      <dialog
        ref={sheet}
        aria-label="Filters"
        onClick={(e) => e.target === sheet.current && sheet.current?.close()}
        className="sheet fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none border-t border-line-strong bg-surface p-0 text-ink"
      >
        <div className="flex items-center justify-between border-b border-line px-[var(--gutter)] py-4">
          <h2 className="text-2xl">Filters</h2>
          <button
            type="button"
            onClick={() => sheet.current?.close()}
            className="press grid size-11 place-items-center rounded-[2px] hover:bg-surface-2"
            aria-label="Close filters"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="grid gap-6 px-[var(--gutter)] py-5">
          <div className="grid gap-2">
            <SheetRow on={params.get('inStock') === 'true'} onClick={() => toggle('inStock')}>
              In stock only
            </SheetRow>
            <SheetRow on={params.get('onSale') === 'true'} onClick={() => toggle('onSale')}>
              On sale
            </SheetRow>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-[12px] font-bold tracking-[0.08em] text-ink-3 uppercase">Price</legend>
            {PRICE_BANDS.map((b) => (
              <SheetRow
                key={b.value}
                on={(params.get('price') ?? '') === b.value}
                onClick={() => set({ price: b.value })}
              >
                {b.label}
              </SheetRow>
            ))}
          </fieldset>
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-line bg-surface px-[var(--gutter)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={clear}
            disabled={activeCount === 0}
            className="press h-12 rounded-[2px] border border-line-strong text-[13px] font-bold tracking-[0.06em] uppercase disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => sheet.current?.close()}
            className="press h-12 rounded-[2px] bg-accent text-[13px] font-bold tracking-[0.06em] text-accent-ink uppercase"
          >
            Show results
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`press inline-flex h-10 shrink-0 items-center rounded-[2px] border px-4 text-[12px] font-bold tracking-[0.08em] whitespace-nowrap uppercase ${
        active ? 'border-ink bg-ink text-bg' : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
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
      className={`press inline-flex h-10 items-center gap-1.5 rounded-[2px] border px-3.5 text-sm font-semibold ${
        on ? 'border-ink bg-ink text-bg' : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
      }`}
    >
      {on && <Check weight="bold" className="size-4 text-accent" />}
      {children}
    </button>
  );
}

function SheetRow({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`press flex h-12 items-center justify-between rounded-[2px] border px-4 text-left text-[15px] font-semibold ${
        on ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink'
      }`}
    >
      {children}
      {on && <Check weight="bold" className="size-5 text-accent" />}
    </button>
  );
}
