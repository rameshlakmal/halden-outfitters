// @ts-check
// Planted bugs, for practising database testing. Each one is off until switched on in the admin's QA lab,
// and each leaves a trace in the data that a rule in qa/rules.sql catches.

/** The bugs, as seeded into qa_bugs. */
export const BUGS = [
  {
    key: 'coupon_twice',
    title: 'Coupon applied twice',
    description: 'With two or more different products in the cart, a coupon discount is counted twice.',
    howToSee: 'Add two different products, apply WELCOME10 and check out. The order discount is double what it should be.',
  },
  {
    key: 'cancel_keeps_stock',
    title: 'Cancelling keeps the stock',
    description: 'Cancelling an order refunds it but never returns the items to stock.',
    howToSee: 'Place an order, then cancel it from Your orders. Stock for those products stays lowered.',
  },
  {
    key: 'payment_misses_shipping',
    title: 'Payment misses shipping',
    description: 'The card is charged the order total without the shipping cost.',
    howToSee: 'Check out an order under 75.00 (so it pays shipping). The payment is 7.95 less than the order total.',
  },
  {
    key: 'price_edit_rewrites_orders',
    title: 'Price edits rewrite past orders',
    description: 'Changing a product price in the admin also changes the price on orders already placed.',
    howToSee: 'Order a product, then change its price in Admin, Products. The old order lines change too; the order totals do not.',
  },
  {
    key: 'coupon_limit_ignored',
    title: 'Coupon use limit ignored',
    description: 'A coupon keeps working after it has been used as many times as allowed.',
    howToSee: 'TRAILHEAD15 allows 3 uses, and the demo orders have used all three. Apply it to an order of 100.00 or more: it still works.',
  },
];

/**
 * The keys of the bugs that are switched on.
 * @param {{ query: (text: string) => Promise<{ rows: { key: string }[] }> } | ((text: string) => Promise<{ key: string }[]>)} db
 * @returns {Promise<Set<string>>}
 */
export async function enabledBugs(db) {
  const sql = 'SELECT key FROM qa_bugs WHERE enabled';
  const rows = typeof db === 'function' ? await db(sql) : (await db.query(sql)).rows;
  return new Set(rows.map((r) => r.key));
}
