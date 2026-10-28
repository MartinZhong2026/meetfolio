import { api, ApiError } from '../lib/api';
import type { Gap, Segment } from '../lib/types';
import { MeetingAudioBuffer, FRAME_MS } from './chunkStore';
import { MicPermissionError, type Capture } from './capture';

export type RecState = 'idle' | 'connecting' | 'recording' | 'reconnecting' | 'paused' | 'ended' | 'failed';
export type ProviderState = 'connecting' | 'ok' | 'reconnecting' | 'failed' | 'rotating' | 'idle';

export interface TranscriberEvents {
  state(s: RecState, info?: { attempt?: number; connectionFailed?: boolean }): void;
  position(ms: number): void;
  level(rms: number): void;
  interim(i: { key: string; text: string; startMs: number } | null): void;
  final(seg: Segment, interimKey?: string): void;
  gaps(gaps: Gap[]): void;
  /** Called when recovery added segments server-side; the UI should refetch the transcript. */
  segmentsChanged(): void;
  provider(s: ProviderState, attempt?: number): void;
  persist(ok: boolean): void;
  error(code: string, message: string, fatal: boolean): void;
  storage(available: boolean): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
  now(): number;
}

export interface WebSocketLike {
  readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface TranscriberOptions {
  meetingId: string;
  demo: boolean;
  /** Timeline position at which this capture run starts (server-saved high-water mark, or later). */
  startPositionMs: number;
  /** Why capture is resuming after the page died, if it did. */
  resumeReason?: 'page_reload';
  capture: Capture;
  buffer: MeetingAudioBuffer | null;
  events: TranscriberEvents;
  wsFactory?: (url: string) => WebSocketLike;
  /** Injection points for tests. */
  timers?: Timers;
  /** Knows which gaps the user's browser may still be able to recover (known to the UI). */
  initialGaps?: Gap[];
}

const OPEN = 1;
const HEARTBEAT_MS = 8000;
const DEAD_AFTER_MS = 16000;
const FAST_FAIL_ATTEMPTS = 6;

/**
 * Orchestrates one meeting's live capture:
 *   microphone → local IndexedDB buffer → WebSocket → server (→ DashScope) → transcript events
 *
 * Capture never depends on the network. Whenever the connection or the speech service fails, audio keeps being
 * buffered locally; once the server is reachable again it reports which timeline intervals are missing (gaps) and
 * this class uploads the matching locally buffered audio so the server can re-transcribe it.
 */
export class Transcriber {
  state: RecState = 'idle';
  private pos: number;
  private ws: WebSocketLike | null = null;
  private ready = false;
  private pending: Array<{ pos: number; buf: ArrayBuffer }> = [];
  /** True between sending hello and receiving ready: frames captured now are queued, in order, with no holes. */
  private awaitingReady = false;
  private userPaused = false;
  private userStopped = false;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeat: unknown = null;
  private lastRx = 0;
  private gaps: Gap[] = [];
  private uploading = new Set<string>();
  private captureRunning = false;
  private stoppedWaiter: (() => void) | null = null;
  private lastPositionEmit = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  private disposed = false;
  private t: Timers;

  constructor(private o: TranscriberOptions) {
    this.pos = o.startPositionMs;
    this.gaps = o.initialGaps ?? [];
    this.t = o.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as number),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as number),
      now: () => Date.now(),
    };
  }

  get position() {
    return this.pos;
  }
  get openGaps() {
    return this.gaps.filter((g) => g.status === 'open' || g.status === 'recovering');
  }

  private setState(s: RecState, info?: { attempt?: number; connectionFailed?: boolean }) {
    this.state = s;
    this.o.events.state(s, info);
  }

  // -------------------------------------------------------------------------------------------------
  // Public controls
  // -------------------------------------------------------------------------------------------------

  async start() {
    this.userPaused = false;
    this.userStopped = false;
    this.setState('connecting');
    try {
      await this.startCapture();
    } catch (e) {
      this.setState('failed');
      this.o.events.error(e instanceof MicPermissionError ? `mic_${e.kind}` : 'mic_error', (e as Error).message, true);
      return;
    }
    void this.acquireWakeLock();
    this.connect(this.o.resumeReason);
  }

  async pause() {
    if (this.state === 'paused' || this.state === 'idle' || this.state === 'ended') return;
    this.userPaused = true;
    await this.stopCapture();
    await this.o.buffer?.flush();
    this.clearReconnect();
    if (this.ws && this.ready) this.sendJson({ type: 'pause' });
    this.ready = false;
    this.awaitingReady = false;
    this.pending = [];
    this.o.events.interim(null);
    this.setState('paused');
    void this.releaseWakeLock();
  }

  async resume() {
    if (this.state !== 'paused' && this.state !== 'failed') return;
    this.userPaused = false;
    this.setState('connecting');
    try {
      await this.startCapture();
    } catch (e) {
      this.setState('failed');
      this.o.events.error(e instanceof MicPermissionError ? `mic_${e.kind}` : 'mic_error', (e as Error).message, true);
      return;
    }
    void this.acquireWakeLock();
    if (this.ws && this.ws.readyState === OPEN) {
      this.sendJson({ type: 'resume', audioStartMs: this.pos });
      this.ready = true;
      this.setState('recording');
    } else {
      this.connect();
    }
  }

  /** Ends the live session cleanly: waits (briefly) for the server to flush and persist the last sentence. */
  async end(): Promise<{ clean: boolean }> {
    this.userStopped = true;
    this.clearReconnect();
    await this.stopCapture();
    await this.o.buffer?.flush();
    let clean = false;
    if (this.ws && this.ws.readyState === OPEN && (this.ready || this.state === 'paused')) {
      clean = await new Promise<boolean>((resolve) => {
        const timer = this.t.setTimeout(() => {
          this.stoppedWaiter = null;
          resolve(false);
        }, 15000);
        this.stoppedWaiter = () => {
          this.t.clearTimeout(timer);
          resolve(true);
        };
        this.sendJson({ type: 'stop' });
      });
    }
    this.teardownSocket();
    this.o.events.interim(null);
    this.setState('ended');
    void this.releaseWakeLock();
    return { clean };
  }

  dispose() {
    this.disposed = true;
    this.userStopped = true;
    this.clearReconnect();
    void this.stopCapture();
    this.teardownSocket();
    void this.releaseWakeLock();
  }

  /** Demo only: ask the server to kill the provider connection to show automatic recovery. */
  demoDropProvider() {
    this.sendJson({ type: 'demo_drop_provider' });
  }

  /** Test/diagnostic hook: sever the network connection without any goodbye. */
  simulateNetworkLoss() {
    this.ws?.close(4999, 'simulated');
  }

  /** Re-attempt uploading local audio for open gaps (also bound to the "补录" buttons). */
  async recoverNow(gapIds?: string[]) {
    const targets = this.gaps.filter((g) => g.status === 'open' && (!gapIds || gapIds.includes(g.id)));
    await Promise.all(targets.map((g) => this.recoverGap(g)));
  }

  setGaps(gaps: Gap[]) {
    this.gaps = gaps;
    this.o.events.gaps(gaps);
  }

  // -------------------------------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------------------------------

  private async startCapture() {
    if (this.captureRunning) return;
    await this.o.capture.start(
      (pcm, rms) => this.onFrame(pcm, rms),
      () => {
        // Microphone unplugged or permission revoked mid-session.
        void this.pause().then(() => this.o.events.error('mic_lost', '麦克风已断开。请检查设备后点击“继续”', false));
      },
    );
    this.captureRunning = true;
  }

  private async stopCapture() {
    if (!this.captureRunning) return;
    this.captureRunning = false;
    await this.o.capture.stop().catch(() => {});
  }

  private onFrame(pcm: Int16Array, rms: number) {
    if (!this.captureRunning) return;
    const pos = this.pos;
    this.pos += FRAME_MS;
    if (!this.o.demo) this.o.buffer?.append(pos, pcm);
    // Copy: the frame buffer is owned by the audio pipeline.
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    if (this.ready && this.ws && this.ws.readyState === OPEN) this.ws.send(buf);
    else if (this.awaitingReady) {
      this.pending.push({ pos, buf });
      if (this.pending.length > 600) {
        // The server has not answered for a minute. Queued frames must stay contiguous, so give up on this
        // attempt instead of dropping the oldest; the local buffer keeps the audio and the next hello records the gap.
        this.pending = [];
        this.awaitingReady = false;
        this.ws?.close(4001, 'ready_timeout');
      }
    }
    const now = this.t.now();
    if (now - this.lastPositionEmit > 250) {
      this.lastPositionEmit = now;
      this.o.events.position(this.pos);
      this.o.events.level(rms);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------------------------------

  private url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws/transcribe`;
  }

  private connect(reason?: 'network' | 'page_reload' | 'capture_stopped') {
    if (this.disposed || this.userStopped) return;
    this.teardownSocket();
    const ws = this.o.wsFactory ? this.o.wsFactory(this.url()) : (new WebSocket(this.url()) as unknown as WebSocketLike);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = false;
    this.awaitingReady = false;
    this.pending = [];
    ws.onopen = () => {
      this.lastRx = this.t.now();
      this.startHeartbeat();
      // Stamp the start position at the moment hello is sent: the socket may have taken seconds to open while capture
      // continued. Frames from this exact point on are queued and delivered once the server is ready.
      this.pending = [];
      this.awaitingReady = true;
      ws.send(JSON.stringify({ type: 'hello', meetingId: this.o.meetingId, audioStartMs: this.pos, demo: this.o.demo || undefined, reason }));
    };
    ws.onmessage = (ev) => {
      this.lastRx = this.t.now();
      if (typeof ev.data === 'string') this.onMessage(JSON.parse(ev.data));
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return; // an older socket
      this.onSocketClosed();
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = this.t.setInterval(() => {
      if (!this.ws) return;
      if (this.t.now() - this.lastRx > DEAD_AFTER_MS) {
        // Half-open connection: the browser never noticed. Force a reconnect.
        this.ws.close(4000, 'heartbeat_timeout');
        return;
      }
      if (this.ws.readyState === OPEN) this.sendJson({ type: 'ping', t: this.t.now() });
    }, HEARTBEAT_MS);
  }
  private stopHeartbeat() {
    if (this.heartbeat) this.t.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private teardownSocket() {
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    this.awaitingReady = false;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  private onSocketClosed() {
    this.stopHeartbeat();
    this.ws = null;
    this.ready = false;
    this.awaitingReady = false;
    this.stoppedWaiter?.();
    this.stoppedWaiter = null;
    if (this.userStopped || this.disposed || this.userPaused || this.state === 'failed' || this.state === 'ended') return;
    this.o.events.interim(null);
    this.o.events.provider('idle');
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    this.attempt++;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempt - 1, 4));
    this.setState('reconnecting', { attempt: this.attempt, connectionFailed: this.attempt >= FAST_FAIL_ATTEMPTS });
    this.clearReconnect();
    this.reconnectTimer = this.t.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.captureRunning && !this.userStopped) this.connect('network');
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) this.t.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private sendJson(o: object) {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(o));
  }

  // -------------------------------------------------------------------------------------------------
  // Server messages
  // -------------------------------------------------------------------------------------------------

  private onMessage(m: any) {
    const ev = this.o.events;
    switch (m.type) {
      case 'ready': {
        this.attempt = 0;
        this.ready = true;
        this.awaitingReady = false;
        for (const f of this.pending) this.ws?.send(f.buf);
        this.pending = [];
        this.setState(this.userPaused ? 'paused' : 'recording');
        // Paused while the server was still answering hello: tell it now so no provider session idles.
        if (this.userPaused) this.sendJson({ type: 'pause' });
        this.setGaps(m.gaps as Gap[]);
        void this.recoverNow();
        break;
      }
      case 'provider_state':
        ev.provider(m.state, m.attempt);
        break;
      case 'interim':
        ev.interim({ key: m.key, text: m.text, startMs: m.startMs });
        break;
      case 'interim_clear':
        ev.interim(null);
        break;
      case 'final':
        ev.final(m.segment, m.interimKey);
        break;
      case 'gap': {
        const g = m.gap as Gap;
        this.setGaps([...this.gaps.filter((x) => x.id !== g.id), g]);
        // The provider was unavailable for that stretch; we still hold the audio, so offer it back right away.
        this.t.setTimeout(() => void this.recoverGap(g), 3000);
        break;
      }
      case 'ack':
        void this.pruneConfirmed(m.confirmedMs);
        break;
      case 'persist_state':
        ev.persist(m.ok);
        break;
      case 'stopped':
        this.stoppedWaiter?.();
        this.stoppedWaiter = null;
        break;
      case 'paused':
      case 'pong':
        break;
      case 'error': {
        ev.error(m.code, m.message, m.fatal);
        if (m.fatal) {
          this.userPaused = true;
          void this.stopCapture().then(() => this.o.buffer?.flush());
          this.clearReconnect();
          this.setState(m.code === 'replaced' ? 'ended' : 'failed');
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Local buffer housekeeping & gap upload
  // -------------------------------------------------------------------------------------------------

  private lastPrune = 0;
  private async pruneConfirmed(confirmedMs: number) {
    const now = this.t.now();
    if (now - this.lastPrune < 10_000 || !this.o.buffer) return;
    this.lastPrune = now;
    const openStarts = this.gaps.filter((g) => g.status === 'open' || g.status === 'recovering').map((g) => g.startMs);
    // Keep everything newer than the transcript the server has durably stored, and anything still needed for a gap.
    const keepFrom = Math.min(confirmedMs, ...openStarts) - 3000;
    if (keepFrom > 0) await this.o.buffer.pruneBefore(keepFrom).catch(() => {});
  }

  private async recoverGap(gap: Gap) {
    const buffer = this.o.buffer;
    if (!buffer || this.uploading.has(gap.id)) return;
    const current = this.gaps.find((g) => g.id === gap.id);
    if (!current || current.status !== 'open') return;
    this.uploading.add(gap.id);
    try {
      const hi = gap.endMs ?? this.pos;
      const data = await buffer.read(gap.startMs, hi);
      if (!data) return; // this browser does not hold audio for the interval
      await api.uploadGapAudio(this.o.meetingId, gap.id, data.fromMs, data.pcm);
      this.patchGap(gap.id, { status: 'recovering' });
      await this.pollGap(gap.id);
    } catch (e) {
      // Provider still down / throttled: stay "open" and retry later while the session lives.
      if (!(e instanceof ApiError) || e.status !== 409) this.t.setTimeout(() => !this.disposed && void this.recoverGap(gap), 30_000);
    } finally {
      this.uploading.delete(gap.id);
    }
  }

  private patchGap(id: string, patch: Partial<Gap>) {
    this.setGaps(this.gaps.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  private async pollGap(id: string) {
    for (let i = 0; i < 900 && !this.disposed; i++) {
      await new Promise<void>((r) => this.t.setTimeout(() => r(), i < 5 ? 1000 : 3000));
      try {
        const { gaps } = await api.gaps(this.o.meetingId);
        this.setGaps(gaps);
        const g = gaps.find((x) => x.id === id);
        if (!g || g.status !== 'recovering') {
          this.o.events.segmentsChanged();
          return;
        }
      } catch {
        /* transient; keep polling */
      }
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Screen wake lock: a sleeping device cannot record, and browsers cannot record while asleep.
  // -------------------------------------------------------------------------------------------------

  private async acquireWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
      if (nav.wakeLock && !this.wakeLock) this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      /* not supported or denied: best effort only */
    }
  }
  private async releaseWakeLock() {
    try {
      await this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }
}
