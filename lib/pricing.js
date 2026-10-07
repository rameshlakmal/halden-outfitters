// @ts-check
// The shop's price rules, in one place:
//   subtotal  = sum of unit price × quantity
//   discount  = the coupon (percent or fixed amount, never more than the subtotal)
//   shipping  = 7.95, free when subtotal minus discount is 75.00 or more
//   tax       = 8% of subtotal minus discount, rounded half up to the cent
//   total     = subtotal - discount + shipping + tax
import { fromCents, percentOf, toCents } from './money.js';

export const SHIPPING_CENTS = 795;
export const FREE_SHIPPING_FROM_CENTS = 7500;
export const TAX_PERCENT = 8;

/**
 * @typedef {{ kind: 'percent' | 'fixed', value: string, min_subtotal: string, max_uses: number | null, used_count: number, active: boolean, expires_at: Date | null, code: string }} Coupon
 * @typedef {{ unitPrice: string, qty: number }} Line
 */

/**
 * Why a coupon can't be used now, or null when it can.
 * @param {Coupon} coupon
 * @param {number} subtotalCents
 * @param {Set<string>} bugs
 */
export function couponProblem(coupon, subtotalCents, bugs) {
  if (!coupon.active) return 'This code is no longer active.';
  if (coupon.expires_at && coupon.expires_at.getTime() < Date.now()) return 'This code has expired.';
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses && !bugs.has('coupon_limit_ignored')) {
    return 'This code has been used up.';
  }
  if (subtotalCents < toCents(coupon.min_subtotal)) return `This code needs an order of at least ${coupon.min_subtotal}.`;
  return null;
}

/**
 * @param {Line[]} lines
 * @param {Coupon | null} coupon  already checked with couponProblem
 * @param {Set<string>} bugs
 */
export function priceCart(lines, coupon, bugs) {
  const subtotal = lines.reduce((n, l) => n + toCents(l.unitPrice) * l.qty, 0);

  let discount = 0;
  if (coupon) {
    discount = coupon.kind === 'percent' ? percentOf(subtotal, Number(coupon.value)) : toCents(coupon.value);
    if (bugs.has('coupon_twice') && lines.length >= 2) discount *= 2; // planted bug
    discount = Math.min(discount, subtotal);
  }

  const afterDiscount = subtotal - discount;
  const shipping = lines.length === 0 || afterDiscount >= FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
  const tax = percentOf(afterDiscount, TAX_PERCENT);
  const total = afterDiscount + shipping + tax;

  return {
    subtotal: fromCents(subtotal),
    discount: fromCents(discount),
    shipping: fromCents(shipping),
    tax: fromCents(tax),
    total: fromCents(total),
    /** How much more for free shipping, or null when it already applies. */
    toFreeShipping: shipping === 0 ? null : fromCents(FREE_SHIPPING_FROM_CENTS - afterDiscount),
  };
}
