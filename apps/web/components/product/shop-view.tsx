import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { Suspense, ViewTransition } from 'react';
import { getCategories, getProducts } from '@/lib/server-api';
import { PAGE_ENTER } from '@/lib/transitions';
import { LinkButton } from '../ui/button';
import { ProductGrid } from './product-grid';
import { ShopToolbar } from './shop-toolbar';

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Turns the page's URL filters into the API's query (unknown values are dropped, not passed through). */
export function apiQuery(search: Search, category: string | null): URLSearchParams {
  const q = new URLSearchParams();
  if (category) q.set('category', category);
  const text = one(search.q)?.trim().slice(0, 80);
  if (text) q.set('q', text);
  const sort = one(search.sort);
  if (sort && ['newest', 'price-asc', 'price-desc', 'rating'].includes(sort)) q.set('sort', sort);
  if (one(search.inStock) === 'true') q.set('inStock', 'true');
  if (one(search.onSale) === 'true') q.set('onSale', 'true');
  const band = /^(\d+)-(\d*)$/.exec(one(search.price) ?? '');
  if (band) {
    if (band[1] !== '0') q.set('minPrice', band[1]!);
    if (band[2]) q.set('maxPrice', band[2]);
  }
  q.set('limit', '12');
  return q;
}

export async function ShopView({
  search,
  category,
  title,
  blurb,
}: {
  search: Search;
  category: string | null;
  title: string;
  blurb?: string;
}) {
  const query = apiQuery(search, category);
  const [categories, page] = await Promise.all([getCategories(), getProducts(Object.fromEntries(query))]);
  const searching = query.has('q');

  return (
    <ViewTransition enter={PAGE_ENTER} exit="none" default="none">
      <div className="group/shop mx-auto max-w-[1400px] px-4 pt-10 sm:px-6 lg:px-8">
        <header className="mb-8 grid gap-3">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1>
          {blurb && <p className="max-w-[60ch] text-lg text-ink-2">{blurb}</p>}
          <p className="text-sm text-ink-3">
            {page.total} {page.total === 1 ? 'product' : 'products'}
            {page.priceRange && page.total > 1 && ` from ${page.priceRange.min} to ${page.priceRange.max}`}
          </p>
        </header>
        {!searching && (
          <div className="mb-8">
            <Suspense>
              <ShopToolbar categories={categories} current={category} />
            </Suspense>
          </div>
        )}
        <div className="transition-opacity duration-200 group-has-[[data-pending]]/shop:opacity-55">
          {page.total === 0 ? (
            <div className="grid justify-items-center gap-3 rounded-[2px] border border-dashed border-line-strong px-6 py-20 text-center">
              <MagnifyingGlass className="size-10 text-ink-3" weight="thin" />
              <p className="text-lg font-medium">
                Nothing matches {searching ? `"${query.get('q')}"` : 'these filters'}
              </p>
              <p className="max-w-[44ch] text-ink-2">
                {searching
                  ? 'Try a shorter or more general word, like "tent" or "stove".'
                  : 'Clear a filter or two to see more gear.'}
              </p>
              <LinkButton href={category ? `/shop/${category}` : '/shop'} variant="outline" className="mt-2">
                {searching ? 'Browse all gear' : 'Clear filters'}
              </LinkButton>
            </div>
          ) : (
            <ProductGrid initial={page} query={query.toString()} />
          )}
        </div>
      </div>
    </ViewTransition>
  );
}
