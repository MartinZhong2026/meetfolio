import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dummyHash, hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, destroySession, destroyUserSessions, newToken, SESSION_COOKIE, sha256 } from '../auth/sessions.js';
import { passwordResets, users } from '../db/schema.js';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors.js';
import type { AppContext } from '../lib/context.js';
import { clearSessionCookie, requireUser, setSessionCookie } from '../plugins/auth.js';

const email = z.string().trim().toLowerCase().email('请输入有效的邮箱地址').max(254);
const password = z.string().min(8, '密码至少需要 8 位').max(200);

const registerBody = z.object({ email, password, name: z.string().trim().max(60).optional() });
const loginBody = z.object({ email, password: z.string().min(1).max(200) });

export function publicUser(u: { id: string; email: string; name: string }) {
  return { id: u.id, email: u.email, name: u.name };
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const strict = { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', strict, async (req, reply) => {
    const body = registerBody.safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? '请求参数无效');
    const { email: addr, password: pw, name } = body.data;
    if (!config.signupAllowed(addr)) throw new HttpError(403, 'signup_closed', '当前仅限受邀用户注册，请联系管理员');
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, addr)).limit(1);
    if (existing) throw conflict('该邮箱已注册，请直接登录', 'email_taken');
    const passwordHash = await hashPassword(pw);
    let user;
    try {
      [user] = await db.insert(users).values({ email: addr, passwordHash, name: name ?? addr.split('@')[0]! }).returning();
    } catch {
      throw conflict('该邮箱已注册，请直接登录', 'email_taken');
    }
    const s = await createSession(db, user!.id, config.SESSION_TTL_DAYS, req.headers['user-agent']);
    setSessionCookie(reply, ctx, s.token, s.expiresAt);
    return { user: publicUser(user!) };
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) throw badRequest('请输入邮箱和密码');
    const { email: addr, password: pw } = body.data;
    const [user] = await db.select().from(users).where(eq(users.email, addr)).limit(1);
    // Always run one verification so response time does not reveal whether the account exists.
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), pw);
    if (!user || !ok) throw unauthorized('邮箱或密码不正确', 'invalid_credentials');
    const s = await createSession(db, user.id, config.SESSION_TTL_DAYS, req.headers['user-agent']);
    setSessionCookie(reply, ctx, s.token, s.expiresAt);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(db, req.cookies?.[SESSION_COOKIE]);
    clearSessionCookie(reply, ctx);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    return { user: req.user ? publicUser(req.user) : null };
  });

  app.post('/api/auth/forgot', strict, async (req) => {
    const body = z.object({ email }).safeParse(req.body);
    // Always answer the same way so the endpoint cannot be used to enumerate accounts.
    if (!body.success) return { ok: true };
    const [user] = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
    if (user) {
      const token = newToken();
      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
      const link = `${config.APP_ORIGIN.replace(/\/$/, '')}/reset-password?token=${token}`;
      try {
        await ctx.mailer.send(
          user.email,
          'Meetfolio 重置密码',
          `您好，\n\n请在 1 小时内点击以下链接重置 Meetfolio 密码：\n${link}\n\n如果这不是您本人的操作，请忽略此邮件。`,
        );
      } catch (err) {
        ctx.logger.error({ err: (err as Error).message }, 'password reset email failed');
      }
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', strict, async (req) => {
    const body = z.object({ token: z.string().min(20).max(200), password }).safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? '链接无效或已过期');
    const tokenHash = sha256(body.data.token);
    const [row] = await db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, tokenHash), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
      .limit(1);
    if (!row) throw badRequest('重置链接无效或已过期，请重新申请', 'invalid_reset_token');
    const passwordHash = await hashPassword(body.data.password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));
    });
    await destroyUserSessions(db, row.userId);
    return { ok: true };
  });

  // Account settings -------------------------------------------------------

  app.patch('/api/account', async (req) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!body.success) throw badRequest('请输入有效的姓名');
    const [u] = await db.update(users).set({ name: body.data.name, updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
    return { user: publicUser(u!) };
  });

  app.post('/api/account/password', strict, async (req) => {
    const user = requireUser(req);
    const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }).safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? '请求参数无效');
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!u || !(await verifyPassword(u.passwordHash, body.data.currentPassword))) throw unauthorized('当前密码不正确', 'invalid_credentials');
    await db.update(users).set({ passwordHash: await hashPassword(body.data.newPassword), updatedAt: new Date() }).where(eq(users.id, user.id));
    await destroyUserSessions(db, user.id, req.cookies?.[SESSION_COOKIE]);
    return { ok: true };
  });

  app.delete('/api/account', strict, async (req, reply) => {
    const user = requireUser(req);
    const body = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) throw badRequest('请输入密码以确认删除');
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!u || !(await verifyPassword(u.passwordHash, body.data.password))) throw unauthorized('密码不正确', 'invalid_credentials');
    // Remove stored files first; DB rows cascade from the user row.
    const { removeAllUserFiles } = await import('../docs/files.js');
    await removeAllUserFiles(ctx, user.id);
    await db.delete(users).where(eq(users.id, user.id));
    clearSessionCookie(reply, ctx);
    return { ok: true };
  });
}
