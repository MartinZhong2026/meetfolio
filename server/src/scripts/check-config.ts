// Pre-deployment check for a staging/production environment. Reads the same environment the server would.
//   npm run check:config                 # validate variables only (offline)
//   npm run check:config -- --connect    # also connect to PostgreSQL and do a put/get/delete round-trip in the bucket
// It never calls DashScope (no paid API call); model availability must be checked with the live checklist.
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { sql } from 'drizzle-orm';
import { KNOWN_STREAMING_MODELS } from '../asr/qwenAudioStreaming.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createStorage } from '../storage/index.js';

const errors: string[] = [];
const warnings: string[] = [];
const ok: string[] = [];
const connect = process.argv.includes('--connect');

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error('✗ environment does not parse:', (e as Error).message);
  process.exit(1);
}

const mask = (v?: string) => (v ? `${v.slice(0, 3)}…(${v.length} chars)` : '(unset)');
const err = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

if (!config.isProd) warn(`NODE_ENV=${config.NODE_ENV} (staging should run with NODE_ENV=production)`);
if (!/^https:\/\//.test(config.APP_ORIGIN) || /localhost|127\.0\.0\.1/.test(config.APP_ORIGIN)) err(`APP_ORIGIN must be the public https origin users open (now ${config.APP_ORIGIN})`);
if (!config.cookieSecure) err('Session cookies are not Secure (COOKIE_SECURE=false or not production)');
if (!config.trustProxy) warn('TRUST_PROXY is off: behind Railway/any TLS proxy all clients share one IP for rate limiting');
if (!config.SIGNUP_ALLOWLIST.trim()) warn('SIGNUP_ALLOWLIST is empty: anyone who finds the URL can register and use your DashScope quota');
if (config.demoEnabled) warn('DEMO_MODE is enabled: synthetic demo meetings can be created');
if (config.DATABASE_URL === 'postgres://meetfolio:meetfolio@127.0.0.1:5432/meetfolio' || /@(localhost|127\.0\.0\.1)[:/]/.test(config.DATABASE_URL)) err('DATABASE_URL still points at the local development database');

if (config.STORAGE_DRIVER === 'local') err('STORAGE_DRIVER=local: uploaded documents would be lost on every redeploy (container filesystem is ephemeral). Use s3.');
else {
  try {
    createStorage(config);
    ok.push(`object storage: s3 bucket=${config.S3_BUCKET} endpoint=${config.S3_ENDPOINT ?? '(AWS default)'} pathStyle=${config.S3_FORCE_PATH_STYLE}`);
  } catch (e) {
    err((e as Error).message);
  }
}

if (!config.DASHSCOPE_API_KEY) err('DASHSCOPE_API_KEY is unset: live transcription and AI summaries are disabled');
else ok.push(`DASHSCOPE_API_KEY ${mask(config.DASHSCOPE_API_KEY)}`);
if (!config.asrWsUrl) err('No ASR endpoint: set DASHSCOPE_WORKSPACE_ID (qwen-audio models use a workspace host) or ASR_WS_URL');
else ok.push(`ASR ${config.ASR_PROVIDER} model=${config.asrModel} endpoint=${config.asrWsUrl}`);
if (config.ASR_PROVIDER === 'qwen-audio-streaming' && !KNOWN_STREAMING_MODELS.includes(config.asrModel)) warn(`ASR_MODEL=${config.asrModel} has no verified parameter profile (known: ${KNOWN_STREAMING_MODELS.join(', ')})`);
ok.push(`LLM standard=${config.LLM_MODEL_STANDARD} quality=${config.LLM_MODEL_QUALITY} endpoint=${config.llmBaseUrl}`);
if (!config.llmExtraBodyValid) err('LLM_EXTRA_BODY is not a JSON object');
if (!config.SMTP_URL) warn('SMTP_URL unset: password-reset emails are not sent (operators reset with npm run user:reset-password)');

// DNS only — resolves the provider hosts without opening an API session.
for (const host of new Set(([config.asrWsUrl, config.llmBaseUrl].filter(Boolean) as string[]).map((u) => new URL(u).hostname))) {
  try {
    await lookup(host);
    ok.push(`DNS ok: ${host}`);
  } catch {
    warn(`DNS lookup failed for ${host} (check DASHSCOPE_WORKSPACE_ID / region, or network)`);
  }
}

if (connect) {
  const { db, pool } = createDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL, max: 1 });
  try {
    await db.execute(sql`select 1`);
    const r = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => null);
    ok.push(`PostgreSQL reachable; migrations applied: ${r ? (r.rows[0] as { n: number }).n : 0} (the server applies pending ones on boot)`);
  } catch (e) {
    err(`PostgreSQL connection failed: ${(e as Error).message}${config.DATABASE_SSL ? '' : ' (try DATABASE_SSL=true for public/TLS-only URLs)'}`);
  } finally {
    await pool.end();
  }
  if (config.STORAGE_DRIVER === 's3') {
    try {
      const storage = createStorage(config);
      const key = `healthcheck/${randomUUID()}.txt`;
      await storage.put(key, Buffer.from('meetfolio'), 'text/plain');
      const back = (await storage.get(key)).toString();
      await storage.delete(key);
      if (back !== 'meetfolio') throw new Error('read-back mismatch');
      ok.push('object storage round-trip (put/get/delete) ok');
    } catch (e) {
      err(`object storage round-trip failed: ${(e as Error).message}`);
    }
  }
}

for (const m of ok) console.log(`✓ ${m}`);
for (const m of warnings) console.log(`! ${m}`);
for (const m of errors) console.log(`✗ ${m}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)${connect ? '' : ' — run with --connect to test the database and bucket'}`);
process.exit(errors.length ? 1 : 0);
