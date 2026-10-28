import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { disposableDatabaseUrl } from './database-safety.js';

export const TEST_DB_URL = disposableDatabaseUrl(process.env.TEST_DATABASE_URL, 'meetfolio_test');

/** Recreates the schema from the real migration files so tests exercise exactly what production runs. */
export default async function setup() {
  process.env.TEST_DATABASE_URL = TEST_DB_URL;
  const { db, pool } = createDb(TEST_DB_URL, { max: 2 });
  try {
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
  } finally {
    await pool.end();
  }
}
