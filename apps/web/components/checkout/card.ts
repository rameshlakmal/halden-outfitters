// Card form values and checks, done in the browser for quick feedback. The API checks again.

export type CardValues = { number: string; expiry: string; cvc: string; name: string };
export type CardErrors = Partial<Record<keyof CardValues, string>>;

export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', label: 'Pays' },
  { number: '4000 0000 0000 0002', label: 'Declined' },
  { number: '4000 0000 0000 9995', label: 'Insufficient funds' },
  { number: '4000 0000 0000 3220', label: 'Bank check first' },
  { number: '4000 0000 0000 0259', label: 'Pays, then disputed' },
];

export const digits = (s: string) => s.replace(/\D/g, '');

/** "4242424242424242" -> "4242 4242 4242 4242" while typing. */
export const formatNumber = (s: string) =>
  digits(s)
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, '$1 ');

/** "1230" -> "12 / 30" while typing. */
export function formatExpiry(s: string) {
  const d = digits(s).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
}

export function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function parseExpiry(expiry: string): { month: number; year: number } | null {
  const d = digits(expiry);
  if (d.length !== 4) return null;
  const month = Number(d.slice(0, 2));
  const year = 2000 + Number(d.slice(2));
  if (month < 1 || month > 12) return null;
  return { month, year };
}

export function checkCard(v: CardValues, now = new Date()): CardErrors {
  const e: CardErrors = {};
  const n = digits(v.number);
  if (n.length !== 16) e.number = 'Enter the 16 digits on the card.';
  else if (!luhn(n)) e.number = 'That card number is not valid. Check for a typo.';
  const exp = parseExpiry(v.expiry);
  if (!exp) e.expiry = 'Enter the month and year, like 12 / 30.';
  else if (exp.year < now.getFullYear() || (exp.year === now.getFullYear() && exp.month < now.getMonth() + 1)) {
    e.expiry = 'This card has expired.';
  }
  if (!/^\d{3,4}$/.test(v.cvc)) e.cvc = 'Enter the 3 or 4 digit code.';
  if (!v.name.trim()) e.name = 'Enter the name on the card.';
  return e;
}

export const brandOf = (number: string) => {
  const n = digits(number);
  if (n.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  return 'Card';
};
