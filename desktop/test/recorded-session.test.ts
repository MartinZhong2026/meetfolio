import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecordedSession } from '../src/recorded-session';
import { WavRecording, listRecordings, recordingPath, recoverRecording } from '../src/wav-recording';
import { AsrError, type AsrConnection, type AsrHandlers, type AsrProvider } from '../../server/src/asr/types';

const directories: string[] = [];
const sessions: RecordedSession[] = [];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-recorded-'));
  directories.push(root);
  const connections: { handlers: AsrHandlers; audio: Buffer[]; close: ReturnType<typeof vi.fn>; connection: AsrConnection }[] = [];
  let connectGate: Promise<void> | null = null;
  let finishFinal = false;
  const provider: AsrProvider = { name: 'test-only', model: 'fixture', isDemo: false, async connect(_options, handlers) {
    const audio: Buffer[] = [];
    const close = vi.fn();
    const connection: AsrConnection = {
      sendAudio: pcm => { audio.push(Buffer.from(pcm)); },
      close,
      finish: async () => {
        if (finishFinal) handlers.onResult({ kind: 'final', key: 'tail', text: 'private fixture final', startMs: 0, endMs: 100 });
        handlers.onClosed({ clean: true });
        return true;
      },
    };
    connections.push({ handlers, audio, close, connection });
    if (connectGate) await connectGate;
    return connection;
  } };
  const callbacks = { final: vi.fn(), partial: vi.fn(), interrupted: vi.fn(), recovering: vi.fn(), diagnostic: vi.fn(), released: vi.fn() };
  const create = () => { const live = new RecordedSession(provider, callbacks); sessions.push(live); return live; };
  const live = create();
  return { root, live, callbacks, connections, create,
    holdConnect: (gate: Promise<void>) => { connectGate = gate; },
    finalOnFinish: () => { finishFinal = true; } };
}
afterEach(async () => {
  for (const session of sessions.splice(0)) { session.abort('fixture cleanup'); await session.stop().catch(() => {}); }
  vi.restoreAllMocks();
  for (const root of directories.splice(0)) {
    const absolute = path.resolve(root);
    if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('meetfolio-recorded-')) throw new Error('Unsafe test cleanup');
    await fs.rm(absolute, { recursive: true });
  }
});

describe('recorded native capture ownership (injected ASR, real temporary files)', () => {
  it('drains the native tail but persists an explicit capture failure as interrupted', async () => {
    const f = await fixture(); f.finalOnFinish(); await f.live.start(f.root, 'interview');
    f.live.send(new Uint8Array(3200).fill(9));
    await expect(f.live.stop(true)).rejects.toThrow('interrupted');
    expect(f.callbacks.final).toHaveBeenCalledOnce();
    expect(await listRecordings(f.root)).toMatchObject([{ bytes: 3200, status: 'interrupted', recoverable: false }]);
    expect(f.callbacks.released).toHaveBeenCalledOnce();
  });
  it('records each captured frame once while native recovery replays the unconfirmed suffix', async () => {
    const f = await fixture(); await f.live.start(f.root, 'interview');
    const first = new Uint8Array(3200).fill(1), second = new Uint8Array(3200).fill(2);
    f.live.send(first); f.live.send(second);
    f.connections[0].handlers.onResult({ kind: 'final', key: 'first', text: 'first fixture', startMs: 0, endMs: 100 });
    f.connections[0].handlers.onClosed({ clean: false, error: new AsrError('transient', 'local_asr_ipc', 'private fixture error') });
    await tick();
    expect(f.connections).toHaveLength(2);
    expect(f.connections[1].audio).toEqual([Buffer.from(second)]);
    f.connections[1].handlers.onResult({ kind: 'final', key: 'second', text: 'second fixture', startMs: 0, endMs: 100 });
    const stop = f.live.stop(); expect(f.live.stop()).toBe(stop); await stop;
    const wav = await fs.readFile(recordingPath(f.root, f.live.id));
    expect(wav.subarray(44)).toEqual(Buffer.concat([first, second]));
    expect(f.callbacks.final.mock.calls.map(call => call[0].audio)).toEqual([
      { recordingId: f.live.id, startMs: 0, endMs: 100 },
      { recordingId: f.live.id, startMs: 100, endMs: 200 },
    ]);
    expect(await listRecordings(f.root)).toMatchObject([{ bytes: 6400, durationMs: 200, status: 'complete' }]);
    expect(f.callbacks.released).toHaveBeenCalledOnce();
    expect(f.callbacks.diagnostic.mock.calls.flat()).not.toContain('private fixture error');
  });

  it('drains the final native result before release and resumes into a distinct WAV', async () => {
    const f = await fixture(); f.finalOnFinish(); await f.live.start(f.root, 'interview');
    f.live.send(new Uint8Array(3200).fill(4));
    f.callbacks.released.mockImplementation(() => expect(f.callbacks.final).toHaveBeenCalled());
    await f.live.stop();
    const resumed = f.create(); await resumed.start(f.root, 'interview');
    resumed.send(new Uint8Array(3200).fill(5)); await resumed.stop();
    expect(resumed.id).not.toBe(f.live.id);
    const recordings = await listRecordings(f.root, 'interview');
    expect(recordings).toHaveLength(2);
    expect(recordings.map(item => item.durationMs)).toEqual([100, 100]);
    expect((await fs.readFile(recordingPath(f.root, f.live.id))).subarray(44)).toEqual(Buffer.alloc(3200, 4));
    expect((await fs.readFile(recordingPath(f.root, resumed.id))).subarray(44)).toEqual(Buffer.alloc(3200, 5));
    expect(f.callbacks.final.mock.calls.map(call => call[0].audio.recordingId)).toEqual([f.live.id, resumed.id]);
  });

  it('finalizes an engine interruption as interrupted and preserves accepted audio', async () => {
    const f = await fixture(); await f.live.start(f.root, 'interview');
    f.live.send(new Uint8Array(3200).fill(6));
    f.connections[0].handlers.onClosed({ clean: false, error: new AsrError('fatal', 'local_asr_native', 'private fixture error') });
    await expect(f.live.stop()).rejects.toThrow();
    expect(f.callbacks.interrupted).toHaveBeenCalledOnce();
    expect(f.callbacks.released).toHaveBeenCalledOnce();
    expect(await listRecordings(f.root)).toMatchObject([{ status: 'interrupted', bytes: 3200, recoverable: false }]);
    expect((await fs.readFile(recordingPath(f.root, f.live.id))).subarray(44)).toEqual(Buffer.alloc(3200, 6));
    f.live.send(new Uint8Array(3200));
    expect(f.connections).toHaveLength(1);
  });

  it('cancels pending native initialization and closes the late connection without orphaning capture', async () => {
    const f = await fixture(), gate = deferred<void>(); f.holdConnect(gate.promise);
    const start = f.live.start(f.root, 'interview');
    const rejectedStart = expect(start).rejects.toThrow('interrupted');
    await vi.waitFor(() => expect(f.connections).toHaveLength(1));
    f.live.abort('fixture window reloaded');
    gate.resolve(); await rejectedStart;
    await expect(f.live.stop()).rejects.toThrow();
    expect(f.connections[0].close).toHaveBeenCalledOnce();
    expect(f.callbacks.released).toHaveBeenCalledOnce();
    expect(await listRecordings(f.root)).toMatchObject([{ status: 'interrupted', bytes: 0 }]);
  });

  it('cancels pending WAV creation before any native resource is opened', async () => {
    const f = await fixture(), gate = deferred<void>();
    const create = WavRecording.create.bind(WavRecording);
    vi.spyOn(WavRecording, 'create').mockImplementationOnce(async (...args) => { await gate.promise; return create(...args); });
    const start = f.live.start(f.root, 'interview');
    const rejectedStart = expect(start).rejects.toThrow('cancelled');
    f.live.abort('fixture window reloaded'); gate.resolve(); await rejectedStart;
    await expect(f.live.stop()).rejects.toThrow('cancelled');
    expect(f.connections).toHaveLength(0);
    expect(f.callbacks.released).toHaveBeenCalledOnce();
    expect(await listRecordings(f.root)).toMatchObject([{ status: 'interrupted', bytes: 0 }]);
  });

  it('stops native inference on disk failure and retains already written samples for explicit recovery', async () => {
    const f = await fixture(), open = vi.spyOn(fs, 'open');
    await f.live.start(f.root, 'interview');
    const index = open.mock.calls.findIndex(call => String(call[0]).endsWith('capture.part'));
    const handle = await open.mock.results[index].value;
    const write = vi.spyOn(handle, 'write');
    f.live.send(new Uint8Array(3200).fill(7));
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    // Confirm the first frame really reached disk before injecting the next write failure.
    await vi.waitFor(async () => expect((await fs.stat(path.join(f.root, f.live.id, 'capture.part'))).size).toBe(3244));
    write.mockRejectedValueOnce(new Error('private fixture ENOSPC path and transcript'));
    f.live.send(new Uint8Array(3200).fill(8));
    await vi.waitFor(() => expect(f.callbacks.interrupted).toHaveBeenCalledOnce());
    await expect(f.live.stop()).rejects.toThrow();
    expect(f.connections[0].close).toHaveBeenCalledOnce();
    expect(f.callbacks.released).toHaveBeenCalledOnce();
    expect(f.callbacks.diagnostic.mock.calls.flat().every(code => code === 'recording_write')).toBe(true);
    expect(f.callbacks.interrupted.mock.calls[0][0]).not.toContain('ENOSPC');
    expect(f.callbacks.interrupted.mock.calls[0][0]).not.toContain(f.root);
    expect(await recoverRecording(f.root, f.live.id)).toMatchObject({ bytes: 3200, status: 'interrupted' });
    expect((await fs.readFile(recordingPath(f.root, f.live.id))).subarray(44)).toEqual(Buffer.alloc(3200, 7));
  });
});
