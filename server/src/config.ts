import { XASR, defaultXAsrRoot } from './asr/localXasrModel.js';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(8787),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://meetfolio:meetfolio@127.0.0.1:5432/meetfolio'),
  DATABASE_SSL: bool,
  /** Public origin of the web app, used for Origin checks and password reset links. */
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  /** Extra allowed origins (comma separated), e.g. a preview domain. */
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),
  SESSION_TTL_DAYS: int(30),
  /** Comma-separated emails and/or @domains allowed to register (empty = open registration). Use it for private staging. */
  SIGNUP_ALLOWLIST: z.string().default(''),
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
  /** auto = trust the proxy when running on Railway (which always terminates TLS in front of the container). */
  TRUST_PROXY: z.enum(['true', 'false', 'auto', '1', '0', '']).default('auto'),
  LOG_LEVEL: z.string().default('info'),

  // --- DashScope / Alibaba Cloud Model Studio ---
  DASHSCOPE_API_KEY: z.string().optional(),
  /** Workspace id; qwen-audio-* models are served under {id}.{region}.maas.aliyuncs.com */
  DASHSCOPE_WORKSPACE_ID: z.string().optional(),
  DASHSCOPE_REGION: z.string().default('cn-beijing'),
  /** Optional hard overrides of the base URLs (for proxies, other regions or tests). */
  ASR_WS_URL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),

  // --- Realtime ASR ---
  /** qwen-audio-streaming | qwen3-realtime | local-xasr */
  ASR_PROVIDER: z.enum(['qwen-audio-streaming', 'qwen3-realtime', 'local-xasr']).default('qwen-audio-streaming'),
  ASR_MODEL: z.string().optional(),
  X_ASR_MODEL_DIR: z.string().default(path.join(defaultXAsrRoot(), XASR.id)),
  ASR_LANGUAGE_HINTS: z.string().default('zh,en'),
  ASR_DOMAIN_TERMS: z
    .string()
    .default('养老护理,认知障碍,长期照护,社区治理,访谈研究,社会工作,护理员,政策执行'),
  /** Proactively rotate the provider session after this many minutes (0 disables). */
  ASR_SESSION_ROTATE_MINUTES: num(12),
  /** Grace period (seconds) to wait for a sentence boundary before forcing rotation. */
  ASR_ROTATE_GRACE_SECONDS: num(60),
  ASR_MAX_RECONNECT_ATTEMPTS: int(8),
  ASR_RECONNECT_BASE_MS: int(500),
  ASR_RECONNECT_MAX_MS: int(15_000),
  /** Max unconfirmed audio the server retains for replay after a provider drop (seconds). */
  ASR_OUTAGE_BUFFER_SECONDS: num(120),
  /** Gap recovery replay speed relative to real time. */
  ASR_RECOVERY_SPEED: num(2),
  ASR_MAX_RECOVERY_SECONDS: int(1800),
  ASR_DAILY_MINUTES_LIMIT: int(600),
  ASR_CONNECT_TIMEOUT_MS: int(10_000),

  // --- Text generation ---
  LLM_MODEL_STANDARD: z.string().default('qwen3.7-plus'),
  LLM_MODEL_QUALITY: z.string().default('qwen3.8-max'),
  SUMMARY_SINGLE_PASS_CHAR_LIMIT: int(90_000),
  SUMMARY_CHUNK_CHAR_LIMIT: int(24_000),
  SUMMARY_DAILY_LIMIT: int(30),
  LLM_TIMEOUT_MS: int(240_000),
  /** JSON object merged into every chat completion request body (e.g. {"enable_thinking":false}). */
  LLM_EXTRA_BODY: z.string().optional(),

  // --- Demo mode ---
  DEMO_MODE: z.enum(['true', 'false', 'auto']).default('auto'),

  // --- File storage ---
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  MAX_UPLOAD_MB: int(20),

  // --- Mail (password recovery) ---
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Meetfolio <no-reply@localhost>'),

  // --- Limits ---
  RATE_LIMIT_PER_MINUTE: int(300),
  AUTH_RATE_LIMIT_PER_MINUTE: int(10),
});

export type Config = ReturnType<typeof parse> & {
  isProd: boolean;
  demoEnabled: boolean;
  cookieSecure: boolean;
  asrModel: string;
  asrConfigured: boolean;
  llmConfigured: boolean;
  allowedOrigins: string[];
  trustProxy: boolean;
  signupAllowed(email: string): boolean;
  llmExtraBodyValid: boolean;
  asrWsUrl: string | null;
  llmBaseUrl: string;
};

function parse(env: NodeJS.ProcessEnv) {
  return schema.parse(env);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = parse(env);
  const isProd = c.NODE_ENV === 'production';
  const asrModel = c.ASR_PROVIDER === 'local-xasr' ? XASR.id :
    c.ASR_MODEL ?? (c.ASR_PROVIDER === 'qwen3-realtime' ? 'qwen3-asr-flash-realtime' : 'qwen-audio-3.0-asr-flash-streaming');

  let asrWsUrl: string | null = c.ASR_PROVIDER === 'local-xasr' ? null : c.ASR_WS_URL ?? null;
  if (!asrWsUrl && c.ASR_PROVIDER !== 'local-xasr') {
    if (c.ASR_PROVIDER === 'qwen3-realtime') {
      // qwen3-asr-flash-realtime is served from the classic DashScope realtime endpoint.
      asrWsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    } else if (c.DASHSCOPE_WORKSPACE_ID) {
      asrWsUrl = `wss://${c.DASHSCOPE_WORKSPACE_ID}.${c.DASHSCOPE_REGION}.maas.aliyuncs.com/api-ws/v1/inference`;
    }
  }
  const llmBaseUrl =
    c.LLM_BASE_URL ??
    (c.DASHSCOPE_WORKSPACE_ID
      ? `https://${c.DASHSCOPE_WORKSPACE_ID}.${c.DASHSCOPE_REGION}.maas.aliyuncs.com/compatible-mode/v1`
      : 'https://dashscope.aliyuncs.com/compatible-mode/v1');

  const allowedOrigins = [c.APP_ORIGIN, ...c.EXTRA_ALLOWED_ORIGINS.split(',')]
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  const trustProxy = c.TRUST_PROXY === 'auto' || c.TRUST_PROXY === '' ? onRailway : c.TRUST_PROXY === 'true' || c.TRUST_PROXY === '1';
  let llmExtraBodyValid = true;
  if (c.LLM_EXTRA_BODY) {
    try {
      const v = JSON.parse(c.LLM_EXTRA_BODY);
      llmExtraBodyValid = typeof v === 'object' && v !== null && !Array.isArray(v);
    } catch {
      llmExtraBodyValid = false;
    }
  }

  const allow = c.SIGNUP_ALLOWLIST.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const signupAllowed = (email: string) => {
    if (!allow.length) return true;
    const e = email.trim().toLowerCase();
    return allow.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
  };

  return {
    ...c,
    signupAllowed,
    trustProxy,
    llmExtraBodyValid,
    isProd,
    demoEnabled: c.DEMO_MODE === 'auto' ? !isProd : c.DEMO_MODE === 'true',
    cookieSecure: c.COOKIE_SECURE === 'auto' ? isProd : c.COOKIE_SECURE === 'true',
    asrModel,
    asrConfigured: c.ASR_PROVIDER === 'local-xasr' || Boolean(c.DASHSCOPE_API_KEY && asrWsUrl),
    llmConfigured: Boolean(c.DASHSCOPE_API_KEY),
    allowedOrigins,
    asrWsUrl,
    llmBaseUrl,
  };
}
