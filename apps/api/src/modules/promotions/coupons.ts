// Coupon rules. A code can be used when all of these hold:
//   - it exists, is active, and the shop clock is inside its start and end dates
//   - at least one cart line is eligible (excluded categories and, by default, sale items don't count)
//   - the eligible subtotal reaches its minimum
//   - it has uses left in total (max_uses) and for this customer (per_customer_limit)
//   - first_order_only codes: the customer has no earlier order that wasn't cancelled
// Uses are counted from coupon_redemptions that haven't been released; cancelling an order releases its use.
import { fromCents, toCents } from '@halden/money';
import type { Queryable } from '../../core/db.js';
import type { PricingCoupon } from '../checkout/pricing.js';

export type CouponRow = {
  code: string;
  kind: 'percent' | 'fixed' | 'free_shipping';
  value: string;
  min_subtotal: string;
  max_uses: number | null;
  per_customer_limit: number | null;
  first_order_only: boolean;
  excludes_sale_items: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  active: boolean;
  excluded_category_ids: number[];
  uses: number;
  customer_uses: number;
  customer_orders: number;
};

/** The coupon with its usage, for one customer (customerId may be null for a signed-out cart). */
export async function loadCoupon(
  db: Queryable,
  code: string,
  customerId: string | null,
  lock = false,
): Promise<CouponRow | undefined> {
  const { rows } = await db.query<CouponRow>(
    `SELECT c.code, c.kind, c.value, c.min_subtotal, c.max_uses, c.per_customer_limit, c.first_order_only,
            c.excludes_sale_items, c.starts_at, c.ends_at, c.active,
            coalesce((SELECT array_agg(category_id) FROM coupon_excluded_categories x WHERE x.coupon_code = c.code), '{}') AS excluded_category_ids,
            (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_code = c.code AND r.released_at IS NULL) AS uses,
            (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_code = c.code AND r.released_at IS NULL
                AND r.customer_id = $2) AS customer_uses,
            (SELECT count(*)::int FROM orders o WHERE o.customer_id = $2 AND o.status <> 'cancelled') AS customer_orders
       FROM coupons c WHERE c.code = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [code, customerId],
  );
  return rows[0];
}

export const toPricingCoupon = (c: CouponRow): PricingCoupon => ({
  kind: c.kind,
  value: c.value,
  excludesSaleItems: c.excludes_sale_items,
  excludedCategoryIds: c.excluded_category_ids,
});

export type CouponBugs = { limitIgnored: boolean; customerLimitIgnored: boolean };

/** Why the coupon can't be used now, or null when it can. */
export function couponProblem(
  c: CouponRow | undefined,
  ctx: { now: Date; eligibleSubtotalCents: number; signedIn: boolean; bugs: CouponBugs },
): string | null {
  if (!c) return 'That code is not valid.';
  if (!c.active) return 'This code is no longer active.';
  if (c.starts_at && c.starts_at > ctx.now) return 'This code is not valid yet.';
  if (c.ends_at && c.ends_at <= ctx.now) return 'This code has expired.';
  if (ctx.eligibleSubtotalCents <= 0) return 'Nothing in your cart can use this code (sale items and some categories are excluded).';
  if (ctx.eligibleSubtotalCents < toCents(c.min_subtotal)) {
    return `This code needs ${c.min_subtotal} of eligible items (you have ${fromCents(ctx.eligibleSubtotalCents)}).`;
  }
  // Planted bug: coupon_limit_ignored.
  if (c.max_uses !== null && c.uses >= c.max_uses && !ctx.bugs.limitIgnored) return 'This code has been used up.';
  if (ctx.signedIn) {
    // Planted bug: coupon_customer_limit_ignored.
    if (c.per_customer_limit !== null && c.customer_uses >= c.per_customer_limit && !ctx.bugs.customerLimitIgnored) {
      return c.per_customer_limit === 1 ? 'You have already used this code.' : 'You have used this code as often as allowed.';
    }
    if (c.first_order_only && c.customer_orders > 0) return 'This code is for a first order only.';
  }
  return null;
}
