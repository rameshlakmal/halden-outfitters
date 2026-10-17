// npm run db:set-passwords: gives the seeded demo accounts the passwords now in the environment
// (SEED_ADMIN_PASSWORD, SEED_STAFF_PASSWORD, SEED_SHOPPER_PASSWORD) without reseeding, so the shop's data stays.
// Their sessions are revoked, so a changed password takes effect everywhere. Passwords are never printed.
//   Local: npm run db:set-passwords      Neon: npx tsx --env-file=../../.env.neon scripts/set-passwords.ts
import { hashPassword, verifyPassword } from '../src/core/crypto.js';
import { Db } from '../src/core/db.js';
import { ACCOUNTS } from './seed-data.js';
import { seedPasswordsFromEnv } from './seed-lib.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');
const passwords = seedPasswordsFromEnv(); // also refuses missing or repeated values
const db = new Db(url, 1);
try {
  const hashes = {
    admin: await hashPassword(passwords.admin),
    staff: await hashPassword(passwords.staff),
    shopper: await hashPassword(passwords.shopper),
  };
  await db.tx(async (tx) => {
    for (const a of ACCOUNTS) {
      const kind = a.role === 'admin' ? 'admin' : a.staff ? 'staff' : 'shopper';
      const { rowCount } = await tx.query(
        `UPDATE customers SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now()
          WHERE email = $1 AND is_demo`,
        [a.email, hashes[kind]],
      );
      await tx.query(
        `UPDATE sessions SET revoked_at = now()
          WHERE revoked_at IS NULL AND customer_id = (SELECT id FROM customers WHERE email = $1)`,
        [a.email],
      );
      console.log(`${a.email.padEnd(24)} ${rowCount ? `updated (${kind} password)` : 'not found'}`);
    }
  });
  // Check what was stored, the way sign-in will.
  for (const a of ACCOUNTS) {
    const kind = a.role === 'admin' ? 'admin' : a.staff ? 'staff' : 'shopper';
    const row = await db.one<{ password_hash: string }>('SELECT password_hash FROM customers WHERE email = $1', [
      a.email,
    ]);
    const ok = row ? await verifyPassword(row.password_hash, passwords[kind]) : false;
    console.log(`${a.email.padEnd(24)} sign-in check: ${ok ? 'ok' : 'FAILED'}`);
  }
} finally {
  await db.close();
}
