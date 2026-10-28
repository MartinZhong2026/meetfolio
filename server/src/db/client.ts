import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(url: string, opts: { ssl?: boolean; max?: number } = {}) {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
  });
  // A broken idle client must not crash the process.
  pool.on('error', () => {});
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
