// npm run db:migrate: applies new migrations to DATABASE_URL.
import { Db } from '../src/core/db.js';
import { migrate } from '../src/core/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');
const db = new Db(url, 1);
try {
  const ran = await migrate(db, undefined, (m) => console.log(m));
  console.log(ran.length ? `${ran.length} migration(s) applied.` : 'Database is up to date.');
} finally {
  await db.close();
}
