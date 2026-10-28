import { XAsrModelManager } from './asr/xasrManager.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { createLlmClient } from './ai/llm.js';
import { createMailer } from './auth/mailer.js';
import { createAsrFactory } from './asr/factory.js';
import { KNOWN_STREAMING_MODELS } from './asr/qwenAudioStreaming.js';
import { TranscriptionRegistry } from './asr/registry.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { createLogger } from './lib/logger.js';
import { createStorage } from './storage/index.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const { db, pool } = createDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL });

if (process.env.RUN_MIGRATIONS !== 'false') {
  await runMigrations(db);
  logger.info('database migrations applied');
}

if (config.isProd && config.STORAGE_DRIVER === 'local') {
  logger.warn('STORAGE_DRIVER=local in production: uploaded files will be lost when the container restarts. Configure S3-compatible storage.');
}
if (config.isProd && !config.trustProxy) logger.warn('TRUST_PROXY is off in production: behind a proxy every client shares one IP for rate limiting. Set TRUST_PROXY=true when TLS is terminated by a proxy.');
if (config.isProd && !/^https:\/\//.test(config.APP_ORIGIN)) logger.warn({ appOrigin: config.APP_ORIGIN }, 'APP_ORIGIN is not https: password-reset links and Origin checks will be wrong in production');
if (!config.llmExtraBodyValid) logger.error('LLM_EXTRA_BODY is not a JSON object and is ignored');
if (config.ASR_PROVIDER === 'qwen-audio-streaming' && !KNOWN_STREAMING_MODELS.includes(config.asrModel)) logger.warn({ model: config.asrModel }, 'ASR_MODEL has no verified parameter profile; only core parameters (format, sample rate, language hints) will be sent');
if (!config.asrConfigured) logger.warn('Realtime ASR is not configured (set DASHSCOPE_API_KEY and DASHSCOPE_WORKSPACE_ID); live transcription is disabled' + (config.demoEnabled ? ', demo mode is available' : ''));
if (!config.llmConfigured) logger.warn('DASHSCOPE_API_KEY missing: AI summaries are disabled');

const ctx = {
  config,
  db,
  logger,
  storage: createStorage(config),
  mailer: createMailer({ smtpUrl: config.SMTP_URL, from: config.MAIL_FROM, logger, isProd: config.isProd }),
  asr: createAsrFactory(config),
  llm: createLlmClient(config),
  registry: new TranscriptionRegistry(),
};

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = process.env.WEB_DIR ?? path.resolve(here, '../../web/dist');
const app = await buildApp(ctx, { webDir });

await app.listen({ port: config.PORT, host: config.HOST });
setInterval(() => void purgeExpiredSessions(db).catch(() => {}), 6 * 3600_000).unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, live: ctx.registry.size() }, 'shutting down; flushing live transcription sessions');
  // Railway sends SIGTERM and allows a short grace period: persist everything in flight first.
  await Promise.race([ctx.registry.stopAll(), new Promise((r) => setTimeout(r, 8000))]);
  await app.close();
  const local = ctx.asr.live();
  if (local instanceof XAsrModelManager) await local.dispose();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
