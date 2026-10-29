import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import type { LlmClient, LlmRequest, LlmResult } from '../src/ai/llm.js';
import { createMailer, type Mailer } from '../src/auth/mailer.js';
import { DemoAsrProvider } from '../src/asr/demo.js';
import { TranscriptionRegistry } from '../src/asr/registry.js';
import type { AsrProvider, AsrProviderFactory } from '../src/asr/types.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { createLogger } from '../src/lib/logger.js';
import type { AppContext } from '../src/lib/context.js';
import { MemoryStorage } from '../src/storage/index.js';
import type { Clock } from '../src/lib/clock.js';
import { disposableDatabaseUrl } from './database-safety.js';

export class FakeLlm implements LlmClient {
  configured = true;
  calls: LlmRequest[] = [];
  /** Return value generator; defaults to a grounded response built from the ids found in the prompt. */
  respond: (req: LlmRequest, n: number) => string | Error = (req) => defaultSummaryJson(req);
  async complete(req: LlmRequest): Promise<LlmResult> {
    this.calls.push(req);
    const r = this.respond(req, this.calls.length);
    if (r instanceof Error) throw r;
    return { text: r, model: req.model, usage: { promptTokens: 100, completionTokens: 50 } };
  }
}

/** A well-formed answer that cites real ids from the prompt, plus deliberately bad items that must be filtered. */
export function defaultSummaryJson(req: LlmRequest) {
  const prompt = req.messages.map((m) => m.content).join('\n');
  const t = [...prompt.matchAll(/\[(T\d+) \d\d:\d\d:\d\d 发言者:([^\]★]*)★?\] ([^\n]*)/g)];
  const first = t[0];
  const n = [...prompt.matchAll(/\[(N\d+)[^\]]*\]/g)][0];
  return JSON.stringify({
    background: { text: '研究者关注社区养老服务。', sources: [] },
    themes: first ? [{ title: '护理人手', text: '讨论了护理人员不足。', sources: [first[1]] }] : [],
    participantViews: first ? [{ speaker: '受访者', text: '认为人手不足。', sources: [first[1]] }] : [],
    quotes: first
      ? [
          { text: first[3]!.slice(0, 6), source: first[1], speaker: '受访者' }, // verbatim → kept
          { text: '这句话从来没有人说过', source: first[1], speaker: '受访者' }, // fabricated → dropped
        ]
      : [],
    findings: [
      { text: '职业认同感可能影响流动率。', sources: [first?.[1], n?.[1]].filter(Boolean) },
      { text: '没有任何依据的推断。', sources: ['T99999'] }, // unsupported → dropped
    ],
    openQuestions: [{ text: '培训考核是否存在？', sources: first ? [first[1]] : [] }],
    suggestedFollowups: [{ text: '追问培训时长。', sources: [] }],
    actionItems: [{ text: '核实流动率数据。', sources: [] }],
  });
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  llm: FakeLlm;
  storage: MemoryStorage;
  mails: Array<{ to: string; subject: string; text: string }>;
  close(): Promise<void>;
  reset(): Promise<void>;
}

export async function makeEnv(opts: { env?: Record<string, string>; asr?: Partial<AsrProviderFactory> & { liveProvider?: AsrProvider }; clock?: Clock; rateLimit?: boolean } = {}): Promise<TestEnv> {
  const TEST_DB_URL = disposableDatabaseUrl(process.env.TEST_DATABASE_URL, 'meetfolio_test');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    APP_ORIGIN: 'http://localhost:5173',
    DASHSCOPE_API_KEY: 'sk-test-not-real',
    DASHSCOPE_WORKSPACE_ID: 'llm-test',
    DEMO_MODE: 'true',
    ASR_RECOVERY_SPEED: '200',
    ASR_RECONNECT_BASE_MS: '5',
    ASR_RECONNECT_MAX_MS: '20',
    ...opts.env,
  } as NodeJS.ProcessEnv);
  const { db, pool } = createDb(TEST_DB_URL, { max: 8 });
  const storage = new MemoryStorage();
  const llm = new FakeLlm();
  const mails: TestEnv['mails'] = [];
  const logger = createLogger(process.env.TEST_LOG ?? 'silent');
  const mailer: Mailer = {
    async send(to, subject, text) {
      mails.push({ to, subject, text });
      return { delivered: true };
    },
  };
  void createMailer;
  const demo = new DemoAsrProvider();
  const asr: AsrProviderFactory = {
    live: () => opts.asr?.liveProvider ?? null,
    demo: () => demo,
  };
  const ctx: AppContext = { config, db, logger, storage, mailer, asr, llm, registry: new TranscriptionRegistry() };
  const app = await buildApp(ctx, { clock: opts.clock, rateLimit: opts.rateLimit ?? false });
  await app.ready();
  const reset = async () => {
    await db.execute(sql`truncate table users, meetings cascade`);
    storage.files.clear();
    mails.length = 0;
    llm.calls = [];
    llm.respond = (req) => defaultSummaryJson(req);
  };
  return {
    app,
    ctx,
    llm,
    storage,
    mails,
    reset,
    async close() {
      await ctx.registry.stopAll();
      await app.close();
      await pool.end();
    },
  };
}

export interface Session {
  cookie: string;
  user: { id: string; email: string; name: string };
}

let counter = 0;
export async function register(env: TestEnv, email?: string, password = 'correct-horse-9'): Promise<Session> {
  const addr = email ?? `user${++counter}-${Date.now()}@example.edu.cn`;
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: addr, password, name: '测试用户' } });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string)).split(';')[0]!;
  return { cookie, user: res.json().user };
}

export function api(env: TestEnv, s?: Session) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) => {
    const res = await env.app.inject({ method, url, payload: payload as never, headers: { ...(s ? { cookie: s.cookie } : {}), ...extra } });
    return { status: res.statusCode, body: res.body, json: () => res.json(), headers: res.headers, raw: res.rawPayload };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p?: unknown) => call('POST', u, p ?? {}),
    put: (u: string, p?: unknown) => call('PUT', u, p ?? {}),
    patch: (u: string, p?: unknown) => call('PATCH', u, p ?? {}),
    del: (u: string) => call('DELETE', u),
    call,
  };
}

export async function createMeeting(env: TestEnv, s: Session, fields: Record<string, unknown> = {}) {
  const r = await api(env, s).post('/api/meetings', { title: '养老护理员访谈', ...fields });
  if (r.status !== 200) throw new Error(`create meeting failed ${r.status} ${r.body}`);
  return r.json().meeting as { id: string; title: string };
}
