import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderSummaryMarkdown } from '../ai/render.js';
import { LlmError } from '../ai/llm.js';
import { SummaryError, summarize, type SummaryMode } from '../ai/summarize.js';
import type { SummaryInput } from '../ai/types.js';
import { interviewQuestions, manualNotes, meetingParticipants, meetings, meetingSummaries, referenceDocuments, transcriptSegments, usageEvents } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { AppContext } from '../lib/context.js';
import { checkSummaryAllowance } from '../lib/limits.js';
import { getOwnedMeeting, isUuid } from '../lib/owned.js';
import { serializeSummary } from './meetings.js';

const running = new Set<string>();

export async function loadSummaryInput(ctx: AppContext, meetingId: string): Promise<SummaryInput> {
  const { db } = ctx;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  const [participants, segments, notes, questions, docs] = await Promise.all([
    db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId)),
    db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId)),
    db.select().from(manualNotes).where(eq(manualNotes.meetingId, meetingId)),
    db.select().from(interviewQuestions).where(eq(interviewQuestions.meetingId, meetingId)).orderBy(interviewQuestions.position),
    db.select().from(referenceDocuments).where(eq(referenceDocuments.meetingId, meetingId)).orderBy(referenceDocuments.createdAt),
  ]);
  return { meeting: meeting!, participants, segments, notes, questions, docs };
}

export async function summaryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get<{ Params: { id: string } }>('/api/meetings/:id/summaries', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const rows = await db.select().from(meetingSummaries).where(eq(meetingSummaries.meetingId, m.id)).orderBy(desc(meetingSummaries.version));
    return { summaries: rows.map(serializeSummary) };
  });

  app.post<{ Params: { id: string } }>('/api/meetings/:id/summary', async (req, reply) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const body = z.object({ mode: z.enum(['standard', 'quality', 'interim']).default('standard') }).safeParse(req.body ?? {});
    if (!body.success) throw badRequest('参数无效');
    if (!ctx.llm.configured) throw badRequest('AI 服务尚未配置，请联系管理员（DASHSCOPE_API_KEY）', 'llm_not_configured');
    if (running.has(m.id)) throw conflict('纪要正在生成中', 'summary_running');
    await checkSummaryAllowance(ctx, m.userId);

    const input = await loadSummaryInput(ctx, m.id);
    if (!input.segments.length && !input.notes.some((n) => n.content.trim())) throw badRequest('还没有可供总结的转录或笔记', 'no_content');

    const mode = body.data.mode as SummaryMode;
    const model = mode === 'quality' ? ctx.config.LLM_MODEL_QUALITY : ctx.config.LLM_MODEL_STANDARD;
    const [{ v }] = await db.select({ v: sql<number>`coalesce(max(${meetingSummaries.version}), 0) + 1` }).from(meetingSummaries).where(eq(meetingSummaries.meetingId, m.id));
    const [row] = await db.insert(meetingSummaries).values({ meetingId: m.id, version: v!, mode, model, status: 'generating' }).returning();
    await db.update(meetings).set({ summaryStatus: 'generating', updatedAt: new Date() }).where(eq(meetings.id, m.id));
    await db.insert(usageEvents).values({ userId: m.userId, meetingId: m.id, kind: 'ai_summary', quantity: 1, meta: { mode } });
    running.add(m.id);

    void (async () => {
      try {
        const { json, stats } = await summarize({ input, mode, llm: ctx.llm, config: ctx.config });
        const md = renderSummaryMarkdown(input, json, { interim: mode === 'interim' });
        await db
          .update(meetingSummaries)
          .set({ status: 'ready', model: stats.model, generatedJson: json, generatedMd: md, stats, updatedAt: new Date() })
          .where(eq(meetingSummaries.id, row!.id));
        await db.update(meetings).set({ summaryStatus: 'ready', updatedAt: new Date() }).where(eq(meetings.id, m.id));
      } catch (e) {
        const code = e instanceof SummaryError || e instanceof LlmError ? e.code : 'summary_failed';
        ctx.logger.warn({ meetingId: m.id, code }, 'summary generation failed');
        await db.update(meetingSummaries).set({ status: 'failed', errorCode: code, updatedAt: new Date() }).where(eq(meetingSummaries.id, row!.id));
        // Keep the previous usable summary visible on the dashboard.
        const [prev] = await db.select({ id: meetingSummaries.id }).from(meetingSummaries).where(and(eq(meetingSummaries.meetingId, m.id), eq(meetingSummaries.status, 'ready'))).limit(1);
        await db.update(meetings).set({ summaryStatus: prev ? 'ready' : 'failed', updatedAt: new Date() }).where(eq(meetings.id, m.id));
        await db.insert(usageEvents).values({ userId: m.userId, meetingId: m.id, kind: 'provider_error', quantity: 1, meta: { code, during: 'summary' } }).catch(() => {});
      } finally {
        running.delete(m.id);
      }
    })();

    reply.code(202);
    return { summary: serializeSummary(row!) };
  });

  app.patch<{ Params: { id: string; sid: string } }>('/api/meetings/:id/summaries/:sid', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.sid)) throw notFound('纪要不存在');
    const b = z.object({ editedMd: z.string().max(200_000).nullable() }).safeParse(req.body);
    if (!b.success) throw badRequest('内容无效');
    const [row] = await db
      .update(meetingSummaries)
      .set({ editedMd: b.data.editedMd, updatedAt: new Date() })
      .where(and(eq(meetingSummaries.id, req.params.sid), eq(meetingSummaries.meetingId, m.id)))
      .returning();
    if (!row) throw notFound('纪要不存在');
    await db.update(meetings).set({ updatedAt: new Date() }).where(eq(meetings.id, m.id));
    return { summary: serializeSummary(row) };
  });
}

/** Called on boot: a summary left "generating" belonged to a process that no longer exists. */
export async function failStaleSummaries(ctx: AppContext) {
  await ctx.db.update(meetingSummaries).set({ status: 'failed', errorCode: 'server_restart' }).where(eq(meetingSummaries.status, 'generating'));
  await ctx.db.update(meetings).set({ summaryStatus: 'failed' }).where(eq(meetings.summaryStatus, 'generating'));
}
