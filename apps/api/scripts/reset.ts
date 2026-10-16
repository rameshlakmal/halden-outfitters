// npm run db:reset: drops every shop table, runs all migrations and seeds the demo data. Local databases only.
import { Db } from '../src/core/db.js';
import { dropAll, migrate } from '../src/core/migrate.js';
import { seed, seedPasswordsFromEnv } from './seed-lib.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');
if (!/localhost|127\.0\.0\.1/.test(url) && process.argv[2] !== '--yes-really') {
  throw new Error('db:reset only runs against a local database. Pass --yes-really to reset a remote one.');
}
const db = new Db(url, 1);
try {
  await dropAll(db);
  await migrate(db, undefined, (m) => console.log(m));
  console.log(await seed(db, seedPasswordsFromEnv()));
} finally {
  await db.close();
}
