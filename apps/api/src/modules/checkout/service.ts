// Checkout rules:
//   - Only signed-in customers with a confirmed email can check out (no guest checkout).
//   - The cart must have no problem lines (unavailable, sold out, not enough left).
//   - Stock rows are locked in product-id order, so two shoppers can't both buy the last unit; the order then
//     holds its stock (a reservation) until it ships or is cancelled.
//   - The order is created as pending_payment, then the card is authorized:
//       authorized       -> confirmed (cart emptied, coupon use recorded, email sent)
//       requires_action  -> stays pending_payment for 30 minutes while the customer answers at the bank
//       failed           -> cancelled at once (payment_failed); the cart is kept
//   - The coupon is checked again inside the transaction with its row locked, so its use limit holds under load.
import type { Quote, QuoteInput } from '@halden/contracts';
import { fromCents, toCents } from '@halden/money';
import type pg from 'pg';
import type { z } from 'zod';
import type { CurrentUser } from '../../core/auth.js';
import type { AppContext } from '../../core/context.js';
import type { Queryable } from '../../core/db.js';
import { addSeconds } from '../../core/clock.js';
import { AppError, fieldError } from '../../core/errors.js';
import { couponProblem, loadCoupon, toPricingCoupon, type CouponBugs } from '../promotions/coupons.js';
import { PAYMENT_MINUTES } from '../orders/lifecycle.js';
import { OrderService } from '../orders/service.js';
import { lowStockCheck } from '../staff/service.js';
import { luhnValid } from '../payments/haldenpay.js';
import { balance, lockPoints, redeem } from '../loyalty/points.js';
import { creditBalance, spendCredit } from '../loyalty/store-credit.js';
import { amounts, maxRedeemablePoints, price, type PricingLine } from './pricing.js';

type Input = z.infer<typeof QuoteInput>;
type ShipAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country_code: string;
  phone: string | null;
};
type CheckoutLine = PricingLine & {
  name: string;
  sku: string;
  image: string;
  active: boolean;
  available: number;
  returnable: boolean;
};

export class CheckoutService {
  private readonly orders: OrderService;

  constructor(private readonly ctx: AppContext) {
    this.orders = new OrderService(ctx);
  }

  private async couponBugs(client?: Queryable): Promise<CouponBugs> {
    return {
      limitIgnored: await this.ctx.bugs.enabled('coupon_limit_ignored', client),
      customerLimitIgnored: await this.ctx.bugs.enabled('coupon_customer_limit_ignored', client),
    };
  }

  private async address(db: Queryable, customerId: string, shipTo: Input['shipTo']): Promise<ShipAddress> {
    if ('addressId' in shipTo) {
      const { rows } = await db.query<ShipAddress>(
        'SELECT name, line1, line2, city, region, postcode, country_code, phone FROM addresses WHERE id = $1 AND customer_id = $2',
        [shipTo.addressId, customerId],
      );
      if (!rows[0]) throw fieldError('shipTo.addressId', 'Choose one of your addresses.');
      return rows[0];
    }
    const a = shipTo.address;
    return { name: a.name, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postcode: a.postcode, country_code: a.countryCode, phone: a.phone };
  }

  private async zoneAndRates(db: Queryable, countryCode: string) {
    const { rows } = await db.query<{ zone_code: string | null; zone_name: string | null }>(
      'SELECT c.zone_code, z.name AS zone_name FROM countries c LEFT JOIN shipping_zones z ON z.code = c.zone_code WHERE c.code = $1',
      [countryCode],
    );
    const zone = rows[0];
    if (!zone?.zone_code || !zone.zone_name) throw new AppError('shipping_unavailable', 'We do not ship to that country yet.');
    // Planted bug: eu_domestic_rate charges Europe the domestic rates.
    const rateZone = zone.zone_code === 'europe' && (await this.ctx.bugs.enabled('eu_domestic_rate', db)) ? 'domestic' : zone.zone_code;
    const { rows: rates } = await db.query<{ method: 'standard' | 'express'; price: string; free_from: string | null; days_min: number; days_max: number }>(
      'SELECT method, price, free_from, days_min, days_max FROM shipping_rates WHERE zone_code = $1 ORDER BY price',
      [rateZone],
    );
    return { zone: { code: zone.zone_code, name: zone.zone_name }, rates };
  }

  private async taxRate(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ value: unknown }>("SELECT value FROM shop_settings WHERE key = 'tax_rate_percent'");
    return Number(rows[0]?.value ?? 8);
  }

  private async cartLines(db: Queryable, customerId: string, lock: boolean): Promise<{ cartId: string | null; couponCode: string | null; lines: CheckoutLine[] }> {
    const { rows: carts } = await db.query<{ id: string; coupon_code: string | null }>(
      `SELECT id, coupon_code FROM carts WHERE customer_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [customerId],
    );
    const cart = carts[0];
    if (!cart) return { cartId: null, couponCode: null, lines: [] };
    if (lock) {
      // Lock the stock rows in a fixed order so concurrent checkouts can't deadlock or oversell.
      await db.query(
        'SELECT 1 FROM inventory WHERE product_id IN (SELECT product_id FROM cart_items WHERE cart_id = $1) ORDER BY product_id FOR UPDATE',
        [cart.id],
      );
    }
    const { rows } = await db.query<{
      product_id: string;
      price: string;
      qty: number;
      category_id: number;
      on_sale: boolean;
      name: string;
      sku: string;
      image: string | null;
      active: boolean;
      available: number;
      returnable: boolean;
    }>(
      `SELECT p.id AS product_id, p.price, ci.qty, p.category_id, p.compare_at_price IS NOT NULL AS on_sale, p.name, p.sku,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image,
              p.active, sl.available, p.returnable
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN stock_levels sl ON sl.product_id = p.id
        WHERE ci.cart_id = $1
        ORDER BY p.id`,
      [cart.id],
    );
    return {
      cartId: cart.id,
      couponCode: cart.coupon_code,
      lines: rows.map((r) => ({
        productId: r.product_id,
        unitPrice: r.price,
        qty: r.qty,
        categoryId: r.category_id,
        onSale: r.on_sale,
        name: r.name,
        sku: r.sku,
        image: r.image ?? '/images/placeholder.jpg',
        active: r.active,
        available: r.available,
        returnable: r.returnable,
      })),
    };
  }

  /** Prices the cart for an address and method, without placing anything. */
  async quote(user: CurrentUser, input: Input, now: Date, client: Queryable = this.ctx.db.pool): Promise<Quote & { _lines: CheckoutLine[]; _cents: ReturnType<typeof price>; _address: ShipAddress; _couponCode: string | null; _cartId: string | null; _taxRate: number }> {
    const address = await this.address(client, user.id, input.shipTo);
    const { zone, rates } = await this.zoneAndRates(client, address.country_code);
    const rate = rates.find((r) => r.method === input.shippingMethod);
    if (!rate) throw fieldError('shippingMethod', 'That delivery option is not available for this address.');
    const taxRate = await this.taxRate(client);
    const { cartId, couponCode, lines } = await this.cartLines(client, user.id, false);

    let coupon = couponCode ? await loadCoupon(client, couponCode, user.id) : undefined;
    let problem: string | null = null;
    if (couponCode) {
      const eligibleSubtotal = coupon
        ? price({ lines, coupon: toPricingCoupon(coupon), rate: { price: '0', freeFrom: null }, taxRatePercent: 0 }).eligibleSubtotal
        : 0;
      problem = couponProblem(coupon, { now, eligibleSubtotalCents: eligibleSubtotal, signedIn: true, bugs: await this.couponBugs(client) });
      if (problem) coupon = undefined;
    }
    const couponTwice = await this.ctx.bugs.enabled('coupon_twice', client);
    const pricingCoupon = coupon ? toPricingCoupon(coupon) : null;
    const base = price({ lines, coupon: pricingCoupon, rate: { price: rate.price, freeFrom: rate.free_from }, taxRatePercent: taxRate, bugs: { couponTwice } });

    // Halden Points: checked against the balance and the half-of-the-order limit.
    const points = await balance(client, user.id);
    const maxRedeemable = Math.min(maxRedeemablePoints(base.subtotal - base.discount), Math.floor(points.available / 100) * 100);
    if (input.pointsToRedeem > points.available) throw fieldError('pointsToRedeem', `You have ${points.available} points.`);
    if (input.pointsToRedeem > maxRedeemablePoints(base.subtotal - base.discount)) {
      throw fieldError('pointsToRedeem', `Points can pay at most half of this order: up to ${maxRedeemablePoints(base.subtotal - base.discount)} points.`);
    }
    const result = price({
      lines,
      coupon: pricingCoupon,
      rate: { price: rate.price, freeFrom: rate.free_from },
      taxRatePercent: taxRate,
      points: input.pointsToRedeem,
      bugs: { couponTwice },
    });
    const creditCents = toCents(await creditBalance(client, user.id));
    const credit = input.useStoreCredit ? Math.min(creditCents, result.total) : 0;
    const options = rates.map((r) => {
      const p = price({ lines, coupon: pricingCoupon, rate: { price: r.price, freeFrom: r.free_from }, taxRatePercent: taxRate, points: input.pointsToRedeem, bugs: { couponTwice } });
      return { method: r.method, price: fromCents(p.shipping), free: p.shipping === 0, freeFrom: r.free_from, daysMin: r.days_min, daysMax: r.days_max };
    });
    return {
      zone,
      shippingOptions: options,
      shippingMethod: input.shippingMethod,
      coupon: couponCode ? { code: couponCode, applied: !problem && Boolean(coupon), problem, discount: fromCents(result.discount) } : null,
      totals: { ...amounts(result, taxRate), storeCredit: fromCents(credit), amountDue: fromCents(result.total - credit) },
      toFreeShipping: result.toFreeShipping === null ? null : fromCents(result.toFreeShipping),
      points: { available: points.available, maxRedeemable, redeemed: input.pointsToRedeem },
      storeCredit: { balance: fromCents(creditCents), applied: fromCents(credit) },
      _lines: lines,
      _cents: result,
      _address: address,
      _couponCode: coupon ? couponCode : null,
      _cartId: cartId,
      _taxRate: taxRate,
    };
  }

  /** Places the order and authorizes the card. Returns the order id and, for the bank step, where to go. */
  async place(user: CurrentUser, input: Input & { card?: { number: string } | undefined }, now: Date) {
    if (!user.emailVerified) {
      throw new AppError('email_not_verified', 'Confirm your email address before your first order. We sent you a link.');
    }
    if (input.card && !luhnValid(input.card.number)) throw fieldError('card.number', 'That card number is not valid.', 'Please check the card number.');
    const orderId = await this.ctx.db.tx(async (tx) => {
      // Lock the customer's points and store credit first, so two checkouts can't spend them twice.
      await lockPoints(tx, user.id);
      const { lines } = await this.cartLines(tx, user.id, true);
      if (lines.length === 0) throw new AppError('cart_empty', 'Your cart is empty.');
      const bad = lines.find((l) => !l.active || l.available < l.qty);
      if (bad) {
        throw new AppError(
          'cart_has_problems',
          !bad.active ? `${bad.name} is no longer sold. Remove it to continue.` : bad.available <= 0 ? `${bad.name} has just sold out.` : `Only ${bad.available} ${bad.name} left. Change the quantity to continue.`,
        );
      }
      // Lock the coupon row so its use limit holds when two orders race for the last use.
      const { rows: cartRow } = await tx.query<{ coupon_code: string | null }>('SELECT coupon_code FROM carts WHERE customer_id = $1', [user.id]);
      const code = cartRow[0]?.coupon_code;
      if (code) {
        const locked = await loadCoupon(tx, code, user.id, true);
        const eligible = locked ? price({ lines, coupon: toPricingCoupon(locked), rate: { price: '0', freeFrom: null }, taxRatePercent: 0 }).eligibleSubtotal : 0;
        const problem = couponProblem(locked, { now, eligibleSubtotalCents: eligible, signedIn: true, bugs: await this.couponBugs(tx) });
        if (problem) throw new AppError('coupon_invalid', `Code ${code}: ${problem} Remove it to continue.`);
      }
      const q = await this.quote(user, input, now, tx);
      const a = q._address;
      if (toCents(q.totals.amountDue) > 0 && !input.card) throw fieldError('card', 'Enter a card for the amount left to pay.');
      if ('address' in input.shipTo) await this.saveAddress(tx, user.id, input.shipTo.address, now);

      const expires = addSeconds(now, PAYMENT_MINUTES * 60);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO orders (customer_id, email, status, subtotal, discount, shipping, tax, total, tax_rate, coupon_code,
                             shipping_zone, shipping_method, ship_name, ship_line1, ship_line2, ship_city, ship_region,
                             ship_postcode, ship_country, ship_phone, payment_expires_at, placed_at, updated_at,
                             points_redeemed, points_discount, store_credit_used)
         VALUES ($1, $2, 'pending_payment', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21, $22, $23, $24)
         RETURNING id`,
        [
          user.id, user.email, q.totals.subtotal, q.totals.discount, q.totals.shipping, q.totals.tax, q.totals.total, q.totals.taxRate,
          q._couponCode, q.zone.code, input.shippingMethod, a.name, a.line1, a.line2, a.city, a.region, a.postcode, a.country_code, a.phone,
          expires, now, input.pointsToRedeem, q.totals.pointsDiscount, q.totals.storeCredit,
        ],
      );
      const id = rows[0]!.id;
      await redeem(tx, user.id, input.pointsToRedeem, id, now);
      if (toCents(q.totals.storeCredit) > 0) await spendCredit(tx, user.id, toCents(q.totals.storeCredit), id, now);
      for (const [i, l] of q._lines.entries()) {
        const priced = q._cents.lines[i]!;
        await tx.query(
          `INSERT INTO order_items (order_id, product_id, sku, name, image, category_id, unit_price, qty, line_total,
                                    discount_alloc, points_alloc, tax_alloc, returnable, on_sale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [id, l.productId, l.sku, l.name, l.image, l.categoryId, l.unitPrice, l.qty, fromCents(priced.lineTotal), fromCents(priced.discount), fromCents(priced.points), fromCents(priced.tax), l.returnable, l.onSale],
        );
        await tx.query('INSERT INTO stock_reservations (order_id, product_id, qty, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)', [
          id, l.productId, l.qty, expires, now,
        ]);
        await lowStockCheck(this.ctx, tx, l.productId, now);
      }
      if (q._couponCode) {
        await tx.query('INSERT INTO coupon_redemptions (coupon_code, customer_id, order_id, created_at) VALUES ($1, $2, $3, $4)', [
          q._couponCode, user.id, id, now,
        ]);
      }
      await tx.query(
        'INSERT INTO order_events (order_id, from_status, to_status, actor_id, actor_role, note, created_at) VALUES ($1, NULL, $2, $3, $4, $5, $6)',
        [id, 'pending_payment', user.id, user.role, 'Order placed', now],
      );
      // Paid in full with store credit: no card, confirmed straight away.
      if (toCents(q.totals.amountDue) === 0) await this.orders.confirm(tx, id, now);
      return { id, due: q.totals.amountDue, shipping: q.totals.shipping };
    });
    if (toCents(orderId.due) === 0) return { orderId: orderId.id, status: 'confirmed' as const, nextAction: null };
    const card = input.card!;

    // Planted bug: payment_misses_shipping authorizes the amount due without shipping.
    const amount = (await this.ctx.bugs.enabled('payment_misses_shipping'))
      ? fromCents(Math.max(1, toCents(orderId.due) - toCents(orderId.shipping)))
      : orderId.due;
    const result = await this.ctx.db.tx(async (tx) => {
      const r = await this.ctx.gateway.authorize(tx, {
        orderId: orderId.id,
        amount,
        cardNumber: card.number,
        returnUrl: `${this.ctx.config.APP_URL}/checkout/authenticate`,
      });
      const status = r.status === 'authorized' ? 'authorized' : r.status === 'requires_action' ? 'requires_action' : 'failed';
      await tx.query(
        `INSERT INTO payments (order_id, intent_id, status, amount, card_brand, card_last4, failure_code, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [orderId.id, r.intentId, status, amount, r.brand, r.last4, r.status === 'failed' ? r.code : null, now],
      );
      if (r.status === 'authorized') await this.orders.confirm(tx, orderId.id, now);
      if (r.status === 'failed') await this.orders.failPayment(tx, orderId.id, r.code, now);
      return r;
    }).catch(async (err: unknown) => {
      // Something unexpected: don't leave the order holding stock. Cancel it and pass the error on.
      await this.ctx.db.tx((tx) => this.orders.failPayment(tx, orderId.id, 'invalid_card', now));
      throw err;
    });
    await this.ctx.deliverWebhooks();

    if (result.status === 'failed') {
      throw new AppError(
        'payment_declined',
        result.code === 'insufficient_funds' ? 'Your card has insufficient funds. Try another card.' : 'Your card was declined. Try another card.',
      );
    }
    return {
      orderId: orderId.id,
      status: result.status === 'authorized' ? ('confirmed' as const) : ('pending_payment' as const),
      nextAction: result.status === 'requires_action' ? { type: 'authenticate' as const, url: result.actionUrl } : null,
    };
  }

  /** The customer's answer at the bank step. The webhook that follows confirms or cancels the order. */
  async authenticate(token: string, approve: boolean) {
    const r = await this.ctx.db.tx((tx) => this.ctx.gateway.authenticate(tx, token, approve));
    await this.ctx.deliverWebhooks();
    const row = await this.ctx.db.one<{ order_id: string; status: string }>(
      'SELECT p.order_id, o.status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.intent_id = $1',
      [r.intentId],
    );
    return { orderId: row!.order_id, status: row!.status };
  }

  private async saveAddress(tx: pg.PoolClient, customerId: string, a: Extract<Input['shipTo'], { address: unknown }>['address'], now: Date) {
    const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM addresses WHERE customer_id = $1', [customerId]);
    const count = rows[0]?.n ?? 0;
    if (count >= 5) return; // book full: the order keeps its copy
    await tx.query(
      `INSERT INTO addresses (customer_id, name, line1, line2, city, region, postcode, country_code, phone, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [customerId, a.name, a.line1, a.line2, a.city, a.region, a.postcode, a.countryCode, a.phone, count === 0, now],
    );
  }
}
