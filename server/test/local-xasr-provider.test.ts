import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalXAsrProvider } from '../src/asr/localXasr.js';
import { XASR } from '../src/asr/localXasrModel.js';

vi.mock('node:child_process', () => ({ fork: vi.fn() }));
vi.mock('node:fs', async original => ({ ...(await original<typeof import('node:fs')>()), existsSync: () => true }));

class Worker extends EventEmitter {
  stderr = { resume: vi.fn() };
  send = vi.fn((_message: unknown, callback?: (error: Error | null) => void) => { callback?.(null); return true; });
  kill = vi.fn(() => { queueMicrotask(() => this.emit('close', 0)); return true; });
}
let directory: string;
let worker: Worker;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-native-provider-'));
  for (const name of Object.values(XASR.files)) await fs.writeFile(path.join(directory, name), 'fixture, not ONNX');
  worker = new Worker(); vi.mocked(fork).mockReturnValue(worker as never);
});
afterEach(async () => { vi.useRealTimers(); await fs.rm(directory, { recursive: true }); });
const handlers = () => ({ onResult: vi.fn(), onClosed: vi.fn() });

describe('native process protocol with simulated child (not actual inference)', () => {
  it('bounds startup time and queue size without retaining a worker', async () => {
    vi.useFakeTimers();
    const provider = new LocalXAsrProvider(directory);
    const pending = provider.connect({ sampleRate: 16000, terms: [], languageHints: [] }, handlers());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'local_asr_load_timeout' });
    await vi.advanceTimersByTimeAsync(60001); await rejected;
    expect(worker.kill).toHaveBeenCalledOnce();
    worker = new Worker(); vi.mocked(fork).mockReturnValue(worker as never);
    const callbacks = handlers();
    const next = provider.connect({ sampleRate: 16000, terms: [], languageHints: [] }, callbacks);
    worker.emit('message', { type: 'ready' }); const connection = await next;
    connection.sendAudio(Buffer.alloc(16000 * 2 * 30 + 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onClosed).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'local_asr_overloaded' }) }));
  });
  it('reports native module initialization errors with fixed codes and never forwards native detail strings', async () => {
    const pending = new LocalXAsrProvider(directory).connect({ sampleRate: 16000, terms: [], languageHints: [] }, handlers());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'local_asr_native_missing' });
    worker.emit('message', { type: 'error', code: 'local_asr_native_missing', message: 'secret fixture text / private path' });
    await rejected; expect(worker.kill).toHaveBeenCalledOnce();
  });
  it('rejects wrong rate before spawning and aborts a session after readiness', async () => {
    const provider = new LocalXAsrProvider(directory);
    await expect(provider.connect({ sampleRate: 48000, terms: [], languageHints: [] }, handlers())).rejects.toMatchObject({ code: 'local_sample_rate' });
    const controller = new AbortController(), callbacks = handlers();
    const pending = provider.connect({ sampleRate: 16000, terms: [], languageHints: [] }, callbacks, controller.signal);
    worker.emit('message', { type: 'ready' }); await pending; controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    expect(callbacks.onClosed).toHaveBeenCalledWith(expect.objectContaining({ clean: false }));
    expect(worker.kill).toHaveBeenCalledOnce();
  });
  it('fails an unacknowledged small backlog and releases the worker', async () => {
    vi.useFakeTimers(); const callbacks = handlers();
    const pending = new LocalXAsrProvider(directory).connect({ sampleRate: 16000, terms: [], languageHints: [] }, callbacks);
    worker.emit('message', { type: 'ready' }); const connection = await pending;
    connection.sendAudio(Buffer.alloc(3200));
    await vi.advanceTimersByTimeAsync(16001);
    expect(callbacks.onClosed).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'local_asr_ack_timeout' }) }));
    expect(worker.kill).toHaveBeenCalledOnce(); expect(await connection.finish()).toBe(false);
  });
  it('handles final flush acknowledgements and odd PCM without leaving a live worker', async () => {
    const callbacks = handlers();
    const pending = new LocalXAsrProvider(directory).connect({ sampleRate: 16000, terms: [], languageHints: [] }, callbacks);
    worker.emit('message', { type: 'ready' }); const connection = await pending;
    const finished = connection.finish(); worker.emit('message', { type: 'finished' });
    expect(await finished).toBe(true); connection.close(); expect(worker.kill).toHaveBeenCalledOnce();
    worker = new Worker(); vi.mocked(fork).mockReturnValue(worker as never);
    const second = new LocalXAsrProvider(directory).connect({ sampleRate: 16000, terms: [], languageHints: [] }, callbacks);
    worker.emit('message', { type: 'ready' }); (await second).sendAudio(Buffer.alloc(3));
    await new Promise(resolve => setImmediate(resolve));
    expect(callbacks.onClosed).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'local_pcm_alignment' }) }));
  });
});
