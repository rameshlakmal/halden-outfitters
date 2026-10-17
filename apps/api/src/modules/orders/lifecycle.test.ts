import { describe, expect, it } from 'vitest';
import { allowedActions, canMove, returnWindowClosed, returnWindowEnds } from './lifecycle.ts';

describe('transitions', () => {
  it('follow the documented order of states and nothing else', () => {
    expect(canMove('pending_payment', 'confirmed')).toBe(true);
    expect(canMove('confirmed', 'shipped')).toBe(false);
    expect(canMove('shipped', 'cancelled')).toBe(false);
    expect(canMove('cancelled', 'confirmed')).toBe(false);
    expect(canMove('delivered', 'completed')).toBe(true);
  });
});

describe('who can do what', () => {
  const owner = { id: '1', role: 'customer' as const, isOwner: true };
  const stranger = { id: '2', role: 'customer' as const, isOwner: false };
  it('customers cancel their own orders until packed, and pay pending ones', () => {
    expect(allowedActions('pending_payment', owner)).toEqual(['pay', 'cancel']);
    expect(allowedActions('confirmed', owner)).toEqual(['cancel']);
    expect(allowedActions('packed', owner)).toEqual([]);
    expect(allowedActions('confirmed', stranger)).toEqual([]);
  });
  it('support cancels until shipped; the warehouse moves orders along', () => {
    expect(allowedActions('packed', { id: '9', role: 'support', isOwner: false })).toEqual(['cancel']);
    expect(allowedActions('shipped', { id: '9', role: 'support', isOwner: false })).toEqual([]);
    expect(allowedActions('confirmed', { id: '8', role: 'warehouse', isOwner: false })).toEqual(['pack']);
    expect(allowedActions('packed', { id: '8', role: 'warehouse', isOwner: false })).toEqual(['ship']);
    expect(allowedActions('shipped', { id: '8', role: 'warehouse', isOwner: false })).toEqual(['deliver']);
    expect(allowedActions('packed', { id: '7', role: 'admin', isOwner: false })).toEqual(['cancel', 'ship']);
  });
});

describe('return window', () => {
  const day = (s: string) => new Date(`${s}T12:00:00Z`);
  it('is 30 days from delivery, inclusive', () => {
    expect(returnWindowEnds(day('2026-03-01')).toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(returnWindowClosed(day('2026-03-01'), day('2026-03-31'))).toBe(false);
    expect(returnWindowClosed(day('2026-03-01'), new Date('2026-04-01T00:00:00Z'))).toBe(true);
  });
  it('runs until 31 January for deliveries from 15 November to 31 December', () => {
    expect(returnWindowEnds(day('2026-11-15')).toISOString().slice(0, 10)).toBe('2027-01-31');
    expect(returnWindowEnds(day('2026-12-31')).toISOString().slice(0, 10)).toBe('2027-01-31');
    expect(returnWindowEnds(day('2026-11-14')).toISOString().slice(0, 10)).toBe('2026-12-14');
  });
});
