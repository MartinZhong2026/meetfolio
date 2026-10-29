// Operator fallback for account recovery when SMTP is not configured:
//   npm run user:reset-password -w server -- someone@example.edu.cn 'new-password'
import { eq } from 'drizzle-orm';
import { destroyUserSessions } from '../auth/sessions.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('usage: reset-password <email> <new-password (min 8 chars)>');
  process.exit(1);
}
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL });
const [u] = await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.email, email.toLowerCase())).returning({ id: users.id });
if (u) await destroyUserSessions(db, u.id);
console.log(u ? 'password updated; existing sessions revoked' : 'no such user');
await pool.end();
