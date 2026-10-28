import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://meetfolio:meetfolio@127.0.0.1:5432/meetfolio_test';

/** Recreates the schema from the real migration files so tests exercise exactly what production runs. */
export default async function setup() {
  process.env.TEST_DATABASE_URL = TEST_DB_URL;
  const { db, pool } = createDb(TEST_DB_URL, { max: 2 });
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  await pool.end();
}
