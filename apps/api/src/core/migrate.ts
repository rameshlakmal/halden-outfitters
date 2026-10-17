// Forward-only SQL migrations. Files in db/migrations named NNNN_name.sql run in order, each in its own
// transaction. Applied files are recorded with a checksum: editing one that already ran is an error, so every
// database (local, CI, production) is built by exactly the same SQL. An advisory lock stops two deploys from
// migrating at once.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));
const LOCK_KEY = 72_616_001; // any fixed number, shared by every migrator of this database

type Applied = { version: number; checksum: string };

export async function migrate(db: Db, dir = MIGRATIONS_DIR, log: (msg: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const client = await db.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     int PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<Applied>('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const ran: string[] = [];

    for (const file of files) {
      const version = Number(file.slice(0, 4));
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const done = applied.get(version);
      if (done) {
        if (done !== checksum) throw new Error(`Migration ${file} was changed after it ran. Add a new migration instead.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [version, file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      log(`applied ${file}`);
      ran.push(file);
    }
    const known = new Set(files.map((f) => Number(f.slice(0, 4))));
    for (const v of applied.keys()) if (!known.has(v)) log(`warning: migration ${v} is in the database but not in ${dir}`);
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Drops the shop's schemas (local and test databases only). Propmaster's schema is left alone. */
export async function dropAll(db: Db): Promise<void> {
  await db.query('DROP SCHEMA IF EXISTS haldenpay CASCADE');
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
}
