import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { meetings, recoveryChunkMetadata, transcriptGaps, transcriptionSessions, transcriptSegments, usageEvents } from '../db/schema.js';

export type SegmentRow = typeof transcriptSegments.$inferSelect;
export type GapRow = typeof transcriptGaps.$inferSelect;

export interface SaveFinalInput {
  meetingId: string;
  sessionId: string | null;
  dedupeKey: string;
  startMs: number;
  endMs: number;
  text: string;
  source: 'live' | 'recovery' | 'demo';
}

export interface GapInput {
  meetingId: string;
  sessionId: string | null;
  startMs: number;
  endMs: number | null;
  reason: 'network' | 'provider' | 'capture_stopped' | 'page_reload' | 'server_restart';
  status?: 'open' | 'unrecoverable';
}

/** Persistence port used by the pipeline. The Postgres implementation is the only production one. */
export interface TranscriptStore {
  /** Idempotent: a repeated dedupeKey returns the existing row with created=false. */
  saveFinal(input: SaveFinalInput): Promise<{ segment: SegmentRow; created: boolean }>;
  createGap(input: GapInput): Promise<GapRow>;
  setRecorded(meetingId: string, recordedMs: number): Promise<void>;
  touchSession(sessionId: string, patch: { audioMs?: number; reconnects?: number; providerSessions?: number; lastErrorCode?: string | null; status?: 'active' | 'ended' | 'interrupted' | 'failed' }): Promise<void>;
  recordUsage(userId: string, meetingId: string | null, kind: string, quantity: number, meta?: Record<string, unknown>): Promise<void>;
}

export class PgTranscriptStore implements TranscriptStore {
  constructor(private db: Db) {}

  async saveFinal(i: SaveFinalInput) {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(transcriptSegments)
        .where(and(eq(transcriptSegments.meetingId, i.meetingId), eq(transcriptSegments.dedupeKey, i.dedupeKey)))
        .limit(1);
      if (existing[0]) return { segment: existing[0], created: false };
      // Row-lock the meeting to allocate the next sequence number without races between connections.
      const [m] = await tx
        .update(meetings)
        .set({ nextSeq: sql`${meetings.nextSeq} + 1` })
        .where(eq(meetings.id, i.meetingId))
        .returning({ next: meetings.nextSeq });
      if (!m) throw new Error('meeting_not_found');
      const seq = m.next - 1;
      const inserted = await tx
        .insert(transcriptSegments)
        .values({
          meetingId: i.meetingId,
          sessionId: i.sessionId,
          seq,
          dedupeKey: i.dedupeKey,
          startMs: Math.round(i.startMs),
          endMs: Math.round(i.endMs),
          originalText: i.text,
          source: i.source,
        })
        .onConflictDoNothing({ target: [transcriptSegments.meetingId, transcriptSegments.dedupeKey] })
        .returning();
      if (inserted[0]) return { segment: inserted[0], created: true };
      const [again] = await tx
        .select()
        .from(transcriptSegments)
        .where(and(eq(transcriptSegments.meetingId, i.meetingId), eq(transcriptSegments.dedupeKey, i.dedupeKey)))
        .limit(1);
      return { segment: again!, created: false };
    });
  }

  async createGap(i: GapInput) {
    const [g] = await this.db
      .insert(transcriptGaps)
      .values({ meetingId: i.meetingId, sessionId: i.sessionId, startMs: Math.round(i.startMs), endMs: i.endMs === null ? null : Math.round(i.endMs), reason: i.reason, status: i.status ?? 'open' })
      .returning();
    return g!;
  }

  async setRecorded(meetingId: string, recordedMs: number) {
    await this.db
      .update(meetings)
      .set({ recordedMs: sql`greatest(${meetings.recordedMs}, ${Math.round(recordedMs)})`, updatedAt: new Date() })
      .where(eq(meetings.id, meetingId));
  }

  async touchSession(sessionId: string, p: Parameters<TranscriptStore['touchSession']>[1]) {
    await this.db
      .update(transcriptionSessions)
      .set({
        lastHeartbeatAt: new Date(),
        ...(p.audioMs !== undefined ? { audioMs: Math.round(p.audioMs) } : {}),
        ...(p.reconnects !== undefined ? { reconnects: p.reconnects } : {}),
        ...(p.providerSessions !== undefined ? { providerSessions: p.providerSessions } : {}),
        ...(p.lastErrorCode !== undefined ? { lastErrorCode: p.lastErrorCode } : {}),
        ...(p.status ? { status: p.status, ...(p.status !== 'active' ? { endedAt: new Date() } : {}) } : {}),
      })
      .where(eq(transcriptionSessions.id, sessionId));
  }

  async recordUsage(userId: string, meetingId: string | null, kind: string, quantity: number, meta: Record<string, unknown> = {}) {
    await this.db.insert(usageEvents).values({ userId, meetingId, kind, quantity: Math.round(quantity), meta });
  }
}

export { recoveryChunkMetadata };
