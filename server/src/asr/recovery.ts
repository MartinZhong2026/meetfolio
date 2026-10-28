import { and, eq, like, sql } from 'drizzle-orm';
import { recoveryChunkMetadata, transcriptGaps, transcriptSegments } from '../db/schema.js';
import type { AppContext } from '../lib/context.js';
import type { AsrProvider } from './types.js';
import { AsrError, BYTES_PER_MS, SAMPLE_RATE, bytesToMs, msToBytes } from './types.js';
import { PgTranscriptStore } from './store.js';

const TOLERANCE_MS = 500;
const running = new Set<string>();

export const isRecovering = (gapId: string) => running.has(gapId);

export interface RecoveryInput {
  userId: string;
  meetingId: string;
  gap: typeof transcriptGaps.$inferSelect;
  /** Raw PCM16LE 16 kHz mono. */
  pcm: Buffer;
  /** Timeline position (ms) of the first sample. */
  fromMs: number;
  provider: AsrProvider;
  source: 'recovery';
}

/** Merges [a,b) intervals and returns the total covered length clipped to [lo, hi]. */
export function coveredMs(ranges: Array<[number, number]>, lo: number, hi: number) {
  const clipped = ranges
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curEnd = -Infinity;
  for (const [a, b] of clipped) {
    const start = Math.max(a, curEnd);
    if (b > start) total += b - start;
    curEnd = Math.max(curEnd, b);
  }
  return total;
}

/**
 * Re-transcribes audio the browser kept locally for a gap and stores the resulting segments.
 * The audio is processed in memory only and never persisted. Safe to retry: segment keys are derived
 * from the gap id and the recognised sentence's time, so a repeated upload cannot create duplicates.
 */
export async function startGapRecovery(ctx: AppContext, input: RecoveryInput): Promise<{ chunkId: string }> {
  const { db, config } = ctx;
  const { gap, meetingId } = input;
  if (running.has(gap.id)) throw new AsrError('transient', 'already_recovering', '该片段正在补录中');
  const gapEnd = gap.endMs ?? Number.POSITIVE_INFINITY;
  // Clip the upload to the gap so a generous client range never duplicates already-transcribed speech.
  const lo = Math.max(gap.startMs, input.fromMs);
  const hi = Math.min(gapEnd, input.fromMs + bytesToMs(input.pcm.length));
  if (hi - lo < 200) throw new AsrError('fatal', 'no_overlap', '上传的录音与缺失时间段没有重叠');
  const startByte = msToBytes(lo - input.fromMs);
  const endByte = Math.min(input.pcm.length, msToBytes(hi - input.fromMs));
  const pcm = input.pcm.subarray(startByte, endByte);

  const [chunk] = await db
    .insert(recoveryChunkMetadata)
    .values({ meetingId, gapId: gap.id, startMs: Math.round(lo), endMs: Math.round(hi), bytes: pcm.length })
    .returning();
  await db.update(transcriptGaps).set({ status: 'recovering' }).where(eq(transcriptGaps.id, gap.id));
  running.add(gap.id);

  void (async () => {
    const store = new PgTranscriptStore(db);
    let created = 0;
    let failure: string | null = null;
    try {
      const finals: Array<{ key: string; text: string; startMs: number; endMs: number }> = [];
      let closedEarly: AsrError | null = null;
      const conn = await input.provider.connect(
        { languageHints: config.ASR_LANGUAGE_HINTS.split(',').filter(Boolean), terms: config.ASR_DOMAIN_TERMS.split(',').filter(Boolean), sampleRate: SAMPLE_RATE },
        {
          onResult: (r) => {
            if (r.kind === 'final' && r.text.trim()) finals.push({ key: r.key, text: r.text.trim(), startMs: r.startMs, endMs: r.endMs ?? r.startMs });
          },
          onClosed: (info) => {
            if (!info.clean) closedEarly = info.error ?? new AsrError('transient', 'closed', '连接中断');
          },
        },
      );
      // Pace at `ASR_RECOVERY_SPEED`× real time; providers are real-time oriented.
      const tickMs = 100;
      const bytesPerTick = Math.max(2, msToBytes(tickMs * config.ASR_RECOVERY_SPEED));
      for (let off = 0; off < pcm.length; off += bytesPerTick) {
        if (closedEarly) throw closedEarly;
        conn.sendAudio(pcm.subarray(off, Math.min(pcm.length, off + bytesPerTick)));
        await new Promise((r) => setTimeout(r, tickMs));
      }
      const ok = await conn.finish(15_000);
      if (closedEarly || !ok) throw closedEarly ?? new AsrError('transient', 'finish_timeout', '补录收尾超时');
      // A retry replaces the previous attempt's untouched output (segmentation of the same audio can differ
      // between runs, so time-based keys cannot dedupe). Anything the researcher edited, labelled or starred survives,
      // and new text overlapping a survivor is skipped rather than duplicated.
      const survivors = await db.transaction(async (tx) => {
        await tx.execute(sql`
          delete from transcript_segments
          where meeting_id = ${meetingId} and source = 'recovery' and dedupe_key like ${`rec:${gap.id}:%`}
            and edited_text is null and speaker_label is null and is_important = false
            and start_ms >= ${Math.floor(lo) - 1} and start_ms <= ${Math.ceil(hi) + 1}`);
        return tx
          .select({ s: transcriptSegments.startMs, e: transcriptSegments.endMs })
          .from(transcriptSegments)
          .where(and(eq(transcriptSegments.meetingId, meetingId), eq(transcriptSegments.source, 'recovery'), like(transcriptSegments.dedupeKey, `rec:${gap.id}:%`)));
      });
      for (const [i, f] of finals.entries()) {
        const start = lo + f.startMs;
        const end = lo + f.endMs;
        if (survivors.some((x) => x.s < end && x.e > start)) continue;
        const res = await store.saveFinal({
          meetingId,
          sessionId: null,
          dedupeKey: `rec:${gap.id}:${chunk!.id}:${i}`,
          startMs: start,
          endMs: end,
          text: f.text,
          source: input.source,
        });
        if (res.created) created++;
      }
    } catch (e) {
      failure = e instanceof AsrError ? e.code : 'recovery_failed';
      ctx.logger.warn({ meetingId, gapId: gap.id, code: failure }, 'gap recovery failed');
      await store.recordUsage(input.userId, meetingId, 'provider_error', 1, { code: failure, during: 'recovery' }).catch(() => {});
    } finally {
      running.delete(gap.id);
    }

    await db
      .update(recoveryChunkMetadata)
      .set({ status: failure ? 'failed' : 'done', errorCode: failure, segmentsCreated: created, finishedAt: new Date() })
      .where(eq(recoveryChunkMetadata.id, chunk!.id));

    // Recompute coverage from every successful upload for this gap.
    const done = await db
      .select()
      .from(recoveryChunkMetadata)
      .where(and(eq(recoveryChunkMetadata.gapId, gap.id), eq(recoveryChunkMetadata.status, 'done')));
    const covered = coveredMs(done.map((d) => [d.startMs, d.endMs] as [number, number]), gap.startMs, gapEnd);
    const complete = gap.endMs !== null && covered >= gap.endMs - gap.startMs - TOLERANCE_MS;
    const status = failure && !done.length ? 'open' : complete ? 'recovered' : done.length ? 'partial' : 'open';
    await db
      .update(transcriptGaps)
      .set({ status, recoveredMs: Math.round(covered), resolvedAt: status === 'open' ? null : new Date() })
      .where(eq(transcriptGaps.id, gap.id));
    if (!failure) await store.recordUsage(input.userId, meetingId, 'gap_recovery', Math.round((hi - lo) / 1000), { segments: created }).catch(() => {});
  })();

  return { chunkId: chunk!.id };
}

export { BYTES_PER_MS };
