// The shop's price rules, in one pure function so every rule can be unit-tested:
//   subtotal   = sum of unit price x quantity
//   discount   = the coupon, on eligible lines only (not excluded categories; not sale items unless allowed),
//                percent or fixed amount, never more than the eligible subtotal. free_shipping gives no discount.
//   shipping   = the zone's rate for the method; standard is free from the zone's threshold, counted on the
//                subtotal after discount. A free_shipping coupon makes the chosen method free.
//   tax        = tax rate x (subtotal - discount), rounded half up once per order. Shipping is not taxed.
//   total      = subtotal - discount + shipping + tax
// Allocations: the discount is spread over eligible lines in proportion to their line totals, and the tax over
// all lines in proportion to (line total - its discount); leftover cents go to the largest remainders. The
// parts always add up exactly, so refunding part of an order later is exact.
import { allocate, fromCents, percentOf, toCents } from '@halden/money';

export type PricingLine = {
  productId: string;
  unitPrice: string;
  qty: number;
  categoryId: number;
  onSale: boolean;
};

export type PricingCoupon = {
  kind: 'percent' | 'fixed' | 'free_shipping';
  value: string;
  excludesSaleItems: boolean;
  excludedCategoryIds: number[];
};

export type PricingRate = { price: string; freeFrom: string | null };

export type PricingInput = {
  lines: PricingLine[];
  coupon: PricingCoupon | null;
  rate: PricingRate;
  taxRatePercent: number;
  /** Planted bugs that touch pricing (QA lab). */
  bugs?: { couponTwice?: boolean };
};

export type LinePrice = { productId: string; lineTotal: number; discount: number; tax: number };

export type PricingResult = {
  subtotal: number;
  /** Subtotal of the lines the coupon may discount. */
  eligibleSubtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  lines: LinePrice[];
  /** Cents more needed for free standard shipping, or null. */
  toFreeShipping: number | null;
};

export function isEligible(line: PricingLine, coupon: PricingCoupon): boolean {
  if (coupon.excludedCategoryIds.includes(line.categoryId)) return false;
  if (coupon.excludesSaleItems && line.onSale) return false;
  return true;
}

export function price(input: PricingInput): PricingResult {
  const { lines, coupon, rate, taxRatePercent } = input;
  const totals = lines.map((l) => toCents(l.unitPrice) * l.qty);
  const subtotal = totals.reduce((a, b) => a + b, 0);

  const eligible = lines.map((l) => (coupon ? isEligible(l, coupon) : false));
  const eligibleSubtotal = totals.reduce((n, t, i) => n + (eligible[i] ? t : 0), 0);

  let discount = 0;
  if (coupon && eligibleSubtotal > 0) {
    if (coupon.kind === 'percent') discount = percentOf(eligibleSubtotal, Number(coupon.value));
    else if (coupon.kind === 'fixed') discount = toCents(coupon.value);
    // Planted bug: with two or more eligible lines the discount is counted twice.
    if (input.bugs?.couponTwice && eligible.filter(Boolean).length >= 2) discount *= 2;
    discount = Math.min(discount, eligibleSubtotal);
  }

  const afterDiscount = subtotal - discount;
  const freeFrom = rate.freeFrom === null ? null : toCents(rate.freeFrom);
  const freeByThreshold = freeFrom !== null && afterDiscount >= freeFrom;
  const freeByCoupon = coupon?.kind === 'free_shipping' && eligibleSubtotal > 0;
  const shipping = lines.length === 0 || freeByThreshold || freeByCoupon ? 0 : toCents(rate.price);
  const tax = percentOf(afterDiscount, taxRatePercent);

  const discountParts = discount > 0 ? allocate(discount, totals.map((t, i) => (eligible[i] ? t : 0))) : totals.map(() => 0);
  const taxBase = totals.map((t, i) => t - (discountParts[i] ?? 0));
  const taxParts = tax > 0 ? allocate(tax, taxBase) : totals.map(() => 0);

  return {
    subtotal,
    eligibleSubtotal,
    discount,
    shipping,
    tax,
    total: afterDiscount + shipping + tax,
    lines: lines.map((l, i) => ({
      productId: l.productId,
      lineTotal: totals[i]!,
      discount: discountParts[i] ?? 0,
      tax: taxParts[i] ?? 0,
    })),
    toFreeShipping: shipping > 0 && freeFrom !== null && !freeByCoupon ? freeFrom - afterDiscount : null,
  };
}

export const amounts = (r: PricingResult, taxRatePercent: number) => ({
  subtotal: fromCents(r.subtotal),
  discount: fromCents(r.discount),
  shipping: fromCents(r.shipping),
  tax: fromCents(r.tax),
  taxRate: taxRatePercent.toFixed(2),
  total: fromCents(r.total),
});
