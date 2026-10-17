// Planted bugs for QA practice. Each is off until switched on in the QA lab and breaks exactly one rule in
// qa/rules.sql. The code paths that honour them are marked "Planted bug:" so they're easy to find.
import type { Db, Queryable } from './db.js';

export const BUGS = [
  {
    key: 'coupon_twice',
    phase: 2,
    title: 'Coupon applied twice',
    description: 'With two or more eligible products, a percent or fixed coupon discount is counted twice.',
    howToSee: 'Add two different full-price products, apply WELCOME10 and check out. The discount is double.',
    rule: 'The discount is exactly what the coupon gives',
  },
  {
    key: 'cancel_keeps_reservation',
    phase: 2,
    title: 'Cancelling keeps the stock held',
    description: 'Cancelling an order does not release its stock reservation, so the stock stays unsellable.',
    howToSee: 'Order the last units of a low-stock product, cancel the order: the product still shows as sold out.',
    rule: 'Open reservations belong to open orders',
  },
  {
    key: 'payment_misses_shipping',
    phase: 2,
    title: 'Payment misses shipping',
    description: 'The card is authorized for the order total without the shipping cost.',
    howToSee: 'Check out an order under 75.00 so it pays shipping. The payment is lower than the order total.',
    rule: 'The card is authorized for the order total',
  },
  {
    key: 'coupon_limit_ignored',
    phase: 2,
    title: 'Coupon use limit ignored',
    description: 'A coupon keeps working after it has been used as many times as allowed.',
    howToSee: 'TRAILHEAD15 allows 3 uses and the demo orders used all three. It still applies.',
    rule: 'A coupon is never used more often than allowed',
  },
  {
    key: 'coupon_customer_limit_ignored',
    phase: 2,
    title: 'Per-customer coupon limit ignored',
    description: 'A once-per-customer coupon works again for the same customer.',
    howToSee: 'WELCOME10 is once per customer. Use it twice with one account.',
    rule: 'A customer never uses a coupon more often than allowed',
  },
  {
    key: 'cancel_keeps_coupon_use',
    phase: 2,
    title: 'Cancel keeps the coupon use',
    description: 'Cancelling an order does not give back its coupon use.',
    howToSee: 'Use a limited coupon, cancel the order, and the use is still counted.',
    rule: 'Cancelled orders hold no coupon redemption',
  },
  {
    key: 'cancel_leaves_authorization',
    phase: 2,
    title: 'Cancel leaves the card authorized',
    description: 'Cancelling a confirmed order does not void the card authorization.',
    howToSee: 'Cancel a confirmed order: its payment still shows as authorized.',
    rule: 'Cancelled orders have no open authorization',
  },
  {
    key: 'eu_domestic_rate',
    phase: 2,
    title: 'Europe charged the domestic rate',
    description: 'Orders shipped to Europe are charged the domestic shipping rate and threshold.',
    howToSee: 'Check out to an address in Sweden: shipping is 7.95 instead of 14.95.',
    rule: 'Shipping matches the zone rate',
  },
  {
    key: 'refund_ignores_discount',
    phase: 3,
    title: 'Refund ignores the coupon share',
    description: 'A returned line is refunded at its full price, as if no coupon had been used.',
    howToSee: 'Buy two items with CAMP20, return one: the refund is more than you paid for it.',
    rule: 'A line is never refunded more than was paid for it',
  },
  {
    key: 'refund_over_captured',
    phase: 3,
    title: 'Refunds can exceed the payment',
    description: 'A goodwill refund does not check what was already refunded on the order.',
    howToSee: 'Refund an order in full through a return, then add a goodwill refund on top.',
    rule: 'Refunds never exceed what was paid',
  },
  {
    key: 'return_window_restarts',
    phase: 3,
    title: 'A cancelled return restarts the window',
    description:
      'The 30-day return window is counted from the latest return request instead of from delivery, so starting and cancelling a return buys another 30 days.',
    howToSee:
      'Move the clock 25 days after delivery, start a return and cancel it. Move 10 more days: a new return is still accepted.',
    rule: 'Returns are requested within 30 days of delivery',
  },
  {
    key: 'restock_damaged',
    phase: 3,
    title: 'Damaged returns go back on the shelf',
    description: 'Items graded damaged or faulty at inspection are put back into sellable stock.',
    howToSee: 'Receive a return and grade it faulty: the stock goes up.',
    rule: 'Written-off items are never restocked',
  },
  {
    key: 'store_credit_double',
    phase: 3,
    title: 'Store-credit refunds also refund the card',
    description: 'Choosing store credit for a refund also sends the same amount back to the card.',
    howToSee: 'Return an item for store credit: both the credit balance and the card refund go up.',
    rule: 'Each refund is paid out once',
  },
  {
    key: 'support_goodwill_unlimited',
    phase: 3,
    title: 'Support can refund any amount as goodwill',
    description: 'The 50.00 per-order limit on goodwill refunds by support is not enforced.',
    howToSee: 'Sign in as support and give a 120.00 goodwill refund.',
    rule: 'Support goodwill refunds stay within 50.00 per order',
  },
  {
    key: 'points_on_tax_shipping',
    phase: 3,
    title: 'Points earned on tax and shipping',
    description: 'Halden Points are earned on the whole order total, including tax and shipping.',
    howToSee: 'Deliver an order that paid shipping: it earns more points than its goods are worth.',
    rule: 'Points are earned on goods only',
  },
  {
    key: 'returned_keeps_points',
    phase: 3,
    title: 'Returned items keep their points',
    description: 'A refunded return does not take back the pending points of the returned lines.',
    howToSee: 'Return a delivered item before the window closes: the pending points stay.',
    rule: 'Returned lines hold no points',
  },
  {
    key: 'hidden_reviews_counted',
    phase: 4,
    title: 'Hidden reviews still count in the rating',
    description: 'When support hides a review, the product rating is worked out with the hidden review still in it.',
    howToSee: 'Hide a 1-star review in the staff console: the product rating does not go up.',
    rule: 'A product rating is the average of its published reviews',
  },
  {
    key: 'price_edit_rewrites_orders',
    phase: 4,
    title: 'Price edits rewrite past orders',
    description: 'Changing a product price also changes the price on order lines already placed.',
    howToSee:
      'Change the price of a product someone has ordered: their order lines no longer add up to the order subtotal.',
    rule: 'An order subtotal is the sum of its lines',
  },
] as const;

export type BugKey = (typeof BUGS)[number]['key'];

const CACHE_MS = 2_000;

export class Bugs {
  private on = new Set<string>();
  private loadedAt = -Infinity;

  constructor(private readonly db: Db) {}

  async enabled(key: BugKey, client?: Queryable): Promise<boolean> {
    if (client) {
      const { rows } = await client.query<{ enabled: boolean }>('SELECT enabled FROM qa_bugs WHERE key = $1', [key]);
      return rows[0]?.enabled === true;
    }
    if (Date.now() - this.loadedAt > CACHE_MS) {
      const rows = await this.db.query<{ key: string }>('SELECT key FROM qa_bugs WHERE enabled');
      this.on = new Set(rows.map((r) => r.key));
      this.loadedAt = Date.now();
    }
    return this.on.has(key);
  }

  forget() {
    this.loadedAt = -Infinity;
  }
}
