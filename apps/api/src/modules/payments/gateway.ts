// The payment gateway as the shop sees it. HaldenPay (haldenpay.ts) is a mock that behaves like a real card
// provider; a Stripe adapter would implement the same interface.
//
// Flow: authorize at checkout (money is held, not taken), capture when the order ships (money is taken),
// void if an authorized order is cancelled (the hold is dropped, nothing to refund), refund after capture.
import type { Queryable } from '../../core/db.js';

export type AuthorizeInput = { orderId: string; amount: string; cardNumber: string; returnUrl: string };

export type AuthorizeResult =
  | { status: 'authorized'; intentId: string; brand: string; last4: string }
  | { status: 'requires_action'; intentId: string; brand: string; last4: string; actionUrl: string }
  | { status: 'failed'; intentId: string; brand: string; last4: string; code: 'card_declined' | 'insufficient_funds' };

export interface PaymentGateway {
  authorize(client: Queryable, input: AuthorizeInput): Promise<AuthorizeResult>;
  /** The customer's answer at the bank step. */
  authenticate(
    client: Queryable,
    actionToken: string,
    approve: boolean,
  ): Promise<{ intentId: string; status: 'authorized' | 'failed' }>;
  capture(client: Queryable, intentId: string, amount: string): Promise<void>;
  void(client: Queryable, intentId: string): Promise<void>;
  refund(client: Queryable, intentId: string, amount: string): Promise<void>;
}
