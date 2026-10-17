import { describe, expect, it } from 'vitest';
import { gradedLine, restocks, returnTotal, unitRefund, unitShare } from './maths.js';

describe('unitShare', () => {
  it('adds up to the whole line however the units are split', () => {
    for (const amount of [1, 7, 999, 1234, 10_001]) {
      for (const qty of [1, 2, 3, 7]) {
        let sum = 0;
        for (let before = 0; before < qty; before++) sum += unitShare(amount, qty, before, 1);
        expect(sum).toBe(amount);
        expect(unitShare(amount, qty, 0, qty)).toBe(amount);
      }
    }
  });
});

describe('unitRefund', () => {
  const line = { qty: 2, lineTotal: 10_000, discount: 2000, points: 1000, tax: 560, pointsEarned: 70 };

  it('refunds goods minus coupon and points shares plus tax, and gives the points share back as points', () => {
    expect(unitRefund(line, 0, 1)).toEqual({ cash: 5000 - 1000 - 500 + 280, pointsBack: 100, pointsEarned: 35 });
    expect(unitRefund(line, 0, 2).cash).toBe(10_000 - 2000 - 1000 + 560);
  });

  it('planted bug refund_ignores_discount keeps the coupon share in', () => {
    expect(unitRefund(line, 0, 1, { ignoreDiscount: true }).cash).toBe(5000 - 500 + 280);
  });
});

describe('gradedLine', () => {
  it('as new and faulty refund in full; opened pays 15% unless the shop was at fault', () => {
    expect(gradedLine(10_000, 10, 'as_new', false)).toEqual({ refund: 10_000, restockingFee: 0, pointsBack: 10 });
    expect(gradedLine(10_000, 10, 'faulty', false)).toEqual({ refund: 10_000, restockingFee: 0, pointsBack: 10 });
    expect(gradedLine(10_000, 10, 'opened', false)).toEqual({ refund: 8500, restockingFee: 1500, pointsBack: 10 });
    expect(gradedLine(10_000, 10, 'opened', true)).toEqual({ refund: 10_000, restockingFee: 0, pointsBack: 10 });
  });

  it('damaged by the customer gets nothing', () => {
    expect(gradedLine(10_000, 10, 'damaged_by_customer', true)).toEqual({ refund: 0, restockingFee: 0, pointsBack: 0 });
  });
});

describe('returnTotal', () => {
  it('takes the label fee off the goods but never below zero, then adds shipping', () => {
    expect(returnTotal([3000, 2000], 495, 0)).toEqual({ labelFee: 495, total: 4505 });
    expect(returnTotal([0], 495, 0)).toEqual({ labelFee: 0, total: 0 });
    expect(returnTotal([5000], 0, 795)).toEqual({ labelFee: 0, total: 5795 });
  });
});

describe('restocks', () => {
  it('only sellable conditions go back on the shelf, unless planted bug restock_damaged', () => {
    expect(['as_new', 'opened', 'damaged_by_customer', 'faulty'].map((c) => restocks(c as never, false))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(restocks('faulty', true)).toBe(true);
  });
});
