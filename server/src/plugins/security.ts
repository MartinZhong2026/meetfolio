import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../lib/context.js';
import { forbidden } from '../lib/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originAllowed(ctx: AppContext, origin: string | undefined, host: string | undefined) {
  if (!origin) return false;
  const o = origin.replace(/\/$/, '');
  if (ctx.config.allowedOrigins.includes(o)) return true;
  // Same-origin deployment (API + static web on one host).
  if (host && (o === `https://${host}` || o === `http://${host}`)) return true;
  return false;
}

/** CSRF / cross-site WebSocket hijacking defence: state-changing requests must carry an allowed Origin. */
export function registerOriginCheck(app: FastifyInstance, ctx: AppContext) {
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/ws/')) return;
    const isWs = req.url.startsWith('/ws/');
    if (SAFE.has(req.method) && !isWs) return;
    const origin = req.headers.origin;
    // Non-browser clients (curl, tests with no Origin) send no Origin; the cookie is still required,
    // and browsers always attach Origin to cross-site POSTs and WebSocket upgrades.
    if (!origin) return;
    if (!originAllowed(ctx, origin, req.headers.host)) throw forbidden('请求来源不被允许', 'bad_origin');
  });
}
