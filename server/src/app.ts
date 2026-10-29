import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { realClock, type Clock } from './lib/clock.js';
import type { AppContext } from './lib/context.js';
import { HttpError } from './lib/errors.js';
import { registerAuth } from './plugins/auth.js';
import { registerOriginCheck } from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { contentRoutes } from './routes/content.js';
import { exportRoutes } from './routes/exports.js';
import { gapRoutes } from './routes/gaps.js';
import { meetingRoutes } from './routes/meetings.js';
import { failStaleSummaries, summaryRoutes } from './routes/summaries.js';
import { wsRoutes } from './routes/ws.js';
import { usageSummary } from './lib/limits.js';
import { requireUser } from './plugins/auth.js';

export interface BuildOptions {
  clock?: Clock;
  /** Directory containing the built web app (index.html). Omitted in API-only setups/tests. */
  webDir?: string;
  rateLimit?: boolean;
}

export async function buildApp(ctx: AppContext, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  // The pino Logger type is structurally richer than FastifyBaseLogger; erase it so route modules stay simple.
  const app = Fastify({
    loggerInstance: ctx.logger,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  }) as unknown as FastifyInstance;

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    // Microphone is required by the app itself; everything else is switched off.
    reply.header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    if (config.isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'bad_request', message: '请求参数无效' } });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试' } });
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413) return reply.code(413).send({ error: { code: 'file_too_large', message: `文件过大，请上传不超过 ${config.MAX_UPLOAD_MB} MB 的文件` } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: '请求无效' } });
    // Never echo internal details (and never log request bodies: they may contain transcript text).
    req.log.error({ code: e.code, msg: e.message }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: '服务器出了点问题，请稍后重试' } });
  });

  await app.register(fastifyCookie);
  if (opts.rateLimit !== false) {
    await app.register(fastifyRateLimit, {
      global: true,
      max: config.RATE_LIMIT_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.cookies?.mf_session?.slice(0, 16) ?? req.ip,
      allowList: (req) => !req.url.startsWith('/api/'),
    });
  }
  await app.register(fastifyMultipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(fastifyWebsocket, { options: { maxPayload: 128 * 1024 } });

  registerOriginCheck(app, ctx);
  registerAuth(app, ctx);

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/account/usage', async (req) => usageSummary(ctx, requireUser(req).id));

  await authRoutes(app, ctx);
  await meetingRoutes(app, ctx);
  await contentRoutes(app, ctx);
  await gapRoutes(app, ctx);
  await summaryRoutes(app, ctx);
  await exportRoutes(app, ctx);
  await wsRoutes(app, ctx, opts.clock ?? realClock);
  await failStaleSummaries(ctx);

  if (opts.webDir && fs.existsSync(path.join(opts.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false, index: false, maxAge: '1h', immutable: false });
    const indexHtml = fs.readFileSync(path.join(opts.webDir, 'index.html'));
    app.get('/assets/*', async (req, reply) => reply.sendFile(req.url.split('?')[0]!.slice(1), { maxAge: '1y', immutable: true } as never));
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) return reply.code(404).send({ error: { code: 'not_found', message: '未找到' } });
      const rel = req.url.split('?')[0]!.slice(1);
      if (rel && fs.existsSync(path.join(opts.webDir!, rel)) && fs.statSync(path.join(opts.webDir!, rel)).isFile()) return reply.sendFile(rel);
      return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(indexHtml);
    });
  }
  return app;
}
