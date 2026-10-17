// Money is handled in whole cents. Postgres numeric arrives as a string ("84.50") and goes back the same way,
// so no amount ever passes through floating point.

/** A money amount as the API and the database exchange it: "84.50". */
export type Amount = string;

/** "84.50" or 84.5 → 8450 */
export function toCents(amount: Amount | number): number {
  const s = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${amount}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

/** 8450 → "84.50" */
export function fromCents(cents: number): Amount {
  if (!Number.isSafeInteger(cents)) throw new Error(`Not a whole number of cents: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** `cents` × `percent` %, rounded half up to the cent. `percent` may have up to two decimals (8, 12.5). */
export function percentOf(cents: number, percent: number): number {
  const basisPoints = Math.round(percent * 100);
  return Math.floor((cents * basisPoints + 5000) / 10000);
}

/**
 * Splits `total` cents across `weights` in proportion, so the parts always add up to exactly `total`.
 * Each part is rounded down, then the leftover cents go one each to the parts with the largest remainders
 * (ties: the larger weight, then the earlier part). Used to spread an order discount over its lines.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`Cannot allocate ${total}`);
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0))
    throw new Error('Weights must be whole numbers, 0 or more');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    if (total === 0) return weights.map(() => 0);
    throw new Error('Cannot allocate an amount over zero weights');
  }
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, w, rem: (total * w) % sum }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left--;
  }
  return parts;
}

/** "84.50" → "$84.50", "-5.00" → "-$5.00", for display. Prices are in US dollars. */
export function formatAmount(amount: Amount | number): string {
  const cents = typeof amount === 'number' ? amount : toCents(amount);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}
