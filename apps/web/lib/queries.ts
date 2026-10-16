'use client';
// Session and cart state for the client. Both are per-visitor, so they're fetched in the browser and the
// pages themselves stay cacheable.
import type { Cart, Me } from '@halden/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from './api';
import { withViewTransition } from './motion';

export const keys = { session: ['session'] as const, cart: ['cart'] as const };

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: () => get<{ customer: Me | null }>('/auth/session').then((r) => r.customer),
    staleTime: 60_000,
  });
}

export function useCart() {
  return useQuery({ queryKey: keys.cart, queryFn: () => get<Cart>('/cart'), staleTime: 15_000 });
}

export function useCartActions() {
  const qc = useQueryClient();
  const set = (cart: Cart) => qc.setQueryData(keys.cart, cart);
  return {
    add: useMutation({
      mutationFn: (v: { productId: string; qty: number }) => post<Cart>('/cart/items', v),
      onSuccess: set,
    }),
    setQty: useMutation({
      mutationFn: (v: { productId: string; qty: number }) => patch<Cart>(`/cart/items/${v.productId}`, { qty: v.qty }),
      onSuccess: set,
    }),
    // The removed line has already slid out; the rest move up inside a view transition.
    remove: useMutation({
      mutationFn: (productId: string) => del<Cart>(`/cart/items/${productId}`),
      onSuccess: (cart) => withViewTransition(() => set(cart)),
    }),
  };
}

/** After sign-in, sign-out or registration: the session and the (merged) cart both changed. */
export function useRefreshVisitor() {
  const qc = useQueryClient();
  return async (customer?: Me | null) => {
    if (customer !== undefined) qc.setQueryData(keys.session, customer);
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.session }),
      qc.invalidateQueries({ queryKey: keys.cart }),
    ]);
  };
}
