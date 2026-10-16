import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

/** A random token for a cookie or an email link (256 bits, URL-safe). */
export const newToken = () => randomBytes(32).toString('base64url');

/** What is stored for a token: its SHA-256, so the database never holds anything replayable. */
export const tokenHash = (token: string) => createHash('sha256').update(token).digest();

// argon2id with OWASP's minimum: 19 MiB memory, 2 iterations, 1 lane.
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argonHash(password, ARGON);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(stored, password);
  } catch {
    return false;
  }
}

/** A real hash of nothing, checked when the email is unknown, so a login takes the same time either way. */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password-just-for-timing');
  await verifyPassword(await dummy, password);
}
