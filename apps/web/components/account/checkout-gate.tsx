'use client';
import { Lock, Path, SignIn } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/queries';
import { Skeleton } from '../ui/bits';
import { LinkButton } from '../ui/button';
import { ResendLink } from './token-pages';

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rise grid max-w-xl justify-items-start gap-4">
      <span className="grid size-12 place-items-center rounded-[2px] bg-brand-soft text-brand">{icon}</span>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="grid justify-items-start gap-5 leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

/** Checkout rules that already apply: sign in first (no guest checkout) and confirm the email address. */
export function CheckoutGate() {
  const { data: me, isPending } = useSession();
  if (isPending) {
    return (
      <div className="grid max-w-xl gap-4" aria-busy="true">
        <Skeleton className="size-12 rounded-[2px]" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-full" />
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
  return (
    <Panel icon={<Path className="size-6" />} title="Checkout opens in the next release">
      <p>
        This preview of the new Halden covers browsing, your cart and your account. Payment, shipping and orders arrive
        in the next release. Your cart is saved until then.
      </p>
      <LinkButton href="/cart" variant="outline">
        Back to your cart
      </LinkButton>
    </Panel>
  );
}
