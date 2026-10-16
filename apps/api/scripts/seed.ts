// npm run db:seed: replaces the shop's data with the demo data (the schema stays).
import { Db } from '../src/core/db.js';
import { seed, seedPasswordsFromEnv } from './seed-lib.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');
const db = new Db(url, 1);
try {
  console.log(await seed(db, seedPasswordsFromEnv()));
} finally {
  await db.close();
}
