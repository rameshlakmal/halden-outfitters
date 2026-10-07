import { describe, expect, it } from 'vitest';
import { fromCents, percentOf, toCents } from '../lib/money.js';
import { couponProblem, priceCart } from '../lib/pricing.js';

const none = new Set();
const coupon = (over = {}) => ({ code: 'X', kind: 'percent', value: '10.00', min_subtotal: '0.00', max_uses: null, used_count: 0, active: true, expires_at: null, ...over });

describe('money in cents', () => {
  it('reads and writes amounts exactly', () => {
    expect(['84.50', '0.07', '12', '1999.9'].map(toCents)).toEqual([8450, 7, 1200, 199990]);
    expect([8450, 7, 0, 199990].map(fromCents)).toEqual(['84.50', '0.07', '0.00', '1999.90']);
    expect(toCents(0.1 + 0.2)).toBe(30); // never trusts floating point beyond the cent
  });

  it('rounds percentages half up to the cent', () => {
    expect(percentOf(1000, 8)).toBe(80);
    expect(percentOf(1006, 8)).toBe(80); // 80.48
    expect(percentOf(1007, 8)).toBe(81); // 80.56
    expect(percentOf(3125, 8)).toBe(250); // 250.00 exactly
    expect(percentOf(4069, 15)).toBe(610); // 610.35
  });
});

describe('cart prices', () => {
  it('charges 7.95 shipping below 75.00 and none from 75.00, after the discount', () => {
    expect(priceCart([{ unitPrice: '74.99', qty: 1 }], null, none)).toMatchObject({ shipping: '7.95', toFreeShipping: '0.01' });
    expect(priceCart([{ unitPrice: '75.00', qty: 1 }], null, none)).toMatchObject({ shipping: '0.00', toFreeShipping: null });
    // 80.00 less 10% is 72.00: under the line again.
    expect(priceCart([{ unitPrice: '80.00', qty: 1 }], coupon(), none)).toMatchObject({ discount: '8.00', shipping: '7.95' });
  });

  it('adds it up: subtotal, discount, shipping, tax, total', () => {
    expect(priceCart([{ unitPrice: '349.00', qty: 1 }, { unitPrice: '28.00', qty: 2 }], coupon(), none)).toEqual({
      subtotal: '405.00', discount: '40.50', shipping: '0.00', tax: '29.16', total: '393.66', toFreeShipping: null,
    });
  });

  it('never discounts more than the subtotal, and an empty cart costs nothing', () => {
    expect(priceCart([{ unitPrice: '15.00', qty: 1 }], coupon({ kind: 'fixed', value: '20.00' }), none)).toMatchObject({ discount: '15.00', total: '7.95' });
    expect(priceCart([], null, none)).toMatchObject({ subtotal: '0.00', shipping: '0.00', total: '0.00' });
  });

  it('explains why a coupon cannot be used', () => {
    expect(couponProblem(coupon({ active: false }), 10000, none)).toBe('This code is no longer active.');
    expect(couponProblem(coupon({ expires_at: new Date('2020-01-01') }), 10000, none)).toBe('This code has expired.');
    expect(couponProblem(coupon({ max_uses: 3, used_count: 3 }), 10000, none)).toBe('This code has been used up.');
    expect(couponProblem(coupon({ min_subtotal: '150.00' }), 10000, none)).toBe('This code needs an order of at least 150.00.');
    expect(couponProblem(coupon(), 10000, none)).toBeNull();
  });

  it('has the planted bugs only when they are switched on', () => {
    const two = [{ unitPrice: '50.00', qty: 1 }, { unitPrice: '50.00', qty: 1 }];
    expect(priceCart(two, coupon(), new Set(['coupon_twice'])).discount).toBe('20.00');
    expect(priceCart([two[0]], coupon(), new Set(['coupon_twice'])).discount).toBe('5.00'); // needs two products
    expect(couponProblem(coupon({ max_uses: 3, used_count: 3 }), 10000, new Set(['coupon_limit_ignored']))).toBeNull();
  });
});
