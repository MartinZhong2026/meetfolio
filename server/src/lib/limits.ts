import { and, eq, gte, sql } from 'drizzle-orm';
import { usageEvents } from '../db/schema.js';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';

const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

async function sumToday(ctx: AppContext, userId: string, kind: string) {
  const [r] = await ctx.db
    .select({ n: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.kind, kind), gte(usageEvents.createdAt, startOfDay())));
  return r?.n ?? 0;
}

/** Minutes of speech recognition already used today (live sessions that have ended + gap recoveries). */
export async function asrMinutesUsedToday(ctx: AppContext, userId: string) {
  return Math.ceil(((await sumToday(ctx, userId, 'asr_seconds')) + (await sumToday(ctx, userId, 'gap_recovery'))) / 60);
}

/** Throws if recognising `extraMinutes` more audio would exceed the per-account daily allowance. */
export async function checkAsrAllowance(ctx: AppContext, userId: string, extraMinutes = 0) {
  const usedMin = Math.ceil(((await sumToday(ctx, userId, 'asr_seconds')) + (await sumToday(ctx, userId, 'gap_recovery'))) / 60);
  if (usedMin + extraMinutes > ctx.config.ASR_DAILY_MINUTES_LIMIT) {
    throw new HttpError(429, 'asr_daily_limit', `今日转录时长已达上限（${ctx.config.ASR_DAILY_MINUTES_LIMIT} 分钟），请明天再试或联系管理员`);
  }
}

export async function checkSummaryAllowance(ctx: AppContext, userId: string) {
  if ((await sumToday(ctx, userId, 'ai_summary')) >= ctx.config.SUMMARY_DAILY_LIMIT) {
    throw new HttpError(429, 'summary_daily_limit', `今日 AI 纪要生成次数已达上限（${ctx.config.SUMMARY_DAILY_LIMIT} 次）`);
  }
}

export async function usageSummary(ctx: AppContext, userId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await ctx.db
    .select({ kind: usageEvents.kind, n: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int`, c: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, since)))
    .groupBy(usageEvents.kind);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  return {
    last30Days: {
      asrMinutes: Math.round(((by.asr_seconds?.n ?? 0) + (by.gap_recovery?.n ?? 0)) / 60),
      aiSummaries: by.ai_summary?.c ?? 0,
      providerErrors: by.provider_error?.c ?? 0,
      connectionFailures: by.connection_failure?.c ?? 0,
    },
    today: {
      asrMinutes: Math.ceil(((await sumToday(ctx, userId, 'asr_seconds')) + (await sumToday(ctx, userId, 'gap_recovery'))) / 60),
      asrMinutesLimit: ctx.config.ASR_DAILY_MINUTES_LIMIT,
      aiSummaries: await sumToday(ctx, userId, 'ai_summary'),
      aiSummariesLimit: ctx.config.SUMMARY_DAILY_LIMIT,
    },
  };
}
