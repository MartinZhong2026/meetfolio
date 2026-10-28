/**
 * Self-contained server for browser tests: the real application (API, WebSocket pipeline, adapters, summary
 * generator) wired to LOCAL mock DashScope endpoints, so no paid API is ever called. Not used in production.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createLlmClient } from '../src/ai/llm.js';
import { createAsrFactory } from '../src/asr/factory.js';
import { TranscriptionRegistry } from '../src/asr/registry.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/lib/logger.js';
import { MemoryStorage } from '../src/storage/index.js';
import { defaultSummaryJson } from './helpers.js';
import { inferenceHandler, startMock } from './mock-dashscope.js';

const PORT = Number(process.env.E2E_PORT ?? 8799);
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://meetfolio:meetfolio@127.0.0.1:5432/meetfolio_e2e';

// 1) The database is created fresh for every run.
const admin = createDb(DB.replace(/\/[^/]+$/, '/postgres'), { max: 1 });
await admin.db.execute(sql`drop database if exists meetfolio_e2e`);
await admin.db.execute(sql`create database meetfolio_e2e`);
await admin.pool.end();
const { db, pool } = createDb(DB, { max: 8 });
await runMigrations(db);

// 2) Mock ASR: speaks the DashScope inference protocol and "recognises" one sentence every 3 s of audio.
const LINES = ['您觉得现在社区养老服务最需要改善的是什么？', '我觉得最大的困难还是护理人员不足，而且专业培训也不够。', '培训之后有没有明确的考核制度呢？', '考核比较形式化，主要是看有没有出勤。'];
const asrConns = new Set<import('ws').WebSocket>();
const mockAsr = await startMock((ws, rec, s) => {
  asrConns.add(ws);
  ws.on('close', () => asrConns.delete(ws));
  inferenceHandler({
    sentences: (ms) => {
      const out: any[] = [];
      for (let k = 1; k <= Math.floor(ms / 3000); k++) {
        const text = LINES[(k - 1) % LINES.length]!;
        out.push({ __n: 2 * k - 1, begin_time: (k - 1) * 3000 + 200, end_time: null, text: text.slice(0, 6) });
        out.push({ __n: 2 * k, begin_time: (k - 1) * 3000 + 200, end_time: k * 3000 - 300, text });
      }
      return out;
    },
  })(ws, rec);
  void s;
});

// 3) Mock LLM: OpenAI-compatible streaming endpoint that answers from the evidence ids found in the prompt.
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const text = defaultSummaryJson({ model: parsed.model, messages: parsed.messages });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const mid = Math.floor(text.length / 2);
    res.write(`data: ${JSON.stringify({ model: parsed.model, choices: [{ delta: { content: text.slice(0, mid) } }] })}\n\n`);
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(mid) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    }, 300);
  });
});
await new Promise<void>((r) => llm.listen(0, '127.0.0.1', r));
const llmPort = (llm.address() as import('node:net').AddressInfo).port;

const config = loadConfig({
  NODE_ENV: 'development',
  DATABASE_URL: DB,
  APP_ORIGIN: `http://127.0.0.1:${PORT}`,
  EXTRA_ALLOWED_ORIGINS: `http://localhost:${PORT}`,
  DASHSCOPE_API_KEY: 'sk-e2e-mock',
  ASR_WS_URL: `${mockAsr.url}/api-ws/v1/inference`,
  LLM_BASE_URL: `http://127.0.0.1:${llmPort}`,
  DEMO_MODE: 'true',
  ASR_RECONNECT_BASE_MS: '200',
  ASR_RECONNECT_MAX_MS: '1000',
  ASR_RECOVERY_SPEED: '20',
  PORT: String(PORT),
} as NodeJS.ProcessEnv);

const ctx = {
  config,
  db,
  logger: createLogger('warn'),
  storage: new MemoryStorage(),
  mailer: { async send() { return { delivered: false }; } },
  asr: createAsrFactory(config),
  llm: createLlmClient(config),
  registry: new TranscriptionRegistry(),
};
const here = path.dirname(fileURLToPath(import.meta.url));
const app = await buildApp(ctx, { webDir: path.resolve(here, '../../web/dist') });

// Fault injection for tests (only exists in this harness).
let blockWs = false;
app.addHook('onRequest', async (req, reply) => {
  if (blockWs && req.url.startsWith('/ws/')) return reply.code(503).send();
});
app.post('/__e2e/block-browser-ws', async (req) => {
  blockWs = Boolean((req.body as { down: boolean }).down);
  return { blockWs };
});
app.post('/__e2e/kill-browser-sockets', async () => {
  let n = 0;
  for (const c of (app as unknown as { websocketServer: { clients: Set<import('ws').WebSocket> } }).websocketServer.clients) (c.terminate(), n++);
  return { killed: n };
});
app.post('/__e2e/kill-provider', async () => {
  const n = asrConns.size;
  for (const c of asrConns) c.terminate();
  return { killed: n };
});
app.post('/__e2e/seed-segments', async (req) => {
  const { meetingId, count } = req.body as { meetingId: string; count: number };
  await db.execute(sql`
    insert into transcript_segments (meeting_id, seq, dedupe_key, start_ms, end_ms, original_text, source)
    select ${meetingId}::uuid, g, 'seed-' || g, g * 4000, g * 4000 + 3500, '第' || g || '段：我觉得护理人员不足，而且专业培训也不够，流动率很高，这是比较普遍的情况。', 'live'
    from generate_series(1, ${count}) g`);
  await db.execute(sql`update meetings set next_seq = ${count + 1}, recorded_ms = ${count * 4000}, duration_ms = ${count * 4000}, transcript_status = 'complete' where id = ${meetingId}::uuid`);
  return { ok: true };
});
app.post('/__e2e/provider-down', async (req) => {
  mockAsr.rejectWith = (req.body as { down: boolean }).down ? 503 : undefined;
  return { ok: true };
});

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`e2e server ready on ${PORT}`);
void pool;
