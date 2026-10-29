import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_COOKIE = 'mf_session';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function createSession(db: Db, userId: string, ttlDays: number, userAgent?: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const tokenHash = sha256(token);
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Touch at most once per hour to avoid a write on every request.
  if (Date.now() - row.lastSeenAt.getTime() > 3_600_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
  }
  return { id: row.id, email: row.email, name: row.name };
}

export async function destroySession(db: Db, token: string | undefined) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function destroyUserSessions(db: Db, userId: string, exceptToken?: string) {
  const rows = await db.select({ h: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
  const keep = exceptToken ? sha256(exceptToken) : null;
  for (const r of rows) if (r.h !== keep) await db.delete(sessions).where(eq(sessions.tokenHash, r.h));
}

export async function purgeExpiredSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
