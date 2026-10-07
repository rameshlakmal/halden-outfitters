// @ts-check
// One connection pool per process. On Vercel each function instance keeps its pool between requests;
// use the database's pooled connection string there (see README).
import pg from 'pg';

/** @type {pg.Pool | null} */
let pool = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      // Hosted Postgres (Neon, Supabase) needs TLS, with its certificate checked; a local database usually has none.
      ssl: /sslmode=require|neon\.tech|supabase\.co/.test(connectionString) ? true : undefined,
      application_name: 'halden-shop',
    });
  }
  return pool;
}

/**
 * Runs one query. Rows are as Postgres returns them (numeric as text), so they're typed loosely.
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<any[]>}
 */
export async function query(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

/**
 * Runs `fn` in a transaction: committed when it returns, rolled back when it throws.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool?.end();
  pool = null;
}
