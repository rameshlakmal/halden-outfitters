'use client';
// One line of the cart, shared by the drawer and the cart page. Removing it slides it out, then the lines
// below close the gap in a view transition (see lib/queries.ts).
import type { CartLine } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { Trash } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { slideOut } from '@/lib/motion';
import { useCartActions } from '@/lib/queries';
import { useToast } from '../ui/toast';
import { QtyStepper } from './qty-stepper';

const PROBLEM: Record<NonNullable<CartLine['problem']>, string> = {
  unavailable: 'No longer sold. Please remove it.',
  out_of_stock: 'Sold out. Please remove it.',
  not_enough_stock: 'Fewer left than you chose. Lower the quantity.',
};

export function DrawerLine({ line, onNavigate, list }: { line: CartLine; onNavigate?: () => void; list: string }) {
  const { setQty, remove } = useCartActions();
  const toast = useToast();
  const ref = useRef<HTMLLIElement>(null);
  const [removing, setRemoving] = useState(false);
  const busy = setQty.isPending || remove.isPending || removing;
  const fail = (e: unknown) => toast.show(e instanceof ApiError ? e.message : 'That did not work. Try again.', 'error');
  const max = line.availability.available ?? 20;

  return (
    <li
      ref={ref}
      className="enter vt-line flex gap-3 py-4 min-[380px]:gap-4"
      style={{ viewTransitionName: `${list}-line-${line.productId}` }}
    >
      <Link href={`/products/${line.slug}`} onClick={onNavigate} className="shrink-0">
        <Image
          src={line.image.url}
          alt={line.image.alt}
          width={80}
          height={80}
          sizes="80px"
          className="size-16 rounded-[2px] bg-surface-2 object-cover min-[380px]:size-20"
        />
      </Link>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/products/${line.slug}`}
            onClick={onNavigate}
            className="truncate font-medium transition-colors duration-150 hover:text-accent pointer-coarse:py-2.5"
          >
            {line.name}
          </Link>
          <span className="font-semibold tabular-nums">{formatAmount(line.lineTotal)}</span>
        </div>
        <span className="text-sm text-ink-3 tabular-nums">{formatAmount(line.unitPrice)} each</span>
        {line.problem && <span className="text-[13px] font-medium text-danger">{PROBLEM[line.problem]}</span>}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <QtyStepper
            qty={line.qty}
            max={Math.max(line.qty, Math.min(20, max))}
            disabled={busy || line.problem === 'unavailable' || line.problem === 'out_of_stock'}
            onChange={(qty) => setQty.mutate({ productId: line.productId, qty }, { onError: fail })}
            label={line.name}
          />
          <button
            type="button"
            onClick={async () => {
              // Slide the line out first, then drop it; the lines below close the gap in a view transition.
              setRemoving(true);
              await slideOut(ref.current);
              remove.mutate(line.productId, {
                onError: (e) => {
                  ref.current?.getAnimations().forEach((a) => a.cancel());
                  setRemoving(false);
                  fail(e);
                },
              });
            }}
            disabled={busy}
            className="press inline-flex min-h-9 items-center gap-1 rounded-[2px] px-2 text-[13px] text-ink-3 hover:text-danger pointer-coarse:min-h-11"
          >
            <Trash className="size-4" /> Remove
          </button>
        </div>
      </div>
    </li>
  );
}
