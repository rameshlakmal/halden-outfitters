// Password policy (NIST SP 800-63B style): length matters, composition rules don't. 10 to 128 characters,
// not a well-known password, and not the account's own email or name.

const COMMON = new Set([
  '1234567890', '12345678910', '0123456789', '1111111111', '0000000000', 'qwertyuiop', 'password12', 'password123',
  'password1234', 'passw0rd123', 'iloveyou12', 'letmein123', 'welcome123', 'abc1234567', 'qwerty1234', 'admin12345',
  'administrator', 'changeme123', 'football12', 'baseball12', 'sunshine12', 'princess12', 'dragon1234', 'monkey1234',
  'trustno1234', 'superman12', 'qazwsxedcr', '1q2w3e4r5t', 'zaq12wsxcd', 'asdfghjkl1', 'halden1234', 'outfitters',
  'haldenoutfitters', 'camping123', 'hiking1234',
]);

/** Why `password` is not acceptable, or null when it is. Length is already checked by the request schema. */
export function passwordProblem(password: string, email: string, name: string): string | null {
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Choose something harder to guess.';
  if (lower === email.toLowerCase() || lower === email.split('@')[0]?.toLowerCase()) {
    return 'Your password must not be your email address.';
  }
  if (name.trim().length >= 3 && lower === name.trim().toLowerCase()) return 'Your password must not be your name.';
  if (/^(.)\1+$/.test(password)) return 'Your password must not be one character repeated.';
  return null;
}
