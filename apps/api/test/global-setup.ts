// Once per test run: rebuild the test database from the migrations, so tests always run on today's schema.
import { Db } from '../src/core/db.js';
import { dropAll, migrate } from '../src/core/migrate.js';
import { testDbUrl } from './helpers.js';

export default async function setup() {
  const db = new Db(testDbUrl(), 1);
  try {
    await dropAll(db);
    await migrate(db);
  } finally {
    await db.close();
  }
}
