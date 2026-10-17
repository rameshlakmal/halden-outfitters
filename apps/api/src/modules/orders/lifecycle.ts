// The order state machine. Every status change goes through `transition`, which refuses anything not listed
// here (409 invalid_transition).
//
//   pending_payment -> confirmed     card authorized (directly, or after the bank step)
//   pending_payment -> cancelled     card failed, payment timed out (30 min), or cancelled
//   confirmed       -> packed        warehouse
//   confirmed       -> cancelled     customer, support, admin
//   packed          -> shipped       warehouse; the card is charged (captured) now
//   packed          -> cancelled     support, admin
//   shipped         -> delivered     warehouse (carrier confirmed)
//   delivered       -> completed     30 days after delivery with no open return (applied lazily)
import type { OrderAction, OrderStatus, Role } from '@halden/contracts';

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

export const canMove = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from].includes(to);

/** Statuses in which each kind of person may cancel. Shipped orders are never cancelled: they're returned. */
export const CANCELLABLE_BY: Record<'customer' | 'support' | 'admin', OrderStatus[]> = {
  customer: ['pending_payment', 'confirmed'],
  support: ['pending_payment', 'confirmed', 'packed'],
  admin: ['pending_payment', 'confirmed', 'packed'],
};

export const PAYMENT_MINUTES = 30;

export type Viewer = { id: string; role: Role; isOwner: boolean };

/** What this viewer may do with an order in this status. The UI shows exactly these actions. */
export function allowedActions(status: OrderStatus, viewer: Viewer): OrderAction[] {
  const actions: OrderAction[] = [];
  const staffCancel = viewer.role === 'support' || viewer.role === 'admin';
  if (viewer.isOwner && status === 'pending_payment') actions.push('pay');
  if ((viewer.isOwner && CANCELLABLE_BY.customer.includes(status)) || (staffCancel && CANCELLABLE_BY.support.includes(status))) {
    actions.push('cancel');
  }
  const warehouse = viewer.role === 'warehouse' || viewer.role === 'admin';
  if (warehouse && status === 'confirmed') actions.push('pack');
  if (warehouse && status === 'packed') actions.push('ship');
  if (warehouse && status === 'shipped') actions.push('deliver');
  return actions;
}

/**
 * The last day a delivered order can be returned (inclusive): 30 days after delivery. Orders delivered from
 * 15 November to 31 December can be returned until 31 January (holiday policy). Days are calendar days in UTC.
 */
export function returnWindowEnds(deliveredAt: Date): Date {
  const day = Date.UTC(deliveredAt.getUTCFullYear(), deliveredAt.getUTCMonth(), deliveredAt.getUTCDate());
  const normal = new Date(day + 30 * 86400_000);
  const m = deliveredAt.getUTCMonth();
  const d = deliveredAt.getUTCDate();
  if ((m === 10 && d >= 15) || m === 11) {
    const holiday = new Date(Date.UTC(deliveredAt.getUTCFullYear() + 1, 0, 31));
    return holiday > normal ? holiday : normal;
  }
  return normal;
}

/** True once the return window has fully passed (the day after its last day has begun). */
export const returnWindowClosed = (deliveredAt: Date, now: Date) =>
  now.getTime() >= returnWindowEnds(deliveredAt).getTime() + 86400_000;
