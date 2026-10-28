import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '../src/asr/protocol.js';
import { api, createMeeting, makeEnv, register, type Session, type TestEnv } from './helpers.js';

let env: TestEnv;
let base: string;
beforeAll(async () => {
  env = await makeEnv();
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  base = `127.0.0.1:${(env.app.server.address() as AddressInfo).port}`;
});
afterAll(() => env.close());
beforeEach(() => env.reset());

class Client {
  msgs: ServerMsg[] = [];
  closed: { code: number } | null = null;
  ws!: WebSocket;
  static async open(cookie: string | null, origin = 'http://localhost:5173') {
    const c = new Client();
    c.ws = new WebSocket(`ws://${base}/ws/transcribe`, { headers: { ...(cookie ? { cookie } : {}), origin } });
    c.ws.on('message', (d, bin) => !bin && c.msgs.push(JSON.parse(d.toString())));
    c.ws.on('close', (code) => (c.closed = { code }));
    await new Promise<void>((res, rej) => {
      c.ws.once('open', () => res());
      c.ws.once('unexpected-response', (_q, r) => rej(new Error(`http ${r.statusCode}`)));
      c.ws.once('error', rej);
    });
    return c;
  }
  send(o: object) {
    this.ws.send(JSON.stringify(o));
  }
  /** Streams silence at (fast) real-time-independent speed: the demo provider is driven by audio duration. */
  audio(fromMs: number, ms: number) {
    for (let t = 0; t < ms; t += 100) this.ws.send(Buffer.alloc(3200));
    return fromMs + ms;
  }
  async until<T extends ServerMsg['type']>(type: T, pred: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true, ms = 4000) {
    const t0 = Date.now();
    for (;;) {
      const m = this.msgs.find((x) => x.type === type && pred(x as never));
      if (m) return m as Extract<ServerMsg, { type: T }>;
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${type}; got ${this.msgs.map((x) => x.type).join(',')}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  close() {
    this.ws.close();
  }
}

async function demoMeeting(s: Session) {
  const r = await api(env, s).post('/api/meetings', { title: '演示访谈', demo: true });
  return r.json().meeting as { id: string };
}

describe('live transcription over WebSocket (demo provider; no paid calls)', () => {
  it('rejects unauthenticated sockets and foreign origins', async () => {
    const anon = await Client.open(null);
    await anon.until('error', (m) => m.code === 'unauthorized');
    const s = await register(env);
    await expect(Client.open(s.cookie, 'https://evil.example')).rejects.toThrow(/403/);
  });

  it('streams interim → final, persists segments, and acks; stop completes the session', async () => {
    const s = await register(env);
    const m = await demoMeeting(s);
    const c = await Client.open(s.cookie);
    c.send({ type: 'hello', meetingId: m.id, audioStartMs: 0, demo: true });
    const ready = await c.until('ready');
    expect(ready.demo).toBe(true);
    expect(ready.provider).toBe('demo');
    await c.until('provider_state', (x) => x.state === 'ok');
    c.audio(0, 12_000);
    await c.until('final');
    expect(c.msgs.some((x) => x.type === 'interim')).toBe(true);
    const fin = c.msgs.find((x) => x.type === 'final') as Extract<ServerMsg, { type: 'final' }>;
    expect(fin.segment.source).toBe('demo');
    expect(fin.interimKey).toBeTruthy();
    c.send({ type: 'stop' });
    await c.until('stopped');
    const bundle = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(bundle.segments.length).toBeGreaterThan(0);
    expect(bundle.segments.every((x: { source: string }) => x.source === 'demo')).toBe(true);
    expect(bundle.meeting.recordedMs).toBeGreaterThan(11_000);
    const { rows } = await env.ctx.db.$client.query('select status from transcription_sessions');
    expect(rows[0].status).toBe('ended');
  });

  it('provider drop is recovered transparently: same meeting, same session, no duplicates', async () => {
    const s = await register(env);
    const m = await demoMeeting(s);
    const c = await Client.open(s.cookie);
    c.send({ type: 'hello', meetingId: m.id, audioStartMs: 0, demo: true });
    await c.until('provider_state', (x) => x.state === 'ok');
    let t = c.audio(0, 9_000);
    await c.until('final');
    c.send({ type: 'demo_drop_provider' });
    await c.until('provider_state', (x) => x.state === 'reconnecting');
    t = c.audio(t, 9_000);
    await c.until('provider_state', (x) => x.state === 'ok' && c.msgs.filter((y) => y.type === 'provider_state').length >= 4);
    c.audio(t, 6_000);
    await new Promise((r) => setTimeout(r, 300));
    c.send({ type: 'stop' });
    await c.until('stopped');
    const bundle = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    const texts = bundle.segments.map((x: { originalText: string }) => x.originalText);
    expect(new Set(texts).size).toBe(texts.length);
    expect(bundle.gaps).toEqual([]);
    const { rows } = await env.ctx.db.$client.query('select count(*)::int as n, max(reconnects) as r from transcription_sessions');
    expect(rows[0].n).toBe(1);
    expect(rows[0].r).toBe(1);
    expect((await api(env, s).get('/api/meetings')).json().meetings).toHaveLength(1);
  });

  it('browser connection loss: salvage, mark interrupted, and a reconnect with a later start position creates a recoverable gap', async () => {
    const s = await register(env);
    const m = await demoMeeting(s);
    const a = await Client.open(s.cookie);
    a.send({ type: 'hello', meetingId: m.id, audioStartMs: 0, demo: true });
    await a.until('provider_state', (x) => x.state === 'ok');
    a.audio(0, 8_000);
    await a.until('final');
    a.ws.terminate(); // network cable pulled
    await new Promise((r) => setTimeout(r, 400));
    const mid = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(mid.meeting.transcriptStatus).toBe('interrupted');
    const recorded = mid.meeting.recordedMs;
    expect(recorded).toBeGreaterThanOrEqual(7_900);

    // 20 s later the browser reconnects; it captured audio throughout, so it resumes at 28 s.
    const b = await Client.open(s.cookie);
    b.send({ type: 'hello', meetingId: m.id, audioStartMs: 28_000, demo: true, reason: 'network' });
    const ready = await b.until('ready');
    expect(ready.serverRecordedMs).toBe(recorded);
    expect(ready.gaps).toHaveLength(1);
    expect(ready.gaps[0]).toMatchObject({ reason: 'network', status: 'open' });
    expect(ready.gaps[0]!.startMs).toBe(recorded);
    expect(ready.gaps[0]!.endMs).toBe(28_000);
    expect((await api(env, s).get('/api/meetings')).json().meetings).toHaveLength(1); // not a new meeting
    b.send({ type: 'stop' });
    await b.until('stopped');
  });

  it('gap recovery: uploading the locally buffered audio re-transcribes the missing interval, idempotently', async () => {
    const s = await register(env);
    const m = await demoMeeting(s);
    const a = await Client.open(s.cookie);
    a.send({ type: 'hello', meetingId: m.id, audioStartMs: 0, demo: true });
    await a.until('provider_state', (x) => x.state === 'ok');
    a.audio(0, 5_000);
    await new Promise((r) => setTimeout(r, 200));
    a.ws.terminate();
    await new Promise((r) => setTimeout(r, 300));
    const b = await Client.open(s.cookie);
    b.send({ type: 'hello', meetingId: m.id, audioStartMs: 35_000, demo: true });
    const ready = await b.until('ready');
    const gap = ready.gaps[0]!;
    b.send({ type: 'stop' });
    await b.until('stopped');

    const upload = async () =>
      env.app.inject({
        method: 'POST',
        url: `/api/meetings/${m.id}/gaps/${gap.id}/audio?fromMs=${gap.startMs}`,
        payload: Buffer.alloc(((gap.endMs! - gap.startMs) / 1000) * 32000),
        headers: { cookie: s.cookie, 'content-type': 'application/octet-stream' },
      });
    const up = await upload();
    expect(up.statusCode).toBe(202);
    for (let i = 0; i < 100; i++) {
      const g = (await api(env, s).get(`/api/meetings/${m.id}/gaps`)).json().gaps[0];
      if (g.status !== 'recovering') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const g = (await api(env, s).get(`/api/meetings/${m.id}/gaps`)).json().gaps[0];
    expect(g.status).toBe('recovered');
    expect(g.recoveredMs).toBeGreaterThanOrEqual(gap.endMs! - gap.startMs - 500);
    const segs = (await api(env, s).get(`/api/meetings/${m.id}`)).json().segments as Array<{ source: string; startMs: number }>;
    const rec = segs.filter((x) => x.source === 'recovery');
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((x) => x.startMs >= gap.startMs && x.startMs <= gap.endMs!)).toBe(true);
    // Retrying the upload replaces the earlier untouched output instead of stacking a second copy of the same speech.
    const firstIds = new Set((rec as unknown as Array<{ id: string }>).map((x) => x.id));
    await upload();
    await new Promise((r) => setTimeout(r, 600));
    const again = ((await api(env, s).get(`/api/meetings/${m.id}`)).json().segments as Array<{ id: string; source: string; startMs: number; endMs: number }>)
      .filter((x) => x.source === 'recovery')
      .sort((a, b) => a.startMs - b.startMs);
    expect(again.some((x) => firstIds.has(x.id))).toBe(false);
    for (let i = 1; i < again.length; i++) expect(again[i]!.startMs).toBeGreaterThanOrEqual(again[i - 1]!.endMs - 1); // no overlapping duplicates
    const { rows } = await env.ctx.db.$client.query('select count(*)::int as n from recovery_chunk_metadata');
    expect(rows[0].n).toBe(2);
  }, 20_000);

  it('enforces one live session per account, but lets the same meeting take over its stale connection', async () => {
    const s = await register(env);
    const m1 = await demoMeeting(s);
    const m2 = await demoMeeting(s);
    const a = await Client.open(s.cookie);
    a.send({ type: 'hello', meetingId: m1.id, audioStartMs: 0, demo: true });
    await a.until('ready');
    const other = await Client.open(s.cookie);
    other.send({ type: 'hello', meetingId: m2.id, audioStartMs: 0, demo: true });
    await other.until('error', (e) => e.code === 'another_session');

    const takeover = await Client.open(s.cookie);
    takeover.send({ type: 'hello', meetingId: m1.id, audioStartMs: 0, demo: true });
    await takeover.until('ready');
    await a.until('error', (e) => e.code === 'replaced');
    takeover.send({ type: 'stop' });
    await takeover.until('stopped');
  });

  it("a user cannot attach to someone else's meeting, nor use demo mode on a real meeting", async () => {
    const alice = await register(env);
    const bob = await register(env);
    const m = await demoMeeting(alice);
    const c = await Client.open(bob.cookie);
    c.send({ type: 'hello', meetingId: m.id, audioStartMs: 0, demo: true });
    await c.until('error', (e) => e.code === 'not_found');
    const real = await createMeeting(env, alice);
    const d = await Client.open(alice.cookie);
    d.send({ type: 'hello', meetingId: real.id, audioStartMs: 0, demo: true });
    await d.until('error', (e) => e.code === 'demo_disabled');
  });

  it('real transcription without credentials fails clearly instead of silently using demo data', async () => {
    const s = await register(env);
    const real = await createMeeting(env, s);
    const c = await Client.open(s.cookie);
    c.send({ type: 'hello', meetingId: real.id, audioStartMs: 0 });
    const err = await c.until('error', (e) => e.code === 'asr_not_configured');
    expect(err.fatal).toBe(true);
    expect(err.message).toContain('DASHSCOPE_API_KEY');
  });

  it('page-reload resume: after a clean pause the saved transcript is intact and new capture continues the same timeline', async () => {
    const s = await register(env);
    const m = await demoMeeting(s);
    const a = await Client.open(s.cookie);
    a.send({ type: 'hello', meetingId: m.id, audioStartMs: 0, demo: true });
    await a.until('provider_state', (x) => x.state === 'ok');
    a.audio(0, 8_000);
    await a.until('final');
    a.send({ type: 'pause' });
    await a.until('paused');
    a.close();
    await new Promise((r) => setTimeout(r, 200));
    const before = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    // "Refresh": a brand-new socket starts at the saved high-water mark.
    const b = await Client.open(s.cookie);
    b.send({ type: 'hello', meetingId: m.id, audioStartMs: before.meeting.recordedMs, demo: true });
    const ready = await b.until('ready');
    expect(ready.gaps.filter((g) => g.status === 'open')).toHaveLength(0);
    b.audio(before.meeting.recordedMs, 6_000);
    b.send({ type: 'stop' });
    await b.until('stopped');
    const after = (await api(env, s).get(`/api/meetings/${m.id}`)).json();
    expect(after.segments.length).toBeGreaterThanOrEqual(before.segments.length);
    expect(after.segments.slice(0, before.segments.length).map((x: { id: string }) => x.id)).toEqual(before.segments.map((x: { id: string }) => x.id));
  });
});
