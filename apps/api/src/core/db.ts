// One connection pool per process. On Vercel each function instance keeps its pool between requests, so use
// the database's *pooled* connection string there and keep DB_POOL_MAX small.
import pg from 'pg';

// pg's defaults are what we want: numeric stays a string ("84.50"), so money never passes through floating
// point, and bigint ids stay strings, as the API exchanges them.

export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export class Db {
  readonly pool: pg.Pool;

  constructor(connectionString: string, max: number) {
    this.pool = new pg.Pool({
      connectionString,
      max,
      // Hosted Postgres (Neon) needs TLS with its certificate checked; a local database usually has none.
      ssl: /sslmode=require|neon\.tech/.test(connectionString) ? true : undefined,
      application_name: 'halden-api',
      idleTimeoutMillis: 10_000,
    });
  }

  /** Runs one query and returns its rows. */
  async query<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
    client: Queryable = this.pool,
  ): Promise<T[]> {
    const { rows } = await client.query<T>(text, params);
    return rows;
  }

  async one<T extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
    client: Queryable = this.pool,
  ): Promise<T | undefined> {
    return (await this.query<T>(text, params, client))[0];
  }

  /** Runs `fn` in a transaction: committed when it returns, rolled back when it throws. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
