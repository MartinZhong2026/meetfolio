import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL });
await runMigrations(db);
await pool.end();
console.log('migrations applied');
