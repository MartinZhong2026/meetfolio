import type { Clock, TimerHandle } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import type { ServerMsg } from './protocol.js';
import type { TranscriptStore } from './store.js';
import { serializeSegment, serializeGap } from '../routes/meetings.js';
import { AsrError, bytesToMs, type AsrConnectOptions, type AsrConnection, type AsrProvider, type AsrResult } from './types.js';

export interface PipelineConfig {
  /** Proactively restart the provider session after this long (0 = never). */
  rotateMs: number;
  rotateGraceMs: number;
  maxReconnectAttempts: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  /** Max unconfirmed audio retained for replay. */
  retainCapMs: number;
  /** Replay speed for backlog relative to real time. */
  replaySpeed: number;
  jitter: boolean;
  persistRetryMs: number;
}

export interface PipelineDeps {
  provider: AsrProvider;
  store: TranscriptStore;
  clock: Clock;
  config: PipelineConfig;
  log: Logger;
  emit(msg: ServerMsg): void;
  meetingId: string;
  userId: string;
  sessionId: string;
  source: 'live' | 'demo';
  connectOptions: AsrConnectOptions;
}

interface Frame {
  startMs: number;
  endMs: number;
  buf: Buffer;
}

type PState = 'idle' | 'connecting' | 'ready' | 'draining' | 'backoff' | 'failed' | 'closed';

/** Gaps shorter than this are rounding noise between frames, not missing speech. */
const GAP_TOLERANCE_MS = 400;
const REPLAY_TICK_MS = 100;

/**
 * Moves audio from a browser to an ASR provider and persists the finalised sentences.
 *
 * Reliability model:
 *  - Every frame stays in `frames` until a final result covers it ("confirmed"). If the provider
 *    connection drops (or is deliberately rotated) the unconfirmed audio is replayed to the new
 *    connection, so a sentence that was in flight is recognised again instead of silently lost.
 *  - If more audio piles up than `retainCapMs`, the oldest is discarded and the loss is recorded
 *    as a transcript gap; the browser still holds that audio and can upload it for recovery.
 *  - Final results are written with a deterministic dedupe key, so replays never duplicate rows.
 */
export class TranscriptionPipeline {
  private frames: Frame[] = [];
  private sentIdx = 0;
  private conn: AsrConnection | null = null;
  private connSeq = 0;
  private connBase: number | null = null;
  private state: PState = 'idle';
  private nextMs = 0;
  /** Audio the provider has finalised (or that sits in a recorded gap): never replayed. */
  private confirmedMs = 0;
  /** Audio whose transcript is safely in the database: the browser may discard its local copy up to here. */
  private persistedMs = 0;
  private paused = true;
  private closed = false;
  private reconnecting = false;
  private failedAnnounced = false;
  private fatal = false;
  private rotateTimer: TimerHandle | null = null;
  private rotateDueAt: number | null = null;
  private replayTimer: TimerHandle | null = null;
  private tickTimer: TimerHandle | null = null;
  private timers = new Set<TimerHandle>();
  private persistChain: Promise<void> = Promise.resolve();
  private persistPending = 0;
  private unsaved = 0;
  private lastResultAt = 0;
  private lastResultKind: 'interim' | 'final' | null = null;
  private tickCount = 0;
  private sleepers = new Set<() => void>();

  // metrics
  sentMs = 0;
  reconnects = 0;
  providerSessions = 0;
  lastErrorCode: string | null = null;

  constructor(private d: PipelineDeps) {}

  get receivedMs() {
    return this.nextMs;
  }
  get confirmed() {
    return this.persistedMs;
  }
  get providerState(): PState {
    return this.state;
  }
  get isPaused() {
    return this.paused;
  }

  /** Resolves once every final received so far has been written (or abandoned after retries). */
  whenPersisted() {
    return this.persistChain;
  }

  // --------------------------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------------------------

  start(audioStartMs: number) {
    this.nextMs = audioStartMs;
    this.confirmedMs = audioStartMs;
    this.persistedMs = audioStartMs;
    this.frames = [];
    this.sentIdx = 0;
    this.paused = false;
    this.startTick();
    void this.reconnectLoop();
  }

  resume(audioStartMs: number) {
    // Ignore a redundant resume while already streaming: starting a second provider session would leak the first.
    if (this.closed || !this.paused) return;
    if (audioStartMs - this.nextMs >= GAP_TOLERANCE_MS) {
      void this.recordGap(this.nextMs, audioStartMs, 'capture_stopped');
    }
    this.nextMs = Math.max(this.nextMs, audioStartMs);
    this.confirmedMs = Math.max(this.confirmedMs, this.nextMs);
    this.persistedMs = Math.max(this.persistedMs, this.nextMs);
    this.frames = [];
    this.sentIdx = 0;
    this.paused = false;
    this.failedAnnounced = false;
    this.fatal = false;
    void this.reconnectLoop();
  }

  /** Browser → server audio. */
  pushAudio(buf: Buffer) {
    if (this.closed || this.paused || buf.length < 2) return;
    const startMs = this.nextMs;
    const endMs = startMs + bytesToMs(buf.length);
    this.nextMs = endMs;
    this.frames.push({ startMs, endMs, buf });
    this.trimRetained();
    if (this.state === 'ready' && !this.replayTimer) this.flushNow();
  }

  /** Finish the provider session but keep the pipeline reusable (pause button). */
  async pause() {
    if (this.closed) return;
    this.paused = true;
    await this.drain();
    await this.recordOutstandingGap();
    await this.persistChain;
    await this.d.store.setRecorded(this.d.meetingId, this.nextMs).catch(() => {});
    this.state = 'idle';
    this.d.emit({ type: 'provider_state', state: 'idle' });
  }

  /** End of recording. Flushes the provider, awaits persistence and tears everything down. */
  async stop(): Promise<{ unsaved: number }> {
    if (this.closed) return { unsaved: this.unsaved };
    this.paused = true;
    await this.drain();
    // Whatever is still unsent (provider was down) is a recorded, honest gap.
    await this.recordOutstandingGap();
    await this.persistChain;
    await this.d.store.setRecorded(this.d.meetingId, this.nextMs).catch(() => {});
    this.shutdown();
    return { unsaved: this.unsaved };
  }

  /** The browser vanished without saying goodbye. Salvage what the provider still owes us. */
  abort(): Promise<void> {
    return (this.abortPromise ??= this.doAbort());
  }

  private abortPromise: Promise<void> | null = null;

  private async doAbort() {
    if (this.closed) return;
    this.paused = true;
    await this.drain(3000);
    await this.recordOutstandingGap();
    await this.persistChain;
    await this.d.store.setRecorded(this.d.meetingId, this.nextMs).catch(() => {});
    this.shutdown();
  }

  /** Test / demo hook: abruptly kill the provider connection as a network failure would. */
  debugDropProvider() {
    (this.conn as any)?.kill?.();
  }

  // --------------------------------------------------------------------------------------------
  // Provider connection management
  // --------------------------------------------------------------------------------------------

  private async connectOnce(): Promise<AsrError | null> {
    this.state = 'connecting';
    const seq = ++this.connSeq;
    this.d.emit({ type: 'provider_state', state: this.reconnects > 0 || this.providerSessions > 0 ? 'reconnecting' : 'connecting' });
    try {
      const conn = await this.d.provider.connect(this.d.connectOptions, {
        onResult: (r) => this.onResult(seq, r),
        onClosed: (info) => this.onClosed(seq, info),
      });
      if (this.closed || this.paused) {
        conn.close();
        return null;
      }
      this.conn = conn;
      this.connBase = null;
      this.sentIdx = 0;
      this.providerSessions++;
      this.state = 'ready';
      this.failedAnnounced = false;
      await this.detectGapBeforeReplay();
      this.scheduleRotation();
      this.d.emit({ type: 'provider_state', state: 'ok' });
      void this.d.store.touchSession(this.d.sessionId, { providerSessions: this.providerSessions, reconnects: this.reconnects }).catch(() => {});
      this.flushNow();
      return null;
    } catch (e) {
      return e instanceof AsrError ? e : new AsrError('transient', 'connect_failed', (e as Error).message);
    }
  }

  private async reconnectLoop() {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;
    let attempt = 0;
    try {
      while (!this.closed && !this.paused) {
        if (attempt > 0) {
          this.state = 'backoff';
          this.d.emit({ type: 'provider_state', state: 'reconnecting', attempt });
          await this.sleep(this.backoffMs(attempt));
          if (this.closed || this.paused) break;
        }
        const err = await this.connectOnce();
        if (!err) break;
        this.lastErrorCode = err.code;
        this.d.log.warn({ meetingId: this.d.meetingId, code: err.code, attempt }, 'asr connect failed');
        void this.d.store.recordUsage(this.d.userId, this.d.meetingId, 'provider_error', 1, { code: err.code }).catch(() => {});
        void this.d.store.touchSession(this.d.sessionId, { lastErrorCode: err.code }).catch(() => {});
        if (err.kind === 'fatal') {
          this.fatal = true;
          this.state = 'failed';
          this.d.emit({ type: 'provider_state', state: 'failed' });
          this.d.emit({ type: 'error', code: 'asr_fatal', message: '语音识别服务配置有误或暂不可用，已保留本地录音以便稍后补录', fatal: true });
          break;
        }
        attempt++;
        if (attempt >= this.d.config.maxReconnectAttempts && !this.failedAnnounced) {
          // Bounded fast retries exhausted: tell the user honestly, then keep trying slowly.
          this.failedAnnounced = true;
          this.state = 'failed';
          this.d.emit({ type: 'provider_state', state: 'failed' });
          this.d.emit({ type: 'error', code: 'asr_unreachable', message: '暂时无法连接语音识别服务，仍在重试；录音已保留，恢复后可补录缺失部分', fatal: false });
          void this.d.store.recordUsage(this.d.userId, this.d.meetingId, 'connection_failure', 1).catch(() => {});
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private backoffMs(attempt: number) {
    const { reconnectBaseMs, reconnectMaxMs, jitter } = this.d.config;
    const base = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** Math.min(attempt - 1, 16));
    return Math.round(jitter ? base * (0.8 + Math.random() * 0.4) : base);
  }

  private onClosed(seq: number, info: { clean: boolean; error?: AsrError }) {
    if (seq !== this.connSeq || this.closed) return;
    if (this.state === 'draining') return; // we asked for it
    if (info.clean && this.paused) return;
    // Unexpected disconnect.
    this.reconnects++;
    this.conn = null;
    this.rotateTimer?.cancel();
    this.d.emit({ type: 'interim_clear' });
    const code = info.error?.code ?? 'ws_closed';
    this.lastErrorCode = code;
    this.d.log.warn({ meetingId: this.d.meetingId, code }, 'asr connection dropped');
    void this.d.store.recordUsage(this.d.userId, this.d.meetingId, 'provider_error', 1, { code }).catch(() => {});
    if (info.error?.kind === 'fatal') {
      this.fatal = true;
      this.state = 'failed';
      this.d.emit({ type: 'provider_state', state: 'failed' });
      this.d.emit({ type: 'error', code: 'asr_fatal', message: '语音识别服务配置有误或暂不可用', fatal: true });
      return;
    }
    this.state = 'backoff';
    void this.reconnectLoop();
  }

  /** Finish the live provider task (flushing pending finals) and treat what it consumed as confirmed. */
  private async drain(timeoutMs = 8000) {
    this.rotateTimer?.cancel();
    this.replayTimer?.cancel();
    this.replayTimer = null;
    const conn = this.conn;
    if (!conn || this.state !== 'ready') return;
    this.state = 'draining';
    this.conn = null;
    const sentEnd = this.sentIdx > 0 ? this.frames[this.sentIdx - 1]!.endMs : this.confirmedMs;
    const ok = await conn.finish(timeoutMs).catch(() => false);
    // Only a confirmed end-of-task proves everything we sent was processed. On timeout the audio stays
    // unconfirmed, so it is replayed to the next connection or recorded as a gap.
    if (ok) {
      this.confirmedMs = Math.max(this.confirmedMs, sentEnd);
      this.dropConfirmedFrames();
    }
  }

  private scheduleRotation() {
    this.rotateTimer?.cancel();
    this.rotateDueAt = null;
    const { rotateMs } = this.d.config;
    if (!rotateMs) return;
    this.rotateTimer = this.timer(() => {
      this.rotateDueAt = this.d.clock.now();
      this.tryRotate();
    }, rotateMs);
  }

  private tryRotate() {
    if (this.closed || this.paused || this.state !== 'ready' || this.rotateDueAt === null) return;
    const now = this.d.clock.now();
    const midSentence = this.lastResultKind === 'interim' && now - this.lastResultAt < 1500;
    if (midSentence && now - this.rotateDueAt < this.d.config.rotateGraceMs) {
      this.timer(() => this.tryRotate(), 400);
      return;
    }
    this.rotateDueAt = null;
    void this.rotate();
  }

  /** Planned provider restart that stays well below any provider-side session limit. */
  private async rotate() {
    this.d.emit({ type: 'provider_state', state: 'rotating' });
    await this.drain();
    if (this.closed || this.paused) return;
    this.state = 'backoff';
    await this.reconnectLoop();
  }

  // --------------------------------------------------------------------------------------------
  // Audio flow
  // --------------------------------------------------------------------------------------------

  private trimRetained() {
    const cap = this.d.config.retainCapMs;
    while (this.frames.length && this.nextMs - this.frames[0]!.startMs > cap) {
      this.frames.shift();
      if (this.sentIdx > 0) this.sentIdx--;
    }
  }

  private dropConfirmedFrames() {
    let n = 0;
    while (n < this.frames.length && this.frames[n]!.endMs <= this.confirmedMs + 1) n++;
    if (n) {
      this.frames.splice(0, n);
      this.sentIdx = Math.max(0, this.sentIdx - n);
    }
  }

  private sendFrame(f: Frame) {
    if (this.connBase === null) this.connBase = f.startMs;
    this.conn?.sendAudio(f.buf);
    this.sentMs += f.endMs - f.startMs;
  }

  /** Sends unsent frames; large backlogs (after an outage) are paced at `replaySpeed`× real time. */
  private flushNow() {
    if (this.state !== 'ready' || !this.conn) return;
    const backlogMs = this.frames.length ? this.nextMs - (this.frames[this.sentIdx]?.startMs ?? this.nextMs) : 0;
    if (backlogMs <= 1500) {
      while (this.sentIdx < this.frames.length) this.sendFrame(this.frames[this.sentIdx++]!);
      return;
    }
    this.replayTick();
  }

  private replayTick() {
    this.replayTimer = null;
    if (this.state !== 'ready' || !this.conn) return;
    let budget = REPLAY_TICK_MS * this.d.config.replaySpeed;
    while (this.sentIdx < this.frames.length && budget > 0) {
      const f = this.frames[this.sentIdx++]!;
      this.sendFrame(f);
      budget -= f.endMs - f.startMs;
    }
    if (this.sentIdx < this.frames.length) this.replayTimer = this.timer(() => this.replayTick(), REPLAY_TICK_MS);
  }

  // --------------------------------------------------------------------------------------------
  // Results & persistence
  // --------------------------------------------------------------------------------------------

  private onResult(seq: number, r: AsrResult) {
    if (seq !== this.connSeq || this.closed) return;
    this.lastResultAt = this.d.clock.now();
    this.lastResultKind = r.kind;
    const base = this.connBase ?? this.confirmedMs;
    const startMs = base + r.startMs;
    if (r.kind === 'interim') {
      this.d.emit({ type: 'interim', key: `${seq}:${r.key}`, text: r.text, startMs });
      return;
    }
    const text = r.text.trim();
    const endMs = base + (r.endMs ?? r.startMs);
    // Confirmation advances even for empty finals so retained audio is released.
    const job = { seq, key: r.key, text, startMs, endMs };
    // The provider is done with this audio, so it must never be replayed — even if the database write
    // below is still in flight. Durability is tracked separately (persistedMs / persistPending).
    this.afterConfirmed(endMs);
    this.persistPending++;
    this.persistChain = this.persistChain.then(() => this.persist(job));
  }

  private async persist(job: { seq: number; key: string; text: string; startMs: number; endMs: number }) {
    try {
      if (!job.text) {
        this.persistedMs = Math.max(this.persistedMs, job.endMs);
        return;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const { segment, created } = await this.d.store.saveFinal({
            meetingId: this.d.meetingId,
            sessionId: this.d.sessionId,
            dedupeKey: `${this.d.sessionId}:${job.seq}:${job.key}`,
            startMs: job.startMs,
            endMs: job.endMs,
            text: job.text,
            source: this.d.source,
          });
          if (created) this.d.emit({ type: 'final', segment: serializeSegment(segment), interimKey: `${job.seq}:${job.key}` });
          this.d.emit({ type: 'persist_state', ok: true, pending: this.persistPending - 1 });
          this.persistedMs = Math.max(this.persistedMs, job.endMs);
          return;
        } catch (err) {
          this.d.log.error({ meetingId: this.d.meetingId, attempt, err: (err as Error).message }, 'segment persist failed');
          this.d.emit({ type: 'persist_state', ok: false, pending: this.persistPending });
          if (attempt >= 8 || this.closed) {
            // Give up loudly rather than pretending the text was saved.
            this.unsaved++;
            this.d.emit({ type: 'error', code: 'persist_failed', message: '部分转录内容未能保存，请检查网络后重试或手动补充', fatal: false });
            return;
          }
          // Database retries are wall-clock concerns, independent of the (injectable) pipeline clock.
          await new Promise<void>((res) => setTimeout(res, Math.min(this.d.config.persistRetryMs * 2 ** attempt, 10_000)));
        }
      }
    } finally {
      this.persistPending--;
    }
  }

  private afterConfirmed(endMs: number) {
    this.confirmedMs = Math.max(this.confirmedMs, endMs);
    this.dropConfirmedFrames();
  }

  // --------------------------------------------------------------------------------------------
  // Gaps
  // --------------------------------------------------------------------------------------------

  private async recordGap(startMs: number, endMs: number | null, reason: 'network' | 'provider' | 'capture_stopped' | 'page_reload') {
    try {
      const g = await this.d.store.createGap({ meetingId: this.d.meetingId, sessionId: this.d.sessionId, startMs, endMs, reason });
      this.d.emit({ type: 'gap', gap: serializeGap(g) });
    } catch (err) {
      this.d.log.error({ meetingId: this.d.meetingId, err: (err as Error).message }, 'gap record failed');
    }
  }

  /** Audio older than the replay window was discarded while the provider was unavailable. */
  private async detectGapBeforeReplay() {
    const first = this.frames[0]?.startMs ?? this.nextMs;
    if (first - this.confirmedMs >= GAP_TOLERANCE_MS) {
      const from = this.confirmedMs;
      this.confirmedMs = first;
      this.persistedMs = Math.max(this.persistedMs, first);
      await this.recordGap(from, first, 'provider');
    }
  }

  private async recordOutstandingGap() {
    // Anything between the confirmed watermark and the newest received audio never reached a final.
    if (this.nextMs - this.confirmedMs >= GAP_TOLERANCE_MS && this.frames.length) {
      const from = this.confirmedMs;
      this.confirmedMs = this.nextMs;
      this.persistedMs = Math.max(this.persistedMs, this.nextMs);
      this.frames = [];
      this.sentIdx = 0;
      await this.recordGap(from, this.nextMs, 'provider');
    }
  }

  // --------------------------------------------------------------------------------------------
  // Housekeeping
  // --------------------------------------------------------------------------------------------

  private startTick() {
    if (this.tickTimer) return;
    const tick = () => {
      if (this.closed) return;
      this.tickCount++;
      this.d.emit({ type: 'ack', receivedMs: Math.round(this.nextMs), confirmedMs: Math.round(Math.min(this.persistedMs, this.confirmedMs)) });
      if (this.tickCount % 5 === 0 && !this.paused) {
        void this.d.store.setRecorded(this.d.meetingId, this.nextMs).catch(() => {});
        void this.d.store.touchSession(this.d.sessionId, { audioMs: this.sentMs }).catch(() => {});
      }
      this.tickTimer = this.timer(tick, 1000);
    };
    this.tickTimer = this.timer(tick, 1000);
  }

  private timer(fn: () => void, ms: number): TimerHandle {
    const h = this.d.clock.setTimeout(() => {
      this.timers.delete(h);
      fn();
    }, ms);
    this.timers.add(h);
    return h;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        this.sleepers.delete(done);
        resolve();
      };
      this.sleepers.add(done);
      this.timer(done, ms);
    });
  }

  private shutdown() {
    this.closed = true;
    this.state = 'closed';
    for (const t of this.timers) t.cancel();
    this.timers.clear();
    for (const s of [...this.sleepers]) s();
    this.conn?.close();
    this.conn = null;
    this.frames = [];
  }
}
