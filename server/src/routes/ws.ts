import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { z } from 'zod';
import { TranscriptionPipeline, type PipelineConfig } from '../asr/pipeline.js';
import type { ClientMsg, ServerMsg } from '../asr/protocol.js';
import type { LiveHandle } from '../asr/registry.js';
import { PgTranscriptStore } from '../asr/store.js';
import { SAMPLE_RATE, msToBytes } from '../asr/types.js';
import { meetings, transcriptionSessions, transcriptGaps } from '../db/schema.js';
import { realClock, type Clock } from '../lib/clock.js';
import type { AppContext } from '../lib/context.js';
import { HttpError } from '../lib/errors.js';
import { asrMinutesUsedToday, checkAsrAllowance } from '../lib/limits.js';
import { getOwnedMeetingByUser } from '../lib/owned.js';
import { serializeGap } from './meetings.js';

const helloSchema = z.object({
  type: z.literal('hello'),
  meetingId: z.string().uuid(),
  audioStartMs: z.number().min(0).max(1e9),
  demo: z.boolean().optional(),
  reason: z.enum(['network', 'page_reload', 'capture_stopped']).optional(),
});

export function pipelineConfig(ctx: AppContext): PipelineConfig {
  const c = ctx.config;
  return {
    rotateMs: c.ASR_SESSION_ROTATE_MINUTES * 60_000,
    rotateGraceMs: c.ASR_ROTATE_GRACE_SECONDS * 1000,
    maxReconnectAttempts: c.ASR_MAX_RECONNECT_ATTEMPTS,
    reconnectBaseMs: c.ASR_RECONNECT_BASE_MS,
    reconnectMaxMs: c.ASR_RECONNECT_MAX_MS,
    retainCapMs: c.ASR_OUTAGE_BUFFER_SECONDS * 1000,
    replaySpeed: c.ASR_RECOVERY_SPEED,
    jitter: true,
    persistRetryMs: 300,
  };
}

const MAX_FRAME_BYTES = 64 * 1024;
const GAP_TOLERANCE_MS = 400;

export async function wsRoutes(app: FastifyInstance, ctx: AppContext, clock: Clock = realClock) {
  const { db, config, logger } = ctx;

  /** On boot, any session still marked active belonged to a process that no longer exists. */
  await db.update(transcriptionSessions).set({ status: 'interrupted', endedAt: new Date() }).where(eq(transcriptionSessions.status, 'active'));
  await db.update(meetings).set({ transcriptStatus: 'interrupted' }).where(eq(meetings.transcriptStatus, 'in_progress'));

  app.get('/ws/transcribe', { websocket: true }, (socket: WebSocket, req) => {
    const user = req.user;
    const store = new PgTranscriptStore(db);
    let pipeline: TranscriptionPipeline | null = null;
    let handle: LiveHandle | null = null;
    let sessionId: string | null = null;
    let meetingId: string | null = null;
    let demo = false;
    let skipBytes = 0;
    let finished = false;
    let lastPong = Date.now();
    let chain: Promise<void> = Promise.resolve();

    const send = (m: ServerMsg) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(m));
    };
    const fail = (code: string, message: string, fatal = true) => {
      send({ type: 'error', code, message, fatal });
      if (fatal) setTimeout(() => socket.close(4000, code), 50);
    };

    if (!user) {
      fail('unauthorized', '请先登录');
      return;
    }

    const helloTimeout = setTimeout(() => {
      if (!pipeline) socket.close(4408, 'hello_timeout');
    }, 10_000);

    // Transport-level liveness: ws ping/pong detects half-open TCP connections.
    const hb = setInterval(() => {
      if (Date.now() - lastPong > 45_000) {
        socket.terminate();
        return;
      }
      if (socket.readyState === 1) socket.ping();
    }, 15_000);
    socket.on('pong', () => (lastPong = Date.now()));

    // The daily allowance also applies to a session that is already running, not just to new ones.
    const limitTimer = setInterval(() => {
      if (!pipeline || demo || finished) return;
      void asrMinutesUsedToday(ctx, user.id)
        .then(async (used) => {
          if (used + Math.ceil(pipeline!.sentMs / 60_000) > config.ASR_DAILY_MINUTES_LIMIT) {
            send({ type: 'error', code: 'asr_daily_limit', message: `今日转录时长已达上限（${config.ASR_DAILY_MINUTES_LIMIT} 分钟），已自动结束。已转录的内容都已保存。`, fatal: true });
            await handle?.stop();
          }
        })
        .catch(() => {});
    }, 60_000);
    limitTimer.unref();

    const finishSession = async (status: 'ended' | 'interrupted') => {
      if (finished) return;
      finished = true;
      clearInterval(hb);
      clearInterval(limitTimer);
      clearTimeout(helloTimeout);
      if (handle) ctx.registry.unregister(handle);
      if (pipeline && sessionId && meetingId) {
        const sentSeconds = Math.round(pipeline.sentMs / 1000);
        await store.touchSession(sessionId, { audioMs: pipeline.sentMs, status, reconnects: pipeline.reconnects, providerSessions: pipeline.providerSessions, lastErrorCode: pipeline.lastErrorCode }).catch(() => {});
        if (sentSeconds > 0 && !demo) await store.recordUsage(user.id, meetingId, 'asr_seconds', sentSeconds, { sessionId }).catch(() => {});
        await db
          .update(meetings)
          .set({ transcriptStatus: status === 'interrupted' ? 'interrupted' : 'in_progress', updatedAt: new Date() })
          .where(and(eq(meetings.id, meetingId), eq(meetings.transcriptStatus, 'in_progress')))
          .catch(() => {});
      }
    };

    const onHello = async (raw: unknown) => {
      if (pipeline) return fail('already_started', '会话已开始', false);
      const parsed = helloSchema.safeParse(raw);
      if (!parsed.success) return fail('bad_hello', '请求无效');
      const h = parsed.data;
      const meeting = await getOwnedMeetingByUser(ctx, user.id, h.meetingId);
      if (!meeting) return fail('not_found', '会议不存在');
      demo = Boolean(h.demo);
      if (demo && (!config.demoEnabled || !meeting.isDemo)) return fail('demo_disabled', '演示模式不可用');
      if (!demo && meeting.isDemo) return fail('demo_meeting', '这是演示会议，请使用演示模式');
      const provider = demo ? ctx.asr.demo() : ctx.asr.live();
      if (!provider) return fail('asr_not_configured', '语音识别服务尚未配置，请联系管理员（DASHSCOPE_API_KEY）');

      // One live session per account. The same meeting may take over its own stale connection.
      const other = ctx.registry.activeForUser(user.id);
      if (other && other.meetingId !== meeting.id) return fail('another_session', '您有另一场会议正在转录，请先结束它');
      const existing = ctx.registry.get(meeting.id);
      if (existing) await existing.abort('replaced');
      try {
        if (!demo) await checkAsrAllowance(ctx, user.id);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.code, e.message);
        throw e;
      }

      // The previous connection's final state is now persisted; read the authoritative high-water mark.
      const fresh = (await getOwnedMeetingByUser(ctx, user.id, meeting.id))!;
      const recorded = fresh.recordedMs;
      let startMs = h.audioStartMs;
      if (startMs < recorded) {
        // Browser is re-sending audio the server already has: skip it instead of duplicating text.
        skipBytes = msToBytes(recorded - startMs);
        startMs = recorded;
      }

      const [session] = await db
        .insert(transcriptionSessions)
        .values({ meetingId: meeting.id, userId: user.id, provider: provider.name, model: provider.model, isDemo: demo, startOffsetMs: Math.round(startMs) })
        .returning();
      sessionId = session!.id;
      meetingId = meeting.id;

      if (startMs - recorded >= GAP_TOLERANCE_MS && recorded > 0) {
        // Audio the browser captured but never delivered (network loss, reload). It may still hold it locally.
        await store.createGap({ meetingId: meeting.id, sessionId, startMs: recorded, endMs: startMs, reason: h.reason ?? 'network' });
      }
      if (h.reason === 'page_reload' && recorded > 0) {
        // Whatever happened between the page dying and capture restarting has no measurable length: mark the junction.
        await store.createGap({ meetingId: meeting.id, sessionId, startMs, endMs: null, reason: 'page_reload', status: 'unrecoverable' });
      }

      await db
        .update(meetings)
        .set({ transcriptStatus: 'in_progress', endedAt: null, updatedAt: new Date() })
        .where(eq(meetings.id, meeting.id));

      pipeline = new TranscriptionPipeline({
        provider,
        store,
        clock,
        config: pipelineConfig(ctx),
        log: logger,
        emit: send,
        meetingId: meeting.id,
        userId: user.id,
        sessionId,
        source: demo ? 'demo' : 'live',
        connectOptions: {
          languageHints: config.ASR_LANGUAGE_HINTS.split(',').map((s) => s.trim()).filter(Boolean),
          terms: config.ASR_DOMAIN_TERMS.split(',').map((s) => s.trim()).filter(Boolean),
          context: [meeting.title, meeting.guideTopic].filter(Boolean).join('；').slice(0, 300) || undefined,
          sampleRate: SAMPLE_RATE,
        },
      });
      const pl = pipeline;
      handle = {
        meetingId: meeting.id,
        userId: user.id,
        stop: async () => {
          await pl.stop();
          await finishSession('ended');
          send({ type: 'stopped', unsaved: 0 });
          socket.close(1000, 'stopped');
        },
        abort: async (reason) => {
          send({ type: 'error', code: reason, message: reason === 'replaced' ? '已在另一个窗口继续转录' : '会话已关闭', fatal: true });
          await pl.abort();
          await finishSession('interrupted');
          socket.close(4001, reason);
        },
      };
      ctx.registry.register(handle);

      const gaps = await db.select().from(transcriptGaps).where(eq(transcriptGaps.meetingId, meeting.id));
      send({ type: 'ready', sessionId, serverRecordedMs: recorded, demo, provider: provider.name, gaps: gaps.map(serializeGap) });
      pl.start(startMs);
    };

    const onControl = async (msg: ClientMsg) => {
      switch (msg.type) {
        case 'ping':
          send({ type: 'pong', t: msg.t });
          return;
        case 'hello':
          return onHello(msg);
        case 'pause':
          await pipeline?.pause();
          send({ type: 'paused' });
          return;
        case 'resume':
          if (typeof msg.audioStartMs === 'number') {
            skipBytes = 0;
            pipeline?.resume(msg.audioStartMs);
          }
          return;
        case 'stop': {
          if (!pipeline || !handle) return;
          const res = await pipeline.stop();
          await finishSession('ended');
          send({ type: 'stopped', unsaved: res.unsaved });
          setTimeout(() => socket.close(1000, 'stopped'), 100);
          return;
        }
        case 'demo_drop_provider':
          if (demo) pipeline?.debugDropProvider();
          return;
      }
    };

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      lastPong = Date.now();
      if (isBinary) {
        if (!pipeline || data.length > MAX_FRAME_BYTES) return;
        let buf = data;
        if (skipBytes > 0) {
          const cut = Math.min(skipBytes, buf.length);
          skipBytes -= cut;
          buf = buf.subarray(cut);
        }
        if (buf.length >= 2) pipeline.pushAudio(buf.length % 2 ? buf.subarray(0, buf.length - 1) : buf);
        return;
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      // Control messages run strictly in order (hello must finish before pause/stop are handled).
      chain = chain.then(() => onControl(msg)).catch((err) => {
        logger.error({ err: (err as Error).message }, 'ws control handler failed');
        fail('internal', '服务器内部错误', false);
      });
    });

    socket.on('close', () => {
      clearTimeout(helloTimeout);
      clearInterval(hb);
      clearInterval(limitTimer);
      if (finished || !pipeline) return;
      // A socket closed while paused is a clean hand-off (e.g. page refresh after pressing pause).
      // Anything else is a lost connection: salvage what the provider owes us and mark the session interrupted.
      const clean = pipeline.isPaused;
      void pipeline
        .abort()
        .catch(() => {})
        .then(() => finishSession(clean ? 'ended' : 'interrupted'));
    });
    socket.on('error', () => {});
  });
}
