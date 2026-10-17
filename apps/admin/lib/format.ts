// Display helpers. Amounts come from the API as "1234.50" strings and are shown the way the shop shows them:
// two decimals, no currency symbol (DESIGN.md: v1's currency display).
import type { OrderStatus, ReturnReason } from '@halden/contracts';

const grouped = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-US');

export const money = (amount: string) => grouped.format(Number(amount));
export const count = (n: number | string) => whole.format(Number(n));

/** "+12.4%" against the previous period, or null when there is nothing to compare with. */
export function change(value: string, previous: string): { text: string; up: boolean } | null {
  const v = Number(value);
  const p = Number(previous);
  if (!Number.isFinite(v) || !Number.isFinite(p) || p === 0) return null;
  const pct = ((v - p) / p) * 100;
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, up: pct >= 0 };
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting bank',
  confirmed: 'Confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Orders still moving through the shop; the rest are finished. */
export const OPEN_STATUSES: OrderStatus[] = ['pending_payment', 'confirmed', 'packed', 'shipped'];

export const REASON_LABEL: Record<ReturnReason, string> = {
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  changed_mind: 'Changed mind',
  too_small: 'Too small',
  too_large: 'Too large',
  not_needed: 'Not needed',
  other: 'Other',
};

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const when = (iso: string) => dateTime.format(new Date(iso));
export const day = (yyyyMmDd: string) => shortDay.format(new Date(`${yyyyMmDd}T00:00:00Z`));
