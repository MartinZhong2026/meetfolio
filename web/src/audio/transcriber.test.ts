import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gap } from '../lib/types';
import { __resetAudioDb, MeetingAudioBuffer } from './chunkStore';
import type { Capture, FrameHandler } from './capture';
import { Transcriber, type RecState, type Timers, type TranscriberEvents, type WebSocketLike } from './transcriber';

const uploads: Array<{ gapId: string; fromMs: number; pcm: ArrayBuffer }> = [];
const gapStore: { gaps: Gap[] } = { gaps: [] };
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 0;
  },
  api: {
    uploadGapAudio: vi.fn(async (_m: string, gapId: string, fromMs: number, pcm: ArrayBuffer) => {
      uploads.push({ gapId, fromMs, pcm });
      gapStore.gaps = gapStore.gaps.map((g) => (g.id === gapId ? { ...g, status: 'recovering' as const } : g));
      return { chunkId: 'c' };
    }),
    gaps: vi.fn(async () => ({ gaps: gapStore.gaps.map((g) => (g.status === 'recovering' ? { ...g, status: 'recovered' as const, recoveredMs: (g.endMs ?? 0) - g.startMs } : g)) })),
  },
}));

/** Virtual timers: time only moves when advance() is called. */
class FakeTimers implements Timers {
  t = 1_000_000;
  private id = 0;
  private jobs: Array<{ id: number; at: number; fn: () => void; every?: number }> = [];
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.id;
    this.jobs.push({ id, at: this.t + ms, fn });
    return id;
  }
  setInterval(fn: () => void, ms: number) {
    const id = ++this.id;
    this.jobs.push({ id, at: this.t + ms, fn, every: ms });
    return id;
  }
  clearTimeout(h: unknown) {
    this.jobs = this.jobs.filter((j) => j.id !== h);
  }
  clearInterval(h: unknown) {
    this.clearTimeout(h);
  }
  advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      this.jobs.sort((a, b) => a.at - b.at || a.id - b.id);
      const j = this.jobs[0];
      if (!j || j.at > target) break;
      this.t = j.at;
      if (j.every) j.at += j.every;
      else this.jobs.shift();
      j.fn();
    }
    this.t = target;
  }
}

class FakeWs implements WebSocketLike {
  static all: FakeWs[] = [];
  readyState = 0;
  binaryType = '';
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  sent: Array<string | ArrayBufferLike | ArrayBufferView> = [];
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(d: string | ArrayBufferLike | ArrayBufferView) {
    this.sent.push(d);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  // --- test controls
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSays(o: object) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
  json() {
    return this.sent.filter((x): x is string => typeof x === 'string').map((x) => JSON.parse(x));
  }
  frames() {
    return this.sent.filter((x) => typeof x !== 'string') as ArrayBuffer[];
  }
  static get last() {
    return FakeWs.all[FakeWs.all.length - 1]!;
  }
}

class FakeCapture implements Capture {
  handler: FrameHandler | null = null;
  endedCb: (() => void) | null = null;
  running = false;
  startCalls = 0;
  async start(h: FrameHandler, ended: () => void) {
    this.handler = h;
    this.endedCb = ended as () => void;
    this.running = true;
    this.startCalls++;
  }
  async stop() {
    this.running = false;
  }
  /** Emits one 100 ms frame whose first int32 is its timeline position. */
  emit(posMs: number) {
    const pcm = new Int16Array(1600);
    new DataView(pcm.buffer).setInt32(0, posMs, true);
    this.handler?.(pcm, 0.1);
  }
}

function setup(opts: { start?: number; reason?: 'page_reload'; initialGaps?: Gap[] } = {}) {
  FakeWs.all = [];
  uploads.length = 0;
  gapStore.gaps = [];
  const timers = new FakeTimers();
  const capture = new FakeCapture();
  const buffer = new MeetingAudioBuffer('m1');
  const log: { states: RecState[]; errors: Array<[string, boolean]>; finals: number; gaps: Gap[][]; interims: unknown[]; seg: number } = { states: [], errors: [], finals: 0, gaps: [], interims: [], seg: 0 };
  const events: TranscriberEvents = {
    state: (s) => log.states.push(s),
    position: () => {},
    level: () => {},
    interim: (i) => log.interims.push(i),
    final: () => log.finals++,
    gaps: (g) => log.gaps.push(g),
    segmentsChanged: () => log.seg++,
    provider: () => {},
    persist: () => {},
    error: (c, _m, fatal) => log.errors.push([c, fatal]),
    storage: () => {},
  };
  const tr = new Transcriber({
    meetingId: 'm1',
    demo: false,
    startPositionMs: opts.start ?? 0,
    resumeReason: opts.reason,
    capture,
    buffer,
    events,
    wsFactory: (url) => new FakeWs(url),
    timers,
    initialGaps: opts.initialGaps,
  });
  const ready = (ws = FakeWs.last, gaps: Gap[] = []) => {
    gapStore.gaps = gaps;
    ws.serverSays({ type: 'ready', sessionId: 's', serverRecordedMs: 0, demo: false, provider: 'x', gaps });
  };
  return { tr, timers, capture, buffer, log, ready };
}

beforeEach(async () => {
  await __resetAudioDb();
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'http:', host: 'localhost:5173' }, configurable: true });
});
afterEach(() => vi.clearAllMocks());

/** IndexedDB operations complete on later event-loop turns, so poll in real time. */
async function until(fn: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const flushAsync = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('Transcriber: connection lifecycle', () => {
  it('captures first, announces its start position in hello, and sends queued frames only after the server is ready', async () => {
    const { tr, capture, ready, log } = setup({ start: 5_000 });
    await tr.start();
    const ws = FakeWs.last;
    ws.open();
    expect(ws.url).toBe('ws://localhost:5173/ws/transcribe');
    const hello = ws.json()[0];
    expect(hello).toMatchObject({ type: 'hello', meetingId: 'm1', audioStartMs: 5_000 });
    capture.emit(5_000);
    capture.emit(5_100);
    expect(ws.frames()).toHaveLength(0); // not ready yet: queued, not lost
    ready();
    expect(ws.frames()).toHaveLength(2);
    capture.emit(5_200);
    expect(ws.frames()).toHaveLength(3);
    expect(log.states.at(-1)).toBe('recording');
    expect(tr.position).toBe(5_300);
  });

  it('maps server events to UI events and reports mic permission problems as a fatal, readable error', async () => {
    const { tr, ready, log } = setup();
    await tr.start();
    FakeWs.last.open();
    ready();
    FakeWs.last.serverSays({ type: 'interim', key: 'k', text: '你好', startMs: 0 });
    FakeWs.last.serverSays({ type: 'final', interimKey: 'k', segment: { id: 's1', seq: 1, startMs: 0, endMs: 1000, originalText: '你好', editedText: null, speakerLabel: null, isImportant: false, source: 'live', updatedAt: '' } });
    expect(log.finals).toBe(1);
    expect(log.interims.at(-1)).toMatchObject({ text: '你好' });

    const denied = setup();
    denied.capture.start = async () => {
      const { MicPermissionError } = await import('./capture');
      throw new MicPermissionError('denied', '没有麦克风权限');
    };
    await denied.tr.start();
    expect(denied.log.states.at(-1)).toBe('failed');
    expect(denied.log.errors[0]).toEqual(['mic_denied', true]);
  });

  it('fatal server errors stop capture and surface as failed (no silent retry loop)', async () => {
    const { tr, capture, ready, log } = setup();
    await tr.start();
    FakeWs.last.open();
    FakeWs.last.serverSays({ type: 'error', code: 'asr_not_configured', message: 'x', fatal: true });
    await flushAsync();
    expect(log.states.at(-1)).toBe('failed');
    expect(capture.running).toBe(false);
    expect(log.errors.at(-1)).toEqual(['asr_not_configured', true]);
    void ready;
  });

  it('pause stops capture and tells the server; resume continues the same timeline on the same socket', async () => {
    const { tr, capture, ready, log } = setup();
    await tr.start();
    const ws = FakeWs.last;
    ws.open();
    ready();
    capture.emit(0);
    capture.emit(100);
    await tr.pause();
    expect(log.states.at(-1)).toBe('paused');
    expect(capture.running).toBe(false);
    expect(ws.json().some((m) => m.type === 'pause')).toBe(true);
    await tr.resume();
    expect(capture.startCalls).toBe(2);
    expect(ws.json().at(-1)).toEqual({ type: 'resume', audioStartMs: 200 });
    expect(FakeWs.all).toHaveLength(1);
    expect(log.states.at(-1)).toBe('recording');
  });

  it('end() asks the server to stop and resolves only after it confirms (so the last sentence is saved)', async () => {
    const { tr, ready, log, timers } = setup();
    await tr.start();
    FakeWs.last.open();
    ready();
    let done = false;
    const p = tr.end().then((r) => {
      done = true;
      return r;
    });
    await flushAsync();
    expect(FakeWs.last.json().at(-1)).toEqual({ type: 'stop' });
    expect(done).toBe(false);
    FakeWs.last.serverSays({ type: 'stopped', unsaved: 0 });
    expect(await p).toEqual({ clean: true });
    expect(log.states.at(-1)).toBe('ended');
    void timers;
  });
});

describe('Transcriber: interruption recovery', () => {
  it('detects a half-open connection through missing server heartbeats and reconnects', async () => {
    const { tr, timers, ready, log } = setup();
    await tr.start();
    FakeWs.last.open();
    ready();
    FakeWs.last.serverSays({ type: 'ack', receivedMs: 0, confirmedMs: 0 });
    expect(FakeWs.last.json().filter((m) => m.type === 'ping')).toHaveLength(0);
    timers.advance(8_000);
    expect(FakeWs.last.json().filter((m) => m.type === 'ping')).toHaveLength(1);
    timers.advance(17_000); // server has been silent for > 16 s while the socket still looks open
    expect(log.states).toContain('reconnecting');
    timers.advance(1_000);
    expect(FakeWs.all).toHaveLength(2);
  });

  it('reconnects with bounded exponential backoff and reports connection failure after repeated attempts', async () => {
    const { tr, timers, log } = setup();
    await tr.start();
    FakeWs.last.open();
    FakeWs.last.serverSays({ type: 'ready', sessionId: 's', serverRecordedMs: 0, demo: false, provider: 'x', gaps: [] });
    FakeWs.last.close();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = FakeWs.all.length;
      let waited = 0;
      while (FakeWs.all.length === before && waited < 20_000) {
        timers.advance(500);
        waited += 500;
      }
      delays.push(waited);
      FakeWs.last.close(); // every retry fails to connect
    }
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
    expect(delays[3]).toBe(8000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(15_000);
    expect(delays.slice(4).every((d) => d === 15_000)).toBe(true);
    expect(log.states.at(-1)).toBe('reconnecting');
  });

  for (const minute of [17, 25, 60]) {
    it(`network drop at ${minute} min: capture continues, hello resumes at the live position, and the missed audio is uploaded from the local buffer`, async () => {
      const { tr, timers, capture, buffer, ready, log } = setup();
      await tr.start();
      FakeWs.last.open();
      ready();
      let pos = 0;
      const emitFor = (ms: number) => {
        for (let i = 0; i < ms / 100; i++) {
          capture.emit(pos);
          pos += 100;
        }
      };
      emitFor(minute * 60_000);
      const serverHas = pos; // everything up to here reached the server
      FakeWs.last.close(); // network drops
      emitFor(20_000); // 20 s with no connection — microphone keeps going
      expect(tr.position).toBe(pos);
      timers.advance(1000); // backoff elapsed → reconnect attempt
      const ws2 = FakeWs.last;
      ws2.open();
      expect(ws2.json()[0]).toMatchObject({ type: 'hello', audioStartMs: pos, reason: 'network' });
      const gap: Gap = { id: 'g1', startMs: serverHas, endMs: pos, reason: 'network', status: 'open', recoveredMs: 0, createdAt: '' };
      ready(ws2, [gap]);
      await until(() => uploads.length === 1);
      // The browser handed the missing 20 s back for re-transcription, byte-exact.
      expect(uploads).toHaveLength(1);
      expect(uploads[0]!.gapId).toBe('g1');
      expect(uploads[0]!.fromMs).toBe(serverHas);
      expect(uploads[0]!.pcm.byteLength).toBe(20_000 * 32);
      const first = new DataView(uploads[0]!.pcm).getInt32(0, true);
      expect(first).toBe(serverHas); // marker of the first frame in the gap
      const lastFrame = new DataView(uploads[0]!.pcm).getInt32(uploads[0]!.pcm.byteLength - 3200, true);
      expect(lastFrame).toBe(pos - 100);
      // And the gap's lifecycle reaches "recovered" with the UI told to refresh the transcript.
      for (let i = 0; i < 20 && log.seg === 0; i++) {
        timers.advance(2_000);
        await flushAsync(5);
      }
      expect(log.seg).toBeGreaterThan(0);
      expect(log.gaps.at(-1)!.find((g) => g.id === 'g1')!.status).toBe('recovered');
      void buffer;
    }, 30_000);
  }

  it('logical 90-minute session with drops at 17, 25 and 60 minutes: every frame is delivered exactly once (live or via gap upload)', async () => {
    const { tr, timers, capture, ready } = setup();
    await tr.start();
    FakeWs.last.open();
    ready();
    const live = new Set<number>();
    const trackLive = () => {
      for (const f of FakeWs.last.frames()) live.add(new DataView(f).getInt32(0, true));
    };
    let pos = 0;
    const drops = [17, 25, 60].map((m) => m * 60_000);
    const outages = new Map<number, number>([
      [drops[0]!, 12_000],
      [drops[1]!, 45_000],
      [drops[2]!, 90_000],
    ]);
    const allGaps: Gap[] = [];
    const total = 90 * 60_000;
    let lastServerPos = 0;
    while (pos < total) {
      capture.emit(pos);
      pos += 100;
      const outage = outages.get(pos);
      if (outage) {
        trackLive();
        lastServerPos = pos;
        FakeWs.last.close();
        for (let t = 0; t < outage; t += 100) {
          capture.emit(pos);
          pos += 100;
          if (t % 1000 === 0) timers.advance(1000);
        }
        // let the backoff timers elapse until a new socket exists
        for (let i = 0; i < 40 && FakeWs.all[FakeWs.all.length - 1]!.readyState === 3; i++) timers.advance(500);
        const ws = FakeWs.last;
        ws.open();
        const g: Gap = { id: `g${allGaps.length}`, startMs: lastServerPos, endMs: pos, reason: 'network', status: 'open', recoveredMs: 0, createdAt: '' };
        allGaps.push(g);
        ready(ws, [g]);
        await until(() => uploads.length === allGaps.length);
      }
      if (pos % 60_000 === 0) await flushAsync(1);
    }
    trackLive();
    // Frames delivered via gap upload.
    const viaUpload = new Set<number>();
    for (const u of uploads) {
      const dv = new DataView(u.pcm);
      for (let o = 0; o < u.pcm.byteLength; o += 3200) viaUpload.add(dv.getInt32(o, true));
    }
    expect(uploads).toHaveLength(3);
    // Every captured frame reached the server exactly once, by exactly one route.
    let missing = 0;
    let dupes = 0;
    for (let p = 0; p < pos; p += 100) {
      const a = live.has(p);
      const b = viaUpload.has(p);
      if (!a && !b) missing++;
      if (a && b) dupes++;
    }
    expect(missing).toBe(0);
    expect(dupes).toBe(0);
    expect(pos).toBe(total + 0 + (pos - total));
  }, 60_000);

  it('after a page reload the next capture announces reason=page_reload and starts at the saved position', async () => {
    const { tr, ready } = setup({ start: 42_000, reason: 'page_reload' });
    await tr.start();
    FakeWs.last.open();
    expect(FakeWs.last.json()[0]).toMatchObject({ type: 'hello', audioStartMs: 42_000, reason: 'page_reload' });
    ready();
  });

  it('keeps recording locally when the server is unreachable from the very start', async () => {
    const { tr, capture, buffer, log, timers } = setup();
    await tr.start();
    FakeWs.last.close(); // never opened
    expect(log.states.at(-1)).toBe('reconnecting');
    for (let i = 0; i < 30; i++) capture.emit(i * 100);
    timers.advance(1000);
    const r = await buffer.read(0, 3_000);
    expect(r?.coveredMs).toBe(3_000);
  });
});
