import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Resolves the migrations folder both from src/ (tsx) and dist/ (compiled). */
export function migrationsFolder() {
  return path.resolve(here, '../../drizzle');
}

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
