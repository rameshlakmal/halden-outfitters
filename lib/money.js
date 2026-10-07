// @ts-check
// Money is handled in whole cents. Postgres numeric arrives as a string ("84.50") and goes back the same
// way, so no amount ever passes through floating point.

/**
 * "84.50" or 84.5 → 8450
 * @param {string | number} amount
 */
export function toCents(amount) {
  const s = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${amount}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

/**
 * 8450 → "84.50"
 * @param {number} cents
 */
export function fromCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * `cents` × `percent` %, rounded half up to the cent. Integer arithmetic only.
 * @param {number} cents
 * @param {number} percent  may have up to two decimals, e.g. 8 or 12.5
 */
export function percentOf(cents, percent) {
  const basisPoints = Math.round(percent * 100); // 8% → 800
  return Math.floor((cents * basisPoints + 5000) / 10000);
}
