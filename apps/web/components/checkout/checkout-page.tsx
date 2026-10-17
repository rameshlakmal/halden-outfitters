'use client';
// Checkout rules on the page: sign in first (no guest checkout), confirm the email, have something in the cart.
// Then the three steps (checkout-flow.tsx).
import { Lock, ShoppingBagOpen, SignIn } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useCart, useSession } from '@/lib/queries';
import { ResendLink } from '../account/token-pages';
import { Skeleton } from '../ui/bits';
import { LinkButton } from '../ui/button';
import { CheckoutFlow } from './checkout-flow';

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rise grid max-w-xl justify-items-start gap-4">
      <span className="grid size-12 place-items-center rounded-[2px] border border-line-strong text-accent">
        {icon}
      </span>
      <h1 className="text-4xl">{title}</h1>
      <div className="grid justify-items-start gap-5 leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

export function CheckoutPage() {
  const session = useSession();
  const cart = useCart();
  const me = session.data;

  if (session.isPending || (me && cart.isPending)) {
    return (
      <div
        className="grid gap-8 md:grid-cols-[minmax(0,1fr)_380px]"
        role="status"
        aria-busy="true"
        aria-label="Loading checkout"
      >
        <div className="grid content-start gap-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="hidden h-80 md:block" />
      </div>
    );
  }
  if (!me) {
    return (
      <Panel icon={<SignIn className="size-6" />} title="Sign in to check out">
        <p>Checkout needs an account, so you can track your order and return items later. Your cart comes with you.</p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/sign-in?next=/checkout">Sign in</LinkButton>
          <LinkButton href="/register?next=/checkout" variant="outline">
            Create an account
          </LinkButton>
        </div>
      </Panel>
    );
  }
  if (!me.emailVerified) {
    return (
      <Panel icon={<Lock className="size-6" />} title="Confirm your email first">
        <p>
          We sent a confirmation link to <strong className="text-ink">{me.email}</strong>. Open it, then come back to
          check out.
        </p>
        <ResendLink variant="primary" />
      </Panel>
    );
  }
  if (!cart.data || cart.data.lines.length === 0) {
    return (
      <Panel icon={<ShoppingBagOpen className="size-6" />} title="Your cart is empty">
        <p>Add something for your next night out, then come back here.</p>
        <LinkButton href="/shop">Browse the shop</LinkButton>
      </Panel>
    );
  }
  return <CheckoutFlow cart={cart.data} />;
}
