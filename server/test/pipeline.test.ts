import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptionPipeline, type PipelineConfig } from '../src/asr/pipeline.js';
import type { ServerMsg } from '../src/asr/protocol.js';
import { PgTranscriptStore, type SaveFinalInput, type TranscriptStore } from '../src/asr/store.js';
import { ManualClock } from '../src/lib/clock.js';
import { createLogger } from '../src/lib/logger.js';
import { CELL_MS, GridProvider, SPEECH_MS, pcmFrame } from './grid-provider.js';
import { createMeeting, makeEnv, register, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => (env = await makeEnv()));
afterAll(() => env.close());
beforeEach(() => env.reset());

const tick = () => new Promise<void>((r) => setImmediate(r));

const baseConfig: PipelineConfig = {
  rotateMs: 12 * 60_000,
  rotateGraceMs: 60_000,
  maxReconnectAttempts: 8,
  reconnectBaseMs: 500,
  reconnectMaxMs: 15_000,
  retainCapMs: 120_000,
  replaySpeed: 4,
  jitter: false,
  persistRetryMs: 5,
};

interface Run {
  meetingId: string;
  pipeline: TranscriptionPipeline;
  provider: GridProvider;
  clock: ManualClock;
  msgs: ServerMsg[];
  /** Feeds `ms` of audio in 100 ms frames, advancing virtual time; calls `onMinute` each virtual minute. */
  feed(ms: number, hooks?: { at?: Record<number, () => void> }): Promise<void>;
  position(): number;
}

async function setup(opts: { config?: Partial<PipelineConfig>; store?: (s: TranscriptStore) => TranscriptStore; prepare?: (p: GridProvider) => void } = {}): Promise<Run> {
  const s = await register(env);
  const m = await createMeeting(env, s);
  const { rows } = await env.ctx.db.$client.query(
    `insert into transcription_sessions (meeting_id, user_id, provider, model) values ($1, $2, 'grid', 'grid-v1') returning id`,
    [m.id, s.user.id],
  );
  const provider = new GridProvider();
  opts.prepare?.(provider);
  const clock = new ManualClock();
  const msgs: ServerMsg[] = [];
  const store = opts.store ? opts.store(new PgTranscriptStore(env.ctx.db)) : new PgTranscriptStore(env.ctx.db);
  const pipeline = new TranscriptionPipeline({
    provider,
    store,
    clock,
    config: { ...baseConfig, ...opts.config },
    log: createLogger('silent'),
    emit: (x) => msgs.push(x),
    meetingId: m.id,
    userId: s.user.id,
    sessionId: rows[0].id,
    source: 'live',
    connectOptions: { languageHints: ['zh'], terms: [], sampleRate: 16000 },
  });
  let pos = 0;
  pipeline.start(0);
  await tick();
  const run: Run = {
    meetingId: m.id,
    pipeline,
    provider,
    clock,
    msgs,
    position: () => pos,
    async feed(ms, hooks) {
      const frames = Math.round(ms / 100);
      for (let i = 0; i < frames; i++) {
        clock.advance(100);
        pipeline.pushAudio(pcmFrame(pos));
        pos += 100;
        hooks?.at?.[pos]?.();
        if (i % 20 === 0) await tick();
        // Keep persistence within ~10 virtual seconds of "now", like a healthy database would.
        if (i % 100 === 0) await pipeline.whenPersisted();
      }
    },
  };
  return run;
}

async function dump(meetingId: string) {
  const { rows: segs } = await env.ctx.db.$client.query(
    `select seq, start_ms::int as s, end_ms::int as e, original_text as t, dedupe_key from transcript_segments where meeting_id = $1 order by start_ms, seq`,
    [meetingId],
  );
  const { rows: gaps } = await env.ctx.db.$client.query(`select start_ms::int as s, end_ms::int as e, reason, status from transcript_gaps where meeting_id = $1 order by start_ms`, [meetingId]);
  return { segs: segs as Array<{ seq: number; s: number; e: number; t: string; dedupe_key: string }>, gaps: gaps as Array<{ s: number; e: number | null; reason: string; status: string }> };
}

/**
 * The core invariant: for every spoken cell fully inside the fed audio, the transcript contains it
 * exactly once, OR a recorded gap covers it. Nothing is silently lost and nothing is duplicated.
 */
function assertNoSilentLoss(d: Awaited<ReturnType<typeof dump>>, totalMs: number) {
  const byText = new Map<string, number>();
  for (const x of d.segs) byText.set(x.t, (byText.get(x.t) ?? 0) + 1);
  const dupes = [...byText.entries()].filter(([, n]) => n > 1);
  expect(dupes, 'duplicate cells').toEqual([]);
  expect(new Set(d.segs.map((x) => x.seq)).size, 'unique seq').toBe(d.segs.length);
  const lastCell = Math.floor((totalMs - SPEECH_MS) / CELL_MS);
  const missing: number[] = [];
  const coveredByGap = (g: number) => d.gaps.some((x) => x.s <= g * CELL_MS + 1 && (x.e ?? Infinity) >= g * CELL_MS + SPEECH_MS - 1);
  for (let g = 0; g <= lastCell; g++) if (!byText.has(`cell-${g}`) && !coveredByGap(g)) missing.push(g);
  expect(missing, 'cells lost without a gap record').toEqual([]);
  // Timestamps land on the absolute timeline (the provider's relative times were mapped correctly).
  for (const x of d.segs) {
    const g = Number(x.t.replace('cell-', ''));
    expect(x.s).toBe(g * CELL_MS);
    // A sentence flushed by end-of-task may end early (partial); it never extends past the real speech.
    expect(x.e).toBeLessThanOrEqual(g * CELL_MS + SPEECH_MS);
    expect(x.e).toBeGreaterThan(x.s);
  }
}

const MIN = 60_000;

describe('pipeline: sessions, interim/final, persistence', () => {
  it('turns interim events into UI updates and persists each final exactly once, in order', async () => {
    const r = await setup();
    await r.feed(10_000);
    const res = await r.pipeline.stop();
    expect(res.unsaved).toBe(0);
    const interims = r.msgs.filter((m) => m.type === 'interim');
    const finals = r.msgs.filter((m): m is Extract<ServerMsg, { type: 'final' }> => m.type === 'final');
    expect(interims.length).toBeGreaterThan(0);
    // cell-3 was still being spoken at 10 s; ending the session flushes it as a (partial) final.
    expect(finals.map((f) => f.segment.originalText)).toEqual(['cell-0', 'cell-1', 'cell-2', 'cell-3']);
    // Every final names the interim it replaces, so the UI can swap instead of appending.
    expect(finals.every((f) => f.interimKey)).toBe(true);
    const d = await dump(r.meetingId);
    expect(d.segs.map((x) => x.seq)).toEqual([1, 2, 3, 4]);
    assertNoSilentLoss(d, 10_000);
    const { rows } = await env.ctx.db.$client.query('select recorded_ms::int as r from meetings where id = $1', [r.meetingId]);
    expect(rows[0].r).toBeGreaterThanOrEqual(10_000 - 100);
  });

  it('ignores duplicate final events from the provider (idempotent writes)', async () => {
    const r = await setup();
    r.provider.duplicateFinals = true;
    await r.feed(12_000);
    await r.pipeline.stop();
    const d = await dump(r.meetingId);
    expect(d.segs.length).toBe(4);
    assertNoSilentLoss(d, 12_000);
  });

  it('writing the same dedupe key twice returns the existing row', async () => {
    const r = await setup();
    const store = new PgTranscriptStore(env.ctx.db);
    const input: SaveFinalInput = { meetingId: r.meetingId, sessionId: null, dedupeKey: 'dup', startMs: 0, endMs: 1000, text: 'x', source: 'live' };
    const [a, b] = await Promise.all([store.saveFinal(input), store.saveFinal(input)]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(a.segment.id).toBe(b.segment.id);
    const d = await dump(r.meetingId);
    expect(d.segs).toHaveLength(1);
    r.pipeline.abort();
  });

  it('allocates unique sequence numbers under concurrent writers', async () => {
    const r = await setup();
    const store = new PgTranscriptStore(env.ctx.db);
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.saveFinal({ meetingId: r.meetingId, sessionId: null, dedupeKey: `k${i}`, startMs: i * 10, endMs: i * 10 + 5, text: `t${i}`, source: 'live' })));
    const d = await dump(r.meetingId);
    expect(new Set(d.segs.map((x) => x.seq)).size).toBe(25);
    r.pipeline.abort();
  });
});

describe('pipeline: interruption recovery (virtual time)', () => {
  for (const atMin of [17, 25, 60]) {
    it(`provider connection dies after ${atMin} minutes → reconnects, replays in-flight audio, no loss or duplicates`, async () => {
      const r = await setup({ config: { rotateMs: 0 } });
      const total = (atMin + 3) * MIN;
      await r.feed(atMin * MIN + 1_300); // die mid-sentence on purpose
      expect(r.provider.connections).toHaveLength(1);
      r.provider.current!.kill();
      await r.feed(total - r.position());
      const res = await r.pipeline.stop();
      expect(res.unsaved).toBe(0);
      expect(r.provider.connections.length).toBeGreaterThanOrEqual(2);
      expect(r.pipeline.reconnects).toBe(1);
      const d = await dump(r.meetingId);
      expect(d.gaps).toEqual([]); // fast reconnect inside the replay window ⇒ nothing was lost
      assertNoSilentLoss(d, total);
      // Honest UI signalling: reconnecting was announced, then ok again.
      const states = r.msgs.filter((m) => m.type === 'provider_state').map((m) => (m as { state: string }).state);
      expect(states).toContain('reconnecting');
      expect(states[states.length - 1]).toBe('ok');
    });
  }

  it('survives repeated drops at 17, 25 and 60 minutes in one session (cumulative)', async () => {
    const r = await setup({ config: { rotateMs: 0 } });
    const at = [17 * MIN + 700, 25 * MIN + 2_100, 60 * MIN + 1_000];
    let i = 0;
    for (const t of at) {
      await r.feed(t - r.position());
      r.provider.current!.kill();
      i++;
    }
    await r.feed(65 * MIN - r.position());
    await r.pipeline.stop();
    expect(r.pipeline.reconnects).toBe(i);
    const d = await dump(r.meetingId);
    expect(d.gaps).toEqual([]);
    assertNoSilentLoss(d, 65 * MIN);
  });

  it('logical 90-minute session with planned rotation, a provider session cap, and random drops', async () => {
    const r = await setup({ config: { rotateMs: 12 * MIN } });
    // The service is also configured to cut every connection after 17 minutes of audio (the failure seen in earlier products).
    r.provider.sessionLimitMs = 17 * MIN;
    const total = 90 * MIN;
    const drops = new Set([31 * MIN + 400, 47 * MIN + 1_900, 83 * MIN + 2_400]);
    await r.feed(total, {
      at: Object.fromEntries([...drops].map((t) => [t - (t % 100) + 100, () => r.provider.current!.kill()])),
    });
    const res = await r.pipeline.stop();
    expect(res.unsaved).toBe(0);
    const d = await dump(r.meetingId);
    assertNoSilentLoss(d, total);
    expect(d.gaps).toEqual([]);
    expect(d.segs.length).toBeGreaterThanOrEqual(Math.floor((total - SPEECH_MS) / CELL_MS) - 1);
    // Planned rotations happened well before any 17-minute cap could hit.
    expect(r.pipeline.providerSessions).toBeGreaterThanOrEqual(8);
    const { rows } = await env.ctx.db.$client.query('select recorded_ms::int as r from meetings where id = $1', [r.meetingId]);
    expect(rows[0].r).toBeGreaterThanOrEqual(total - 200);
  }, 60_000);

  it('planned rotation waits for a sentence boundary, but not forever', async () => {
    const r = await setup({ config: { rotateMs: 10 * MIN, rotateGraceMs: 30_000 } });
    await r.feed(10 * MIN + 31 * 1000);
    await r.pipeline.stop();
    expect(r.provider.connections.length).toBeGreaterThanOrEqual(2);
    assertNoSilentLoss(await dump(r.meetingId), 10 * MIN + 31_000);
  });

  it('a hung provider shutdown during rotation does not lose the in-flight audio', async () => {
    const r = await setup({ config: { rotateMs: 5 * MIN } });
    r.provider.hangFinish = true;
    await r.feed(8 * MIN);
    await r.pipeline.stop();
    const d = await dump(r.meetingId);
    assertNoSilentLoss(d, 8 * MIN);
  });
});

describe('pipeline: gap detection and honest handling of unrecoverable intervals', () => {
  it('a short outage is bridged by replay: audio is buffered, paced back to the provider, no gap', async () => {
    const r = await setup({ config: { rotateMs: 0 } });
    await r.feed(2 * MIN + 500);
    r.provider.failNextConnects = 4; // reconnect attempts fail for a while (0.5+1+2+4 s backoff)
    r.provider.current!.kill();
    await r.feed(MIN);
    await r.pipeline.stop();
    const d = await dump(r.meetingId);
    expect(d.gaps).toEqual([]);
    assertNoSilentLoss(d, 3 * MIN + 500);
  });

  it('an outage longer than the replay buffer records an explicit gap and emits it to the client', async () => {
    const r = await setup({ config: { rotateMs: 0, retainCapMs: 30_000, maxReconnectAttempts: 3 } });
    await r.feed(MIN + 500);
    r.provider.failNextConnects = 1_000;
    r.provider.current!.kill();
    await r.feed(3 * MIN); // provider is unreachable for 3 virtual minutes
    r.provider.failNextConnects = 0;
    await r.feed(MIN); // ... then comes back
    await r.pipeline.stop();
    const d = await dump(r.meetingId);
    expect(d.gaps.length).toBeGreaterThanOrEqual(1);
    const g = d.gaps[0]!;
    expect(g.reason).toBe('provider');
    expect(g.status).toBe('open'); // recoverable: the browser still holds the audio
    expect(g.s).toBeGreaterThan(MIN - 5_000);
    expect(g.e! - g.s).toBeGreaterThan(2 * MIN);
    // The client was told, in real time, about the unavailable service and the gap.
    expect(r.msgs.some((m) => m.type === 'gap')).toBe(true);
    expect(r.msgs.some((m) => m.type === 'provider_state' && m.state === 'failed')).toBe(true);
    assertNoSilentLoss(d, 5 * MIN + 500);
    // After the provider returned, transcription resumed: late cells exist.
    expect(d.segs.some((x) => x.s > 4 * MIN + 20_000)).toBe(true);
  });

  it('fatal provider errors (bad key) are reported immediately, not retried forever; audio is accounted for as a gap', async () => {
    const r2 = await setup({ config: { rotateMs: 0 }, prepare: (p) => (p.fatalNextConnect = true) });
    await r2.feed(30_000);
    expect(r2.msgs.some((m) => m.type === 'error' && m.code === 'asr_fatal' && m.fatal)).toBe(true);
    expect(r2.provider.connections).toHaveLength(0);
    await r2.pipeline.stop();
    const d = await dump(r2.meetingId);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]!.e!).toBeGreaterThanOrEqual(29_000);
    const { rows } = await env.ctx.db.$client.query(`select count(*)::int as n from usage_events where kind = 'provider_error' and meeting_id = $1`, [r2.meetingId]);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('browser vanishes (abort): the in-flight sentence is salvaged and the session leaves nothing half-written', async () => {
    const r = await setup({ config: { rotateMs: 0 } });
    await r.feed(10_000 + 2_000); // 2 s into a sentence that has not finished
    await r.pipeline.abort();
    const d = await dump(r.meetingId);
    assertNoSilentLoss(d, 12_000);
    const { rows } = await env.ctx.db.$client.query('select recorded_ms::int as r from meetings where id = $1', [r.meetingId]);
    expect(rows[0].r).toBeGreaterThanOrEqual(11_900);
  });

  it('pause then resume continues the same meeting timeline without duplicating text', async () => {
    const r = await setup({ config: { rotateMs: 0 } });
    await r.feed(30_000);
    await r.pipeline.pause();
    expect(r.pipeline.isPaused).toBe(true);
    const pos = r.position();
    r.pipeline.resume(pos);
    await tick();
    await r.feed(30_000);
    await r.pipeline.stop();
    const d = await dump(r.meetingId);
    assertNoSilentLoss(d, 60_000);
    expect(d.gaps).toEqual([]);
  });
});

describe('pipeline: database failures', () => {
  it('transient database errors are retried and nothing is duplicated or reordered', async () => {
    let failures = 6;
    const r = await setup({
      store: (s) => ({
        saveFinal: async (i) => {
          if (failures-- > 0) throw new Error('connection terminated');
          return s.saveFinal(i);
        },
        createGap: s.createGap.bind(s),
        setRecorded: s.setRecorded.bind(s),
        touchSession: s.touchSession.bind(s),
        recordUsage: s.recordUsage.bind(s),
      }),
    });
    await r.feed(20_000);
    const res = await r.pipeline.stop();
    expect(res.unsaved).toBe(0);
    expect(r.msgs.some((m) => m.type === 'persist_state' && !m.ok)).toBe(true);
    const d = await dump(r.meetingId);
    assertNoSilentLoss(d, 20_000);
    expect(d.segs.map((x) => x.seq)).toEqual(d.segs.map((_, i) => i + 1));
  });

  it('a database that stays down is surfaced as unsaved segments, never reported as success', async () => {
    const r = await setup({
      store: (s) => ({
        saveFinal: async () => {
          throw new Error('db down');
        },
        createGap: s.createGap.bind(s),
        setRecorded: s.setRecorded.bind(s),
        touchSession: s.touchSession.bind(s),
        recordUsage: s.recordUsage.bind(s),
      }),
    });
    await r.feed(7_000);
    const res = await r.pipeline.stop();
    expect(res.unsaved).toBeGreaterThan(0);
    expect(r.msgs.some((m) => m.type === 'error' && m.code === 'persist_failed')).toBe(true);
    expect(r.msgs.filter((m) => m.type === 'final')).toHaveLength(0); // never shown as saved
  });
});
