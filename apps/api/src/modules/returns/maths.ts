// Refund maths for returns (DESIGN.md 3.4). Everything is in cents. Checkout stored each line's share of the
// coupon discount, the points discount and the tax, so a return of some units of a line refunds exactly what was
// paid for those units:
//
//   line refund = units' share of (line total - coupon share - points share + tax share)
//   points back = units' share of the points share, as points (100 points = 5.00, so 1 point = 5 cents)
//
// A unit's share is taken so that returning a line in several returns adds up to the line exactly: units
// before..before+n get round(x * (before + n) / qty) - round(x * before / qty).
import { CENTS_PER_BLOCK, POINTS_PER_BLOCK } from '../checkout/pricing.js';

export const LABEL_FEE_CENTS = 495;
export const RESTOCKING_PERCENT = 15;
export const AUTO_APPROVE_LIMIT_CENTS = 15_000;
export const REVIEW_AFTER_RETURNS = 3;
export const LABEL_DAYS = 14;

const CENTS_PER_POINT = CENTS_PER_BLOCK / POINTS_PER_BLOCK;

export type LineMoney = {
  qty: number;
  lineTotal: number;
  discount: number;
  points: number;
  tax: number;
  pointsEarned: number;
};

/** The share of `amount` belonging to units before..before+n of a line of `qty` units. */
export function unitShare(amount: number, qty: number, before: number, n: number): number {
  if (qty <= 0 || n <= 0) return 0;
  return Math.round((amount * (before + n)) / qty) - Math.round((amount * before) / qty);
}

export type UnitRefund = { cash: number; pointsBack: number; pointsEarned: number };

/**
 * What n units of a line are worth when returned, `before` units of it having been refunded already.
 * Planted bug refund_ignores_discount leaves the coupon share in.
 */
export function unitRefund(
  l: LineMoney,
  before: number,
  n: number,
  opts: { ignoreDiscount?: boolean } = {},
): UnitRefund {
  const s = (x: number) => unitShare(x, l.qty, before, n);
  const points = s(l.points);
  return {
    cash: s(l.lineTotal) - (opts.ignoreDiscount ? 0 : s(l.discount)) - points + s(l.tax),
    pointsBack: Math.round(points / CENTS_PER_POINT),
    pointsEarned: unitShare(l.pointsEarned, l.qty, before, n),
  };
}

export type Condition = 'as_new' | 'opened' | 'damaged_by_customer' | 'faulty';

/** One returned line after inspection: damaged-by-customer lines get nothing, opened ones pay a restocking fee. */
export function gradedLine(cash: number, pointsBack: number, condition: Condition, shopFault: boolean) {
  if (condition === 'damaged_by_customer') return { refund: 0, restockingFee: 0, pointsBack: 0 };
  const restockingFee = condition === 'opened' && !shopFault ? Math.round((cash * RESTOCKING_PERCENT) / 100) : 0;
  return { refund: cash - restockingFee, restockingFee, pointsBack };
}

/** Return-level total: lines minus the label fee, plus shipping when it's owed. Never below zero. */
export function returnTotal(lines: number[], labelFee: number, shippingRefund: number) {
  const goods = lines.reduce((a, b) => a + b, 0);
  const fee = Math.min(labelFee, goods);
  return { labelFee: fee, total: goods - fee + shippingRefund };
}

/** Whether the restocked stock comes back to the shelf. Planted bug restock_damaged puts everything back. */
export const restocks = (condition: Condition, restockDamaged: boolean) =>
  condition === 'as_new' || condition === 'opened' || restockDamaged;
