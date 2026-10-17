// Emails are written to the outbox in the same transaction as the change that causes them, so an email is sent
// if and only if the change happened. This demo "sends" them straight to the fake inbox in the QA lab.
import type { Queryable } from './db.js';

type Templates = {
  verify_email: { name: string; link: string };
  password_reset: { name: string; link: string };
  password_changed: { name: string };
  account_locked: { name: string; minutes: number; resetLink: string };
  order_confirmed: { name: string; orderId: string; total: string; lines: string; link: string };
  order_cancelled: { name: string; orderId: string; reason: string; link: string };
  payment_failed: { name: string; orderId: string; link: string };
  order_shipped: { name: string; orderId: string; trackingNumber: string; link: string };
  order_delivered: { name: string; orderId: string; link: string };
  payment_disputed: { orderId: string; amount: string };
  return_requested: { name: string; returnId: string; orderId: string; link: string };
  return_approved: {
    name: string;
    returnId: string;
    labelCode: string;
    labelExpires: string;
    labelFee: string;
    link: string;
  };
  return_rejected: { name: string; returnId: string; reason: string; link: string };
  return_refunded: {
    name: string;
    returnId: string;
    amount: string;
    method: string;
    points: number;
    lines: string;
    link: string;
  };
  return_expired: { name: string; returnId: string; link: string };
  goodwill_refund: { name: string; orderId: string; amount: string; method: string; reason: string; link: string };
  review_hidden: { name: string; product: string; reason: string; link: string };
  low_stock: { product: string; sku: string; available: number; threshold: number; link: string };
};
export type Template = keyof Templates;

const RENDER: { [K in Template]: (d: Templates[K]) => { subject: string; body: string } } = {
  verify_email: (d) => ({
    subject: 'Confirm your email for Halden Outfitters',
    body: `Hi ${d.name},\n\nThanks for signing up. Confirm your email address to start checking out:\n\n${d.link}\n\nThe link works for 24 hours. If you didn't sign up, you can ignore this email.`,
  }),
  password_reset: (d) => ({
    subject: 'Reset your Halden Outfitters password',
    body: `Hi ${d.name},\n\nSomeone asked to reset the password for this account. To choose a new one, open:\n\n${d.link}\n\nThe link works for 1 hour and only once. If it wasn't you, ignore this email: your password stays the same.`,
  }),
  password_changed: (d) => ({
    subject: 'Your Halden Outfitters password was changed',
    body: `Hi ${d.name},\n\nYour password was just changed and every other device was signed out.\n\nIf this wasn't you, reset your password straight away from the sign-in page.`,
  }),
  account_locked: (d) => ({
    subject: 'Sign-in to your Halden Outfitters account is paused',
    body: `Hi ${d.name},\n\nThere were too many wrong passwords for your account, so sign-in is paused for ${d.minutes} minutes.\n\nIf this wasn't you, reset your password:\n\n${d.resetLink}`,
  }),
  order_confirmed: (d) => ({
    subject: `Order ${d.orderId} is confirmed`,
    body: `Hi ${d.name},\n\nThanks for your order. Your card is authorized for $${d.total}; it's charged when the order ships.\n\n${d.lines}\n\nTrack it here:\n${d.link}`,
  }),
  order_cancelled: (d) => ({
    subject: `Order ${d.orderId} is cancelled`,
    body: `Hi ${d.name},\n\nOrder ${d.orderId} was cancelled (${d.reason}). Nothing was charged: the hold on your card has been released.\n\n${d.link}`,
  }),
  payment_failed: (d) => ({
    subject: `We couldn't take payment for order ${d.orderId}`,
    body: `Hi ${d.name},\n\nYour card was declined, so order ${d.orderId} was not placed. Your cart is still waiting for you:\n\n${d.link}`,
  }),
  order_shipped: (d) => ({
    subject: `Order ${d.orderId} is on its way`,
    body: `Hi ${d.name},\n\nOrder ${d.orderId} has shipped and your card was charged. Tracking number: ${d.trackingNumber}.\n\n${d.link}`,
  }),
  order_delivered: (d) => ({
    subject: `Order ${d.orderId} was delivered`,
    body: `Hi ${d.name},\n\nOrder ${d.orderId} was delivered. You have 30 days from today to return anything that isn't right.\n\n${d.link}`,
  }),
  payment_disputed: (d) => ({
    subject: `Dispute opened on order ${d.orderId}`,
    body: `The card holder disputed the payment of $${d.amount} for order ${d.orderId}. Review the order in the staff console.`,
  }),
  return_requested: (d) => ({
    subject: `Return ${d.returnId} received for review`,
    body: `Hi ${d.name},\n\nWe have your return request ${d.returnId} for order ${d.orderId}. Our support team will look at it within 2 working days and email you.\n\n${d.link}`,
  }),
  return_approved: (d) => ({
    subject: `Return ${d.returnId} is approved`,
    body: `Hi ${d.name},\n\nYour return ${d.returnId} is approved. Your return label code is ${d.labelCode}; use it by ${d.labelExpires}.\n\nLabel fee taken off the refund: $${d.labelFee}\n\n${d.link}`,
  }),
  return_rejected: (d) => ({
    subject: `Return ${d.returnId} was not approved`,
    body: `Hi ${d.name},\n\nWe could not approve return ${d.returnId}: ${d.reason}\n\nReply to this email if you have questions.\n\n${d.link}`,
  }),
  return_refunded: (d) => ({
    subject: `Refund for return ${d.returnId}`,
    body: `Hi ${d.name},\n\nWe checked your return ${d.returnId}.\n\n${d.lines}\n\nRefund: $${d.amount} to your ${d.method}${d.points > 0 ? `, and ${d.points} points back` : ''}.\n\n${d.link}`,
  }),
  return_expired: (d) => ({
    subject: `Return ${d.returnId} has expired`,
    body: `Hi ${d.name},\n\nThe label for return ${d.returnId} was not used within 14 days, so the return has closed. You can start a new one while the order is still in its return window.\n\n${d.link}`,
  }),
  review_hidden: (d) => ({
    subject: `Your review of ${d.product} is hidden`,
    body: `Hi ${d.name},\n\nWe have hidden your review of ${d.product}: ${d.reason}\n\nYou can delete it, or reply to this email if you think this is a mistake.\n\n${d.link}`,
  }),
  low_stock: (d) => ({
    subject: `Low stock: ${d.product}`,
    body: `${d.product} (${d.sku}) is down to ${d.available} available, at or under its threshold of ${d.threshold}.\n\n${d.link}`,
  }),
  goodwill_refund: (d) => ({
    subject: `A refund on order ${d.orderId}`,
    body: `Hi ${d.name},\n\nWe have refunded $${d.amount} to your ${d.method} for order ${d.orderId}: ${d.reason}\n\n${d.link}`,
  }),
};

export async function queueEmail<K extends Template>(
  client: Queryable,
  to: string,
  template: K,
  data: Templates[K],
  at: Date,
): Promise<void> {
  const { subject, body } = RENDER[template](data);
  await client.query(
    `INSERT INTO outbox (to_email, template, subject, body_text, data, created_at, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [to, template, subject, body, JSON.stringify(data), at],
  );
}
