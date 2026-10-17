import { describe, expect, it } from 'vitest';
import { price, type PricingCoupon, type PricingLine } from './pricing.ts';

const line = (productId: string, unitPrice: string, qty = 1, categoryId = 1, onSale = false): PricingLine => ({
  productId,
  unitPrice,
  qty,
  categoryId,
  onSale,
});
const DOMESTIC = { price: '7.95', freeFrom: '75.00' };
const ROW = { price: '24.95', freeFrom: null };
const pct = (value: string, extra: Partial<PricingCoupon> = {}): PricingCoupon => ({
  kind: 'percent',
  value,
  excludesSaleItems: true,
  excludedCategoryIds: [],
  ...extra,
});

describe('totals', () => {
  it('adds lines, shipping under the threshold and 8% tax on goods', () => {
    const r = price({ lines: [line('1', '32.00'), line('2', '28.00')], coupon: null, rate: DOMESTIC, taxRatePercent: 8 });
    expect(r).toMatchObject({ subtotal: 6000, discount: 0, shipping: 795, tax: 480, total: 7275, toFreeShipping: 1500 });
  });

  it('ships free from the threshold, counted after the discount', () => {
    const at = price({ lines: [line('1', '75.00')], coupon: null, rate: DOMESTIC, taxRatePercent: 8 });
    expect(at.shipping).toBe(0);
    const pushedUnder = price({ lines: [line('1', '80.00')], coupon: pct('10'), rate: DOMESTIC, taxRatePercent: 8 });
    expect(pushedUnder.discount).toBe(800);
    expect(pushedUnder.shipping).toBe(795); // 72.00 after the discount
  });

  it('never ships free where the zone has no threshold', () => {
    expect(price({ lines: [line('1', '900.00')], coupon: null, rate: ROW, taxRatePercent: 8 }).shipping).toBe(2495);
  });

  it('rounds tax half up once per order', () => {
    // 10.06 x 8% = 0.8048 -> 0.80; 10.07 x 8% = 0.8056 -> 0.81
    expect(price({ lines: [line('1', '10.06')], coupon: null, rate: DOMESTIC, taxRatePercent: 8 }).tax).toBe(80);
    expect(price({ lines: [line('1', '10.07')], coupon: null, rate: DOMESTIC, taxRatePercent: 8 }).tax).toBe(81);
  });

  it('total is always subtotal - discount + shipping + tax', () => {
    const r = price({
      lines: [line('1', '349.00'), line('2', '69.00', 2)],
      coupon: pct('15'),
      rate: DOMESTIC,
      taxRatePercent: 8,
    });
    expect(r.total).toBe(r.subtotal - r.discount + r.shipping + r.tax);
  });
});

describe('coupons', () => {
  it('percent and fixed, never more than the eligible subtotal', () => {
    const lines = [line('1', '40.00')];
    expect(price({ lines, coupon: pct('10'), rate: DOMESTIC, taxRatePercent: 8 }).discount).toBe(400);
    const fixed: PricingCoupon = { kind: 'fixed', value: '50.00', excludesSaleItems: true, excludedCategoryIds: [] };
    expect(price({ lines, coupon: fixed, rate: DOMESTIC, taxRatePercent: 8 }).discount).toBe(4000);
  });

  it('skips sale items and excluded categories', () => {
    const lines = [line('1', '100.00', 1, 1, true), line('2', '50.00', 1, 2), line('3', '20.00', 1, 3)];
    const r = price({ lines, coupon: pct('10', { excludedCategoryIds: [3] }), rate: DOMESTIC, taxRatePercent: 8 });
    expect(r.eligibleSubtotal).toBe(5000);
    expect(r.discount).toBe(500);
    expect(r.lines.map((l) => l.discount)).toEqual([0, 500, 0]);
  });

  it('can include sale items when the coupon allows it', () => {
    const lines = [line('1', '100.00', 1, 1, true)];
    expect(price({ lines, coupon: pct('10', { excludesSaleItems: false }), rate: DOMESTIC, taxRatePercent: 8 }).discount).toBe(1000);
  });

  it('free_shipping makes the chosen method free but discounts nothing', () => {
    const coupon: PricingCoupon = { kind: 'free_shipping', value: '0', excludesSaleItems: true, excludedCategoryIds: [] };
    const r = price({ lines: [line('1', '20.00')], coupon, rate: ROW, taxRatePercent: 8 });
    expect(r).toMatchObject({ discount: 0, shipping: 0, toFreeShipping: null });
  });

  it('planted bug: counted twice with two or more eligible lines', () => {
    const lines = [line('1', '50.00'), line('2', '50.00')];
    const ok = price({ lines, coupon: pct('10'), rate: DOMESTIC, taxRatePercent: 8 });
    const bug = price({ lines, coupon: pct('10'), rate: DOMESTIC, taxRatePercent: 8, bugs: { couponTwice: true } });
    expect(ok.discount).toBe(1000);
    expect(bug.discount).toBe(2000);
  });
});

describe('allocations', () => {
  it('spread discount and tax over the lines and add up exactly', () => {
    for (const coupon of [null, pct('15'), pct('33')]) {
      const lines = [line('1', '349.00'), line('2', '69.00', 3), line('3', '28.00'), line('4', '45.00', 1, 1, true)];
      const r = price({ lines, coupon, rate: DOMESTIC, taxRatePercent: 8 });
      expect(r.lines.reduce((n, l) => n + l.discount, 0)).toBe(r.discount);
      expect(r.lines.reduce((n, l) => n + l.tax, 0)).toBe(r.tax);
      for (const l of r.lines) expect(l.discount).toBeLessThanOrEqual(l.lineTotal);
    }
  });

  it('gives an ineligible line no discount but its share of the tax', () => {
    const r = price({ lines: [line('1', '100.00', 1, 1, true), line('2', '100.00')], coupon: pct('50'), rate: DOMESTIC, taxRatePercent: 8 });
    expect(r.lines[0]).toMatchObject({ discount: 0, tax: 800 });
    expect(r.lines[1]).toMatchObject({ discount: 5000, tax: 400 });
  });
});

describe('Halden Points', () => {
  it('takes 5.00 per 100 points off before tax, spread over the lines', () => {
    const r = price({ lines: [line('1', '60.00'), line('2', '40.00')], coupon: null, rate: DOMESTIC, taxRatePercent: 8, points: 300 });
    expect(r).toMatchObject({ subtotal: 10_000, pointsDiscount: 1500, tax: 680, total: 10_000 - 1500 + 680 });
    expect(r.lines.map((l) => l.points)).toEqual([900, 600]);
    expect(r.lines.reduce((n, l) => n + l.tax, 0)).toBe(r.tax);
  });

  it('never takes more than half of the subtotal after the coupon', () => {
    const r = price({ lines: [line('1', '28.00')], coupon: pct('10'), rate: DOMESTIC, taxRatePercent: 8, points: 2000 });
    // 25.20 after the coupon: half is 12.60, so two 5.00 blocks.
    expect(r.pointsDiscount).toBe(1000);
  });
});
