import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transcriptGaps } from '../db/schema.js';
import { AsrError, SAMPLE_RATE } from '../asr/types.js';
import { isRecovering, startGapRecovery } from '../asr/recovery.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { AppContext } from '../lib/context.js';
import { getOwnedMeeting, isUuid } from '../lib/owned.js';
import { serializeGap } from './meetings.js';
import { checkAsrAllowance } from '../lib/limits.js';

export async function gapRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const maxBytes = config.ASR_MAX_RECOVERY_SECONDS * SAMPLE_RATE * 2;

  // Raw PCM upload body.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxBytes + 1024 }, (_req, body, done) => done(null, body));

  app.get<{ Params: { id: string } }>('/api/meetings/:id/gaps', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    const rows = await db.select().from(transcriptGaps).where(eq(transcriptGaps.meetingId, m.id)).orderBy(asc(transcriptGaps.startMs));
    return { gaps: rows.map(serializeGap) };
  });

  /**
   * The browser uploads audio it kept in IndexedDB for a gap. Body: raw PCM16LE, 16 kHz, mono.
   * `fromMs` is the timeline position of the first sample.
   */
  app.post<{ Params: { id: string; gapId: string }; Querystring: { fromMs?: string } }>(
    '/api/meetings/:id/gaps/:gapId/audio',
    { bodyLimit: maxBytes + 1024 },
    async (req, reply) => {
      const m = await getOwnedMeeting(ctx, req, req.params.id);
      if (!isUuid(req.params.gapId)) throw notFound('缺失片段不存在');
      const q = z.object({ fromMs: z.coerce.number().int().min(0) }).safeParse(req.query);
      if (!q.success) throw badRequest('缺少 fromMs');
      const pcm = req.body as Buffer;
      if (!Buffer.isBuffer(pcm) || pcm.length < 3200) throw badRequest('录音数据为空');
      if (pcm.length > maxBytes) throw badRequest('录音过长，请分段补录', 'too_long');
      const [gap] = await db.select().from(transcriptGaps).where(and(eq(transcriptGaps.id, req.params.gapId), eq(transcriptGaps.meetingId, m.id))).limit(1);
      if (!gap) throw notFound('缺失片段不存在');
      if (isRecovering(gap.id)) throw conflict('该片段正在补录中', 'already_recovering');
      const provider = m.isDemo ? ctx.asr.demo() : ctx.asr.live();
      if (!provider) throw badRequest('语音识别服务尚未配置，暂时无法补录', 'asr_not_configured');
      await checkAsrAllowance(ctx, req.user!.id, Math.ceil(pcm.length / (SAMPLE_RATE * 2) / 60));
      try {
        const { chunkId } = await startGapRecovery(ctx, { userId: m.userId, meetingId: m.id, gap, pcm, fromMs: q.data.fromMs, provider, source: 'recovery' });
        reply.code(202);
        return { chunkId, gapId: gap.id };
      } catch (e) {
        if (e instanceof AsrError) throw badRequest(e.message, e.code);
        throw e;
      }
    },
  );

  /** The user (or browser) declares that the remaining audio can no longer be recovered. */
  app.post<{ Params: { id: string; gapId: string } }>('/api/meetings/:id/gaps/:gapId/unrecoverable', async (req) => {
    const m = await getOwnedMeeting(ctx, req, req.params.id);
    if (!isUuid(req.params.gapId)) throw notFound('缺失片段不存在');
    const [g] = await db
      .update(transcriptGaps)
      .set({ status: 'unrecoverable', resolvedAt: new Date() })
      .where(and(eq(transcriptGaps.id, req.params.gapId), eq(transcriptGaps.meetingId, m.id)))
      .returning();
    if (!g) throw notFound('缺失片段不存在');
    return { gap: serializeGap(g) };
  });
}
