'use client';
// Order status as a chip, and as a timeline that draws its line up to the current step.
import type { Order, OrderStatus } from '@halden/contracts';
import { Check, X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { animate } from '@/lib/motion';
import { formatDateTime, REASON_LABEL, STATUS_LABEL } from '@/lib/orders';

const CHIP: Record<OrderStatus, string> = {
  // Open orders in the accent tag, finished ones neutral (as on the dashboard).
  pending_payment: 'border-transparent bg-brand-soft text-accent-text',
  confirmed: 'border-transparent bg-brand-soft text-accent-text',
  packed: 'border-transparent bg-brand-soft text-accent-text',
  shipped: 'border-transparent bg-brand-soft text-accent-text',
  delivered: 'border-transparent bg-surface-2 text-ink-2',
  completed: 'border-transparent bg-surface-2 text-ink-2',
  cancelled: 'border-transparent bg-danger-soft text-danger',
};

export const chipClass = (tone: string) =>
  `inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap ${tone}`;

export function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={chipClass(CHIP[status])}>{STATUS_LABEL[status]}</span>;
}

const STEPS: OrderStatus[] = ['confirmed', 'packed', 'shipped', 'delivered'];

/** Placed, then the four steps. A cancelled order shows where it stopped and why. */
export function Timeline({ order }: { order: Order }) {
  const line = useRef<HTMLDivElement>(null);
  const reached = (s: OrderStatus) => order.events.find((e) => e.to === s);
  const cancelled = order.status === 'cancelled';
  const status = order.status === 'completed' ? 'delivered' : order.status;
  const index = cancelled ? -1 : STEPS.indexOf(status);
  const progress = cancelled || index < 0 ? 0 : index / (STEPS.length - 1);

  // The line draws itself to the current step (transform only).
  useEffect(() => {
    void animate(line.current, [{ transform: 'scaleX(0)' }, { transform: `scaleX(${progress})` }], {
      duration: 700,
      fill: 'forwards',
    });
  }, [progress]);

  if (cancelled) {
    const at = order.cancel?.at ?? order.events.at(-1)?.at;
    return (
      <div className="grid gap-2 rounded-[var(--radius-field)] border border-line p-4">
        <p className="flex items-center gap-2 font-semibold">
          <X weight="bold" className="size-5 text-danger" /> Cancelled{at ? ` ${formatDateTime(at)}` : ''}
        </p>
        {order.cancel && <p className="text-sm text-ink-2">{REASON_LABEL[order.cancel.reason]}</p>}
        <p className="text-sm text-ink-2">Nothing was charged. Any hold on your card has been released.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-4 right-[12.5%] left-[12.5%] h-0.5 bg-line" aria-hidden="true">
        <div ref={line} className="h-full origin-left bg-accent" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <ol className="relative grid grid-cols-4">
        {STEPS.map((s, i) => {
          const done = i <= index;
          const event = reached(s);
          return (
            <li key={s} className="grid justify-items-center gap-2 text-center">
              <span
                className={`grid size-8 place-items-center rounded-[var(--radius-field)] border-2 ${
                  done ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-bg text-ink-3'
                }`}
                aria-hidden="true"
              >
                {done ? <Check weight="bold" className="size-4" /> : <span className="size-1.5 bg-current" />}
              </span>
              <span className={`text-[11px] font-bold ${done ? 'text-ink' : 'text-ink-3'}`}>{STATUS_LABEL[s]}</span>
              <span className="text-[12px] text-ink-3">{event ? formatDateTime(event.at) : ''}</span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only">Status: {STATUS_LABEL[order.status]}</p>
    </div>
  );
}
