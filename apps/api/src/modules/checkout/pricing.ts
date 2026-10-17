// The shop's price rules, in one pure function so every rule can be unit-tested:
//   subtotal   = sum of unit price x quantity
//   discount   = the coupon, on eligible lines only (not excluded categories; not sale items unless allowed),
//                percent or fixed amount, never more than the eligible subtotal. free_shipping gives no discount.
//   shipping   = the zone's rate for the method; standard is free from the zone's threshold, counted on the
//                subtotal after discount. A free_shipping coupon makes the chosen method free.
//   points     = Halden Points redeemed after the coupon: 100 points = 5.00, at most half of (subtotal - discount)
//   tax        = tax rate x (subtotal - discount - points), rounded half up once per order. Shipping is not taxed.
//   total      = subtotal - discount - points + shipping + tax
// Allocations: the coupon discount is spread over eligible lines in proportion to their line totals, the points
// discount over all lines in proportion to (line total - coupon share), and the tax over all lines in proportion
// to what is left; leftover cents go to the largest remainders. The
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
  /** Halden Points to redeem (a multiple of 100); checked with maxRedeemablePoints first. */
  points?: number;
  /** Planted bugs that touch pricing (QA lab). */
  bugs?: { couponTwice?: boolean };
};

export type LinePrice = { productId: string; lineTotal: number; discount: number; points: number; tax: number };

export type PricingResult = {
  subtotal: number;
  /** Subtotal of the lines the coupon may discount. */
  eligibleSubtotal: number;
  discount: number;
  pointsDiscount: number;
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

  const pointsDiscount = Math.min(pointsToCents(input.points ?? 0), maxPointsDiscount(subtotal - discount));
  const afterDiscount = subtotal - discount - pointsDiscount;
  const freeFrom = rate.freeFrom === null ? null : toCents(rate.freeFrom);
  const freeByThreshold = freeFrom !== null && afterDiscount >= freeFrom;
  const freeByCoupon = coupon?.kind === 'free_shipping' && eligibleSubtotal > 0;
  const shipping = lines.length === 0 || freeByThreshold || freeByCoupon ? 0 : toCents(rate.price);
  const tax = percentOf(afterDiscount, taxRatePercent);

  const discountParts =
    discount > 0
      ? allocate(
          discount,
          totals.map((t, i) => (eligible[i] ? t : 0)),
        )
      : totals.map(() => 0);
  const afterCoupon = totals.map((t, i) => t - (discountParts[i] ?? 0));
  const pointsParts = pointsDiscount > 0 ? allocate(pointsDiscount, afterCoupon) : totals.map(() => 0);
  const taxBase = afterCoupon.map((t, i) => t - (pointsParts[i] ?? 0));
  const taxParts = tax > 0 ? allocate(tax, taxBase) : totals.map(() => 0);

  return {
    subtotal,
    eligibleSubtotal,
    discount,
    pointsDiscount,
    shipping,
    tax,
    total: afterDiscount + shipping + tax,
    lines: lines.map((l, i) => ({
      productId: l.productId,
      lineTotal: totals[i]!,
      discount: discountParts[i] ?? 0,
      points: pointsParts[i] ?? 0,
      tax: taxParts[i] ?? 0,
    })),
    toFreeShipping: shipping > 0 && freeFrom !== null && !freeByCoupon ? freeFrom - afterDiscount : null,
  };
}

/** 100 points take 5.00 off. */
export const POINTS_PER_BLOCK = 100;
export const CENTS_PER_BLOCK = 500;
export const pointsToCents = (points: number) => Math.floor(points / POINTS_PER_BLOCK) * CENTS_PER_BLOCK;
/** Points can pay at most half of the subtotal after the coupon, in whole 5.00 blocks. */
export const maxPointsDiscount = (afterCouponCents: number) =>
  Math.floor(Math.floor(afterCouponCents / 2) / CENTS_PER_BLOCK) * CENTS_PER_BLOCK;
export const maxRedeemablePoints = (afterCouponCents: number) =>
  (maxPointsDiscount(afterCouponCents) / CENTS_PER_BLOCK) * POINTS_PER_BLOCK;

export const amounts = (r: PricingResult, taxRatePercent: number) => ({
  subtotal: fromCents(r.subtotal),
  discount: fromCents(r.discount),
  pointsDiscount: fromCents(r.pointsDiscount),
  shipping: fromCents(r.shipping),
  tax: fromCents(r.tax),
  taxRate: taxRatePercent.toFixed(2),
  total: fromCents(r.total),
});
