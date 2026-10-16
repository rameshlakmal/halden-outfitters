'use client';
import type { ProductCard } from '@halden/contracts';
import { Check, Plus, ShoppingBag } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
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

  if (soldOut) {
    return (
      <button type="button" disabled className={buttonClass('outline', 'lg', 'w-full')}>
        Sold out
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <QtyStepper qty={qty} max={max} onChange={setQty} label={product.name} />
      <button
        type="button"
        onClick={() => run(qty)}
        disabled={state === 'busy'}
        className={buttonClass('primary', 'lg', 'flex-1 overflow-hidden')}
        data-testid="add-to-cart"
      >
        <Label state={state}>
          <ShoppingBag className="size-5" /> Add to cart
        </Label>
      </button>
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
      className="press glass absolute right-3 bottom-3 grid size-11 place-items-center rounded-full border border-line text-ink opacity-100 shadow-[var(--shadow-soft)] transition-opacity duration-200 hover:bg-surface md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
    >
      {state === 'busy' ? (
        <Spinner />
      ) : state === 'added' ? (
        <Check weight="bold" className="size-5 text-forest" />
      ) : (
        <Plus weight="bold" className="size-5" />
      )}
    </button>
  );
}
