import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveSession, SESSION_COOKIE } from '../auth/sessions.js';
import type { AppContext } from '../lib/context.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthedUser | null;
  }
}

export function registerAuth(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = await resolveSession(ctx.db, token);
  });
}

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function setSessionCookie(reply: FastifyReply, ctx: AppContext, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, ctx: AppContext) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.config.cookieSecure });
}
