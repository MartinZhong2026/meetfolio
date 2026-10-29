import { XAsrModelManager } from '../asr/xasrManager.js';
import { and, asc, desc, eq, exists, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { removeMeetingFiles } from '../docs/files.js';
import {
  interviewQuestions,
  manualNotes,
  meetingParticipants,
  meetings,
  meetingSummaries,
  MEETING_TYPES,
  referenceDocuments,
  transcriptGaps,
  transcriptSegments,
} from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import type { AppContext } from '../lib/context.js';
import { getOwnedMeeting } from '../lib/owned.js';
import { requireUser } from '../plugins/auth.js';

const participant = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(['interviewer', 'interviewee', 'other']).default('other'),
  note: z.string().trim().max(300).default(''),
});

const meetingFields = {
  title: z.string().trim().min(1, '请输入会议标题').max(200),
  meetingDate: z.coerce.date().optional(),
  type: z.enum(MEETING_TYPES).optional(),
  location: z.string().trim().max(200).optional(),
  organizer: z.string().trim().max(120).optional(),
  researchContext: z.string().max(20_000).optional(),
  guideTopic: z.string().max(500).optional(),
  participants: z.array(participant).max(50).optional(),
};
const createBody = z.object({ ...meetingFields, demo: z.boolean().optional() });
const patchBody = z.object(meetingFields).partial();

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function serializeMeeting(m: typeof meetings.$inferSelect) {
  return {
    id: m.id,
    title: m.title,
    meetingDate: m.meetingDate.toISOString(),
    type: m.type,
    location: m.location,
    organizer: m.organizer,
    researchContext: m.researchContext,
    guideTopic: m.guideTopic,
    transcriptStatus: m.transcriptStatus,
    summaryStatus: m.summaryStatus,
    isDemo: m.isDemo,
    recordedMs: m.recordedMs,
    durationMs: Math.max(m.durationMs, m.recordedMs),
    endedAt: m.endedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function serializeSegment(s: typeof transcriptSegments.$inferSelect) {
  return {
    id: s.id,
    seq: s.seq,
    startMs: s.startMs,
    endMs: s.endMs,
    originalText: s.originalText,
    editedText: s.editedText,
    speakerLabel: s.speakerLabel,
    isImportant: s.isImportant,
    source: s.source,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function serializeGap(g: typeof transcriptGaps.$inferSelect) {
  return {
    id: g.id,
    startMs: g.startMs,
    endMs: g.endMs,
    reason: g.reason,
    status: g.status,
    recoveredMs: g.recoveredMs,
    createdAt: g.createdAt.toISOString(),
  };
}

export const serializeNote = (n: typeof manualNotes.$inferSelect) => ({
  id: n.id,
  category: n.category,
  content: n.content,
  isImportant: n.isImportant,
  timestampMs: n.timestampMs,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
});

export const serializeQuestion = (q: typeof interviewQuestions.$inferSelect) => ({
  id: q.id,
  position: q.position,
  text: q.text,
  done: q.done,
  isFollowup: q.isFollowup,
});

export const serializeDoc = (d: typeof referenceDocuments.$inferSelect) => ({
  id: d.id,
  kind: d.kind,
  title: d.title,
  filename: d.filename,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  textLength: d.extractedText.length,
  extractionStatus: d.extractionStatus,
  createdAt: d.createdAt.toISOString(),
});

export function serializeSummary(s: typeof meetingSummaries.$inferSelect) {
  return {
    id: s.id,
    version: s.version,
    status: s.status,
    mode: s.mode,
    model: s.model,
    generatedJson: s.generatedJson,
    generatedMd: s.generatedMd,
    editedMd: s.editedMd,
    stats: s.stats,
    errorCode: s.errorCode,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function meetingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/config', async () => {
    const provider = ctx.asr.live();
    const localAsr = provider instanceof XAsrModelManager ? provider.getStatus() : undefined;
    return {
      demoEnabled: ctx.config.demoEnabled,
      asrConfigured: localAsr ? ['installed', 'ready'].includes(localAsr.state) : ctx.config.asrConfigured,
      localAsr,
      aiConfigured: ctx.config.llmConfigured,
      asrProvider: ctx.config.ASR_PROVIDER,
      maxUploadMb: ctx.config.MAX_UPLOAD_MB,
      storageDriver: ctx.storage.driver,
    };
  });

  app.get('/api/meetings', async (req) => {
    const user = requireUser(req);
    const q = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const conditions = [eq(meetings.userId, user.id)];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conditions.push(
        or(
          ilike(meetings.title, like),
          ilike(meetings.location, like),
          ilike(meetings.organizer, like),
          exists(
            db
              .select({ x: sql`1` })
              .from(meetingParticipants)
              .where(and(eq(meetingParticipants.meetingId, meetings.id), ilike(meetingParticipants.name, like))),
          ),
          exists(
            db
              .select({ x: sql`1` })
              .from(transcriptSegments)
              .where(
                and(
                  eq(transcriptSegments.meetingId, meetings.id),
                  or(ilike(transcriptSegments.originalText, like), ilike(transcriptSegments.editedText, like)),
                ),
              ),
          ),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(meetings)
      .where(and(...conditions))
      .orderBy(desc(meetings.meetingDate), desc(meetings.createdAt))
      .limit(500);
    return { meetings: rows.map(serializeMeeting) };
  });

  app.post('/api/meetings', async (req) => {
    const user = requireUser(req);
    const body = createBody.safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? '请输入会议标题');
    const d = body.data;
    if (d.demo && !ctx.config.demoEnabled) throw badRequest('演示模式未启用', 'demo_disabled');
    const created = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(meetings)
        .values({
          userId: user.id,
          title: d.title,
          meetingDate: d.meetingDate ?? new Date(),
          type: d.type ?? 'general',
          location: d.location ?? '',
          organizer: d.organizer ?? '',
          researchContext: d.researchContext ?? '',
          guideTopic: d.guideTopic ?? '',
          isDemo: d.demo ?? false,
        })
        .returning();
      if (d.participants?.length) {
        await tx.insert(meetingParticipants).values(d.participants.map((p, i) => ({ ...p, meetingId: m!.id, position: i })));
      }
      return m!;
    });
    return { meeting: serializeMeeting(created) };
  });

  app.get<{ Params: { id: string } }>('/api/meetings/:id', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const [participants, notes, docs, questions, segments, gaps, summaries] = await Promise.all([
      db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, m.id)).orderBy(asc(meetingParticipants.position)),
      db.select().from(manualNotes).where(eq(manualNotes.meetingId, m.id)).orderBy(asc(manualNotes.createdAt)),
      db.select().from(referenceDocuments).where(eq(referenceDocuments.meetingId, m.id)).orderBy(asc(referenceDocuments.createdAt)),
      db.select().from(interviewQuestions).where(eq(interviewQuestions.meetingId, m.id)).orderBy(asc(interviewQuestions.position)),
      db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, m.id)).orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.seq)),
      db.select().from(transcriptGaps).where(eq(transcriptGaps.meetingId, m.id)).orderBy(asc(transcriptGaps.startMs)),
      db.select().from(meetingSummaries).where(eq(meetingSummaries.meetingId, m.id)).orderBy(desc(meetingSummaries.version)).limit(1),
    ]);
    return {
      meeting: serializeMeeting(m),
      participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role, note: p.note })),
      notes: notes.map(serializeNote),
      documents: docs.map(serializeDoc),
      questions: questions.map(serializeQuestion),
      segments: segments.map(serializeSegment),
      gaps: gaps.map(serializeGap),
      summary: summaries[0] ? serializeSummary(summaries[0]) : null,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/meetings/:id', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const body = patchBody.safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? '请求参数无效');
    const { participants, ...fields } = body.data;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(meetings)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(meetings.id, m.id))
        .returning();
      if (participants) {
        await tx.delete(meetingParticipants).where(eq(meetingParticipants.meetingId, m.id));
        if (participants.length) await tx.insert(meetingParticipants).values(participants.map((p, i) => ({ ...p, meetingId: m.id, position: i })));
      }
      return row!;
    });
    return { meeting: serializeMeeting(updated) };
  });

  app.delete<{ Params: { id: string } }>('/api/meetings/:id', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    await ctx.registry.closeMeeting(m.id, 'meeting_deleted');
    await db.delete(meetings).where(eq(meetings.id, m.id));
    await removeMeetingFiles(ctx, m.userId, m.id);
    return { ok: true };
  });

  /** Marks the meeting as finished. Safe to call repeatedly. */
  app.post<{ Params: { id: string } }>('/api/meetings/:id/end', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    // Make sure no live connection is still writing for this meeting.
    await ctx.registry.stopMeeting(m.id);
    const [row] = await db
      .update(meetings)
      .set({
        transcriptStatus: sql`case when ${meetings.transcriptStatus} = 'none' and ${meetings.recordedMs} = 0 then 'none' else 'complete' end`,
        endedAt: m.endedAt ?? new Date(),
        durationMs: sql`greatest(${meetings.durationMs}, ${meetings.recordedMs})`,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, m.id))
      .returning();
    return { meeting: serializeMeeting(row!) };
  });

  /** Re-opens an ended meeting so recording can continue. */
  app.post<{ Params: { id: string } }>('/api/meetings/:id/reopen', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const [row] = await db
      .update(meetings)
      .set({
        endedAt: null,
        transcriptStatus: m.transcriptStatus === 'complete' ? 'in_progress' : m.transcriptStatus,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, m.id))
      .returning();
    return { meeting: serializeMeeting(row!) };
  });
}
