// The coupon on a cart. Applying checks the code against the cart right away and refuses codes that can't be
// used; a code already on the cart is re-checked every time the cart is shown (it may have expired or run
// out since), and its discount is estimated from the eligible lines. Checkout checks it once more, locked.
import type { Cart } from '@halden/contracts';
import { fromCents } from '@halden/money';
import type { Bugs } from '../../core/bugs.js';
import type { Db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { price } from '../checkout/pricing.js';
import { couponProblem, loadCoupon, toPricingCoupon } from '../promotions/coupons.js';

type Line = { productId: string; unitPrice: string; qty: number; categoryId: number; onSale: boolean };

async function lines(db: Db, cartId: string): Promise<Line[]> {
  const rows = await db.query<{ product_id: string; price: string; qty: number; category_id: number; on_sale: boolean }>(
    `SELECT p.id AS product_id, p.price, ci.qty, p.category_id, p.compare_at_price IS NOT NULL AS on_sale
       FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = $1`,
    [cartId],
  );
  return rows.map((r) => ({ productId: r.product_id, unitPrice: r.price, qty: r.qty, categoryId: r.category_id, onSale: r.on_sale }));
}

export class CartCoupons {
  constructor(
    private readonly db: Db,
    private readonly bugs: Bugs,
  ) {}

  private async evaluate(cartId: string, code: string, customerId: string | null, now: Date) {
    const coupon = await loadCoupon(this.db.pool, code, customerId);
    const ls = await lines(this.db, cartId);
    const eligible = coupon ? price({ lines: ls, coupon: toPricingCoupon(coupon), rate: { price: '0', freeFrom: null }, taxRatePercent: 0 }) : null;
    const problem = couponProblem(coupon, {
      now,
      eligibleSubtotalCents: eligible?.eligibleSubtotal ?? 0,
      signedIn: customerId !== null,
      bugs: {
        limitIgnored: await this.bugs.enabled('coupon_limit_ignored'),
        customerLimitIgnored: await this.bugs.enabled('coupon_customer_limit_ignored'),
      },
    });
    return { coupon, problem, discount: problem || !eligible ? 0 : eligible.discount };
  }

  /** Adds the code's state and discount to a cart. */
  async decorate(cart: Cart, cartId: string | null, customerId: string | null, now: Date): Promise<Cart> {
    if (!cartId) return cart;
    const row = await this.db.one<{ coupon_code: string | null }>('SELECT coupon_code FROM carts WHERE id = $1', [cartId]);
    if (!row?.coupon_code) return cart;
    const { coupon, problem, discount } = await this.evaluate(cartId, row.coupon_code, customerId, now);
    return {
      ...cart,
      coupon: { code: row.coupon_code, applied: problem === null, problem, discount: fromCents(discount), kind: coupon?.kind ?? null },
      discount: fromCents(discount),
    };
  }

  async apply(cartId: string, code: string, customerId: string | null, now: Date) {
    const { problem } = await this.evaluate(cartId, code, customerId, now);
    if (problem) throw new AppError('coupon_invalid', problem, { errors: [{ path: 'code', message: problem }] });
    await this.db.query('UPDATE carts SET coupon_code = $2, updated_at = now() WHERE id = $1', [cartId, code]);
  }

  async remove(cartId: string) {
    await this.db.query('UPDATE carts SET coupon_code = NULL, updated_at = now() WHERE id = $1', [cartId]);
  }
}
