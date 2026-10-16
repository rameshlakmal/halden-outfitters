'use client';
// The product grid on listing pages. The first page is rendered on the server; "Show more" fetches the next
// pages with the same filters. Each card is a named <ViewTransition>: when the filters change (a navigation),
// cards that stay glide to their new place, new ones fade in and removed ones fade out. That's the browser's
// View Transitions API, so no animation library is downloaded.
import type { ProductPage } from '@halden/contracts';
import { startTransition, useState, ViewTransition } from 'react';
import { Button } from '../ui/button';
import { ProductCard } from './product-card';

// Only plain (untyped) transitions reflow the grid; product navigations use the photo morph instead.
const MOVE = { 'nav-forward': 'none', 'nav-back': 'none', default: 'grid-move' } as const;
const ENTER = { 'nav-forward': 'none', 'nav-back': 'none', default: 'grid-enter' } as const;
const EXIT = { 'nav-forward': 'none', 'nav-back': 'none', default: 'grid-exit' } as const;

export function ProductGrid({ initial, query }: { initial: ProductPage; query: string }) {
  // Extra pages belong to one query; a new query (new filters) starts again from the server's first page.
  const [more, setMore] = useState<{ query: string; page: ProductPage | null; items: ProductPage['items'] }>({
    query,
    page: null,
    items: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const extra = more.query === query ? more : { query, page: null, items: [] };
  const items = [...initial.items, ...extra.items];
  const nextCursor = extra.page ? extra.page.nextCursor : initial.nextCursor;

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoading(true);
    setError(false);
    try {
      const qs = new URLSearchParams(query);
      qs.set('cursor', nextCursor);
      const res = await fetch(`/api/v1/products?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as ProductPage;
      // In a transition, so the new cards get their enter animation.
      startTransition(() => setMore({ query, page, items: [...extra.items, ...page.items] }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4" aria-live="polite">
        {items.map((p, i) => (
          <ViewTransition key={p.id} name={`card-${p.id}`} share={MOVE} enter={ENTER} exit={EXIT} default="none">
            <li>
              <ProductCard product={p} priority={i < 2} />
            </li>
          </ViewTransition>
        ))}
      </ul>
      <div className="mt-12 grid justify-items-center gap-3">
        <p className="text-sm text-ink-3">
          Showing {items.length} of {initial.total}
        </p>
        {nextCursor && (
          <Button variant="outline" onClick={loadMore} busy={loading}>
            Show more
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            Could not load more products. Try again.
          </p>
        )}
      </div>
    </div>
  );
}
