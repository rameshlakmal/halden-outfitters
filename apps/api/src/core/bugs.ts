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
