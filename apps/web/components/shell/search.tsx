'use client';
// Search palette (Ctrl+K or /). Results come as you type, a short pause after the last key, and the
// previous request is cancelled so a slow answer never overwrites a newer one.
import type { ProductPage } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function SearchButton() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const show = () => {
    ref.current?.showModal();
    setOpen(true);
  };
  const hide = () => {
    ref.current?.close();
    setOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="press flex h-10 items-center gap-2 rounded-[2px] px-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink lg:border lg:border-line lg:bg-surface lg:pr-2 lg:pl-3.5"
        aria-label="Search the shop"
        aria-keyshortcuts="Control+K"
      >
        <MagnifyingGlass className="size-5" />
        <span className="hidden text-sm lg:inline">Search gear</span>
        <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-ink-3 lg:inline">
          Ctrl K
        </kbd>
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && hide()}
        aria-label="Search"
        className="pop mx-auto mt-[12vh] bg-surface w-[min(640px,calc(100vw-32px))] rounded-[2px] border border-line p-0 text-ink shadow-[var(--shadow-lift)]"
      >
        {open && <Palette onDone={hide} />}
      </dialog>
    </>
  );
}

function Palette({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductPage | null>(null);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/v1/products?q=${encodeURIComponent(term)}&limit=6`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<ProductPage>) : null))
        .then((page) => {
          setResults(page);
          setActive(-1);
        })
        .catch(() => {});
    }, 160);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    onDone();
    router.push(href);
  };
  const items = results?.items ?? [];

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Enter opens the highlighted product (picked with the arrow keys), otherwise searches for the words.
          const pick = items[active];
          if (pick) go(`/products/${pick.slug}`);
          else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
        className="flex items-center gap-3 border-b border-line px-4"
      >
        <MagnifyingGlass className="size-5 shrink-0 text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
          }}
          placeholder="Search tents, stoves, packs..."
          aria-label="Search products"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="search-results"
          aria-activedescendant={items[active] ? `sr-${items[active].id}` : undefined}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3"
        />
        <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
      </form>
      <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
        {q.trim().length >= 2 && results && items.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches "{q.trim()}". Try another word.</li>
        )}
        {items.map((p, i) => (
          <li key={p.id} id={`sr-${p.id}`} role="option" aria-selected={i === active}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(`/products/${p.slug}`)}
              className={`flex w-full items-center gap-3 rounded-[2px] p-2 text-left ${i === active ? 'bg-surface-2' : ''}`}
            >
              <Image
                src={p.image.url}
                alt=""
                width={48}
                height={48}
                sizes="48px"
                className="size-12 rounded-[2px] object-cover"
              />
              <span className="grid flex-1">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-ink-3">{p.category.name}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatAmount(p.price)}</span>
            </button>
          </li>
        ))}
        {results && results.total > items.length && (
          <li>
            <button
              type="button"
              onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}
              className="flex w-full items-center justify-between rounded-[2px] px-3 py-2.5 text-sm text-brand hover:bg-surface-2"
            >
              See all {results.total} results <ArrowRight className="size-4" />
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
