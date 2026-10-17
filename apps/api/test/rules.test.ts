// qa/rules.sql against real data: the seeded shop and a full happy-path run break no rule, and each planted bug
// breaks exactly the rule tagged with its key, and no other. Rules run over whole tables here (Propmaster's
// --all-rows), so every row in the test database is checked.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUGS, type BugKey } from '../src/core/bugs.js';
import { type Client, json, productId, startApp, type TestApp } from './helpers.js';
import { bug, card, checkout, deliveredOrder, fill, newCustomer, signedIn } from './shop.js';

type Rule = { name: string; bug: string | null; sql: string };

function loadRules(): Rule[] {
  const text = readFileSync(new URL('../../../qa/rules.sql', import.meta.url), 'utf8');
  const rules: Rule[] = [];
  for (const chunk of text.split(/^-- rule: /m).slice(1)) {
    const [head, ...body] = chunk.split('\n');
    const m = /^(.*?)(?:\s+\[(\w+)\])?\s*$/.exec(head!)!;
    const sql = body
      .filter((l) => !l.startsWith('-- ===') && !/^-- [A-Z]/.test(l))
      .join('\n')
      .replace(/\{\{(\w+)\}\}/g, '$1')
      .trim()
      .replace(/;$/, '');
    rules.push({ name: m[1]!, bug: m[2] ?? null, sql });
  }
  return rules;
}

const rules = loadRules();
let t: TestApp;

async function broken(): Promise<string[]> {
  const out: string[] = [];
  for (const r of rules) {
    const rows = await t.db.query(r.sql);
    if (rows.length) out.push(r.name);
  }
  return out;
}

const ruleFor = (key: string) => rules.find((r) => r.bug === key)!.name;

beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());

const support = () => signedIn(t, 'support@halden.test', true);
const admin = () => signedIn(t, 'admin@halden.test', true);
const goodwill = (c: Client, orderId: string, amount: string) =>
  c.post(`/staff/orders/${orderId}/goodwill`, { amount, reason: 'Late delivery' }, { 'idempotency-key': randomUUID() });

async function returnLine(
  d: Awaited<ReturnType<typeof deliveredOrder>>,
  slug: string,
  opts: { reason?: string; condition?: string; method?: string } = {},
) {
  const order = json(await d.client.get(`/orders/${d.orderId}`));
  const line = order.lines.find((l: { slug: string }) => l.slug === slug);
  const res = await d.client.post(`/orders/${d.orderId}/returns`, {
    items: [{ productId: line.productId, qty: 1 }],
    reason: opts.reason ?? 'damaged',
    refundMethod: opts.method ?? 'card',
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  const r = json(res);
  if (r.status === 'requested') await (await support()).post(`/staff/returns/${r.id}/approve`);
  const done = await d.warehouse.post(`/staff/returns/${r.id}/receive`, {
    items: [{ productId: line.productId, condition: opts.condition ?? 'as_new' }],
  });
  if (done.statusCode !== 200) throw new Error(done.body);
  return json(done);
}

async function couponOrder(code: string, items: [string, number][], c?: Awaited<ReturnType<typeof newCustomer>>) {
  c ??= await newCustomer(t);
  await fill(t, c.client, items);
  const applied = await c.client.post('/cart/coupon', { code });
  if (applied.statusCode !== 200) throw new Error(applied.body);
  const res = await checkout(c.client, c.addressId);
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...c, orderId: json(res).orderId as string };
}

/** What each planted bug needs to show itself. */
const SCENARIOS: Record<BugKey, () => Promise<void>> = {
  coupon_twice: async () => {
    await couponOrder('CAMP20', [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
  },
  cancel_keeps_reservation: async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const id = json(await checkout(c.client, c.addressId)).orderId;
    await c.client.post(`/orders/${id}/cancel`, { reason: 'changed_mind' });
  },
  payment_misses_shipping: async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['insulated-mug', 1]]);
    await checkout(c.client, c.addressId);
  },
  coupon_limit_ignored: async () => {
    // The demo orders used all three TRAILHEAD15 uses.
    await couponOrder('TRAILHEAD15', [['trail-tarp', 2]]);
  },
  coupon_customer_limit_ignored: async () => {
    const c = await newCustomer(t);
    for (let i = 0; i < 3; i++) await couponOrder('ALLIN25', [['titanium-pot', 1]], c);
  },
  cancel_keeps_coupon_use: async () => {
    const o = await couponOrder('CAMP20', [['titanium-pot', 1]]);
    await o.client.post(`/orders/${o.orderId}/cancel`, { reason: 'changed_mind' });
  },
  cancel_leaves_authorization: async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    const id = json(await checkout(c.client, c.addressId)).orderId;
    await c.client.post(`/orders/${id}/cancel`, { reason: 'changed_mind' });
  },
  eu_domestic_rate: async () => {
    const c = await newCustomer(t, 'SE');
    await fill(t, c.client, [['titanium-pot', 1]]);
    await checkout(c.client, c.addressId);
  },
  refund_ignores_discount: async () => {
    const o = await couponOrder('CAMP20', [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
    const w = await signedIn(t, 'warehouse@halden.test', true);
    for (const step of ['pack', 'ship', 'deliver'])
      await w.post(`/staff/orders/${o.orderId}/${step}`, step === 'ship' ? { trackingNumber: 'HX12345678' } : {});
    await returnLine({ ...o, warehouse: w }, 'titanium-pot');
  },
  refund_over_captured: async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    await goodwill(await admin(), d.orderId, '500.00');
  },
  return_window_restarts: async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const productIdPot = json(await d.client.get(`/orders/${d.orderId}`)).lines[0].productId;
    for (const step of [10, 10, 5]) {
      await t.advance(step * 86400);
      await d.client.get('/auth/session');
    }
    const first = json(
      await d.client.post(`/orders/${d.orderId}/returns`, {
        items: [{ productId: productIdPot, qty: 1 }],
        reason: 'changed_mind',
      }),
    );
    await d.client.post(`/returns/${first.id}/cancel`);
    await t.advance(10 * 86400);
    await d.client.get('/auth/session');
    const late = await d.client.post(`/orders/${d.orderId}/returns`, {
      items: [{ productId: productIdPot, qty: 1 }],
      reason: 'changed_mind',
    });
    if (late.statusCode !== 201) throw new Error(late.body);
  },
  restock_damaged: async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    await returnLine(d, 'titanium-pot', { condition: 'faulty' });
  },
  store_credit_double: async () => {
    const d = await deliveredOrder(t, [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
    await returnLine(d, 'titanium-pot', { method: 'store_credit' });
  },
  support_goodwill_unlimited: async () => {
    const d = await deliveredOrder(t, [
      ['ember-stove', 1],
      ['headlamp-400', 1],
    ]);
    await goodwill(await support(), d.orderId, '80.00');
  },
  points_on_tax_shipping: async () => {
    await deliveredOrder(t, [['insulated-mug', 1]]);
  },
  returned_keeps_points: async () => {
    const d = await deliveredOrder(t, [
      ['titanium-pot', 1],
      ['headlamp-400', 1],
    ]);
    await returnLine(d, 'titanium-pot');
  },
  hidden_reviews_counted: async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const r = json(
      await d.client.post('/products/titanium-pot/reviews', {
        rating: 1,
        title: 'Not for me',
        body: 'It was fine but not what I wanted at all.',
      }),
    );
    await (await support()).post(`/staff/reviews/${r.id}/hide`, { reason: 'Off topic' });
  },
  price_edit_rewrites_orders: async () => {
    const c = await newCustomer(t);
    await fill(t, c.client, [['titanium-pot', 1]]);
    await checkout(c.client, c.addressId);
    const id = await productId(t.db, 'titanium-pot');
    await (await admin()).req('PATCH', `/staff/products/${id}`, { price: '40.00' }, { 'if-match': '1' });
  },
};

describe('qa/rules.sql', () => {
  it('has one tagged rule per planted bug', () => {
    expect(rules.length).toBeGreaterThan(30);
    expect(
      rules
        .filter((r) => r.bug)
        .map((r) => r.bug)
        .sort(),
    ).toEqual(BUGS.map((b) => b.key).sort());
    for (const b of BUGS) expect(ruleFor(b.key)).toBeTruthy();
  });

  it('the seeded shop breaks no rule', async () => {
    await t.reseed({ orders: true });
    expect(await broken()).toEqual([]);
  });

  it('a full run with every feature and no bugs breaks no rule', async () => {
    await t.reseed({ orders: true });
    for (const [key, run] of Object.entries(SCENARIOS)) {
      if (key === 'coupon_limit_ignored' || key === 'coupon_customer_limit_ignored') continue; // refused without the bug
      if (key === 'return_window_restarts' || key === 'refund_over_captured') continue; // refused without the bug
      await run();
    }
    // Store credit and points at checkout, a partial return, a goodwill refund, an order paid by credit only.
    const d = await deliveredOrder(t, [
      ['roll-top-dry-bag', 2],
      ['titanium-pot', 1],
    ]);
    await returnLine(d, 'roll-top-dry-bag', { reason: 'changed_mind', condition: 'opened', method: 'store_credit' });
    await goodwill(await support(), d.orderId, '5.00');
    await fill(t, d.client, [['roll-top-dry-bag', 1]]);
    const paid = await d.client.post(
      '/checkout',
      { shipTo: { addressId: d.addressId }, useStoreCredit: true, card: card() },
      { 'idempotency-key': randomUUID() },
    );
    expect(json(paid).status).toBe('confirmed');
    expect(json(await d.client.get(`/orders/${json(paid).orderId}`)).totals.storeCredit).not.toBe('0.00');
    expect(await broken()).toEqual([]);
  });

  for (const b of BUGS) {
    it(`${b.key} breaks "${b.rule}" and nothing else`, async () => {
      await t.reseed({ orders: b.key === 'coupon_limit_ignored' });
      await bug(t, b.key);
      try {
        await SCENARIOS[b.key]();
        expect(await broken()).toEqual([ruleFor(b.key)]);
      } finally {
        await bug(t, b.key, false);
      }
    });
  }
});
