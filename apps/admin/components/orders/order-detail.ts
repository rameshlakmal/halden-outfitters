// What a payment's status means, in words (from the shop's order page).
import type { Order } from '@halden/contracts';
import { formatAmount } from '@halden/money';

export function paymentText(p: NonNullable<Order['payment']>): string {
  switch (p.status) {
    case 'requires_action':
      return 'Waiting for your bank to confirm.';
    case 'authorized':
      return `${formatAmount(p.amount)} held on your card. It is charged when we ship.`;
    case 'captured':
      return `${formatAmount(p.captured)} charged.`;
    case 'voided':
      return 'The hold was released. Nothing was charged.';
    case 'failed':
      return 'The payment did not go through. Nothing was charged.';
    case 'partially_refunded':
      return `${formatAmount(p.captured)} charged, ${formatAmount(p.refunded)} refunded.`;
    case 'refunded':
      return `${formatAmount(p.refunded)} refunded in full.`;
  }
}
