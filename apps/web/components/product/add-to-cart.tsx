'use client';
import type { ProductCard } from '@halden/contracts';
import { Check, Plus, ShoppingBag } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useCartActions } from '@/lib/queries';
import { preloadCartDrawer, useCartDrawer } from '../shell/cart-drawer';
import { QtyStepper } from '../shell/qty-stepper';
import { buttonClass, Spinner } from '../ui/button';
import { useToast } from '../ui/toast';

type State = 'idle' | 'busy' | 'added';

/** The label swaps in place: Add to cart, then a spinner, then a check. Feedback right where the click was. */
function useAdd(productId: string, name: string, openDrawer: boolean) {
  const { add } = useCartActions();
  const drawer = useCartDrawer();
  const toast = useToast();
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (state !== 'added') return;
    const t = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(t);
  }, [state]);

  const run = (qty: number) => {
    setState('busy');
    if (openDrawer) preloadCartDrawer();
    add.mutate(
      { productId, qty },
      {
        onSuccess: () => {
          setState('added');
          if (openDrawer) drawer.open();
          else toast.show(`${name} added to your cart`);
        },
        onError: (e) => {
          setState('idle');
          toast.show(e instanceof ApiError ? e.message : 'Could not add that. Try again.', 'error');
        },
      },
    );
  };
  return { state, run };
}

/** Each state's label rises in as it replaces the last (CSS animation keyed on the state). */
function Label({ state, children }: { state: State; children: React.ReactNode }) {
  return (
    <span key={state} className="swap-in inline-flex items-center gap-2">
      {state === 'busy' ? <Spinner /> : state === 'added' ? <Check weight="bold" className="size-[18px]" /> : null}
      {state === 'added' ? 'Added' : state === 'busy' ? 'Adding' : children}
    </span>
  );
}

export function BuyBox({ product }: { product: Pick<ProductCard, 'id' | 'name' | 'availability'> }) {
  const [qty, setQty] = useState(1);
  const { state, run } = useAdd(product.id, product.name, true);
  const soldOut = product.availability.status === 'out_of_stock';
  const max = Math.min(20, product.availability.available ?? 20);
  const box = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);

  // Dock the buy bar only while the main button is out of view, and only once it was scrolled past.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setDocked(!e!.isIntersecting && e!.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (soldOut) {
    return (
      <button type="button" disabled className={buttonClass('outline', 'lg', 'w-full')}>
        Sold out
      </button>
    );
  }
  return (
    <div ref={box} className="flex flex-wrap items-center gap-3">
      <QtyStepper qty={qty} max={max} onChange={setQty} label={product.name} />
      <button
        type="button"
        onClick={() => run(qty)}
        disabled={state === 'busy'}
        className={buttonClass('primary', 'lg', 'min-w-[11rem] flex-1 overflow-hidden')}
        data-testid="add-to-cart"
      >
        <Label state={state}>
          <ShoppingBag className="size-5" /> Add to cart
        </Label>
      </button>
      {/* Phones: once the button above scrolls away, the same action docks at the bottom of the screen. */}
      <div
        aria-hidden={!docked}
        inert={!docked}
        className={`fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line-strong bg-bg px-[var(--gutter)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:hidden ${
          docked ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-semibold">{product.name}</span>
          <span className="text-sm text-ink-3 tabular-nums">Qty {qty}</span>
        </div>
        <button
          type="button"
          onClick={() => run(qty)}
          disabled={state === 'busy'}
          className={buttonClass('primary', 'md', 'overflow-hidden')}
        >
          <Label state={state}>Add to cart</Label>
        </button>
      </div>
    </div>
  );
}

/** The small add button on a product card, shown on hover (always visible on touch screens). */
export function QuickAdd({ productId, name }: { productId: string; name: string }) {
  const { state, run } = useAdd(productId, name, false);
  return (
    <button
      type="button"
      onClick={() => run(1)}
      disabled={state === 'busy'}
      aria-label={`Add ${name} to cart`}
      className="press absolute right-3 bottom-3 grid size-11 place-items-center rounded-[2px] bg-surface text-ink opacity-100 transition-[opacity,background-color,color] duration-200 hover:bg-accent hover:text-accent-ink md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
    >
      {state === 'busy' ? (
        <Spinner />
      ) : state === 'added' ? (
        <Check weight="bold" className="size-5 text-brand" />
      ) : (
        <Plus weight="bold" className="size-5" />
      )}
    </button>
  );
}
