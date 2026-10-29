import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopRuntime } from '../../web/src/desktop/runtime';
import { CHANNEL } from '../src/policy';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn(), expose: vi.fn(), on: vi.fn(), captureStart: vi.fn(), captureStop: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, send: mocks.send, on: mocks.on } }));
vi.mock('../../web/src/audio/capture', () => ({ MicCapture: class { start = mocks.captureStart; stop = mocks.captureStop; } }));

let runtime: DesktopRuntime;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.captureStart.mockResolvedValue(undefined); mocks.captureStop.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async channel => channel === CHANNEL.start ? '01234567-89ab-cdef-0123-456789abcdef' : undefined);
  await import('../src/preload'); runtime = mocks.expose.mock.calls[0][1];
});
const callbacks = () => ({ onSegment: vi.fn(), onInterruption: vi.fn() });

describe('preload ownership contract (mock Electron unit test)', () => {
  it('rejects a second start while the native startup invocation is still pending', async () => {
    let ready!: (id: string) => void;
    mocks.invoke.mockReturnValueOnce(new Promise(resolve => { ready = resolve; }));
    const first = runtime.startTranscription(callbacks());
    await expect(runtime.startTranscription(callbacks())).rejects.toThrow('already');
    ready('01234567-89ab-cdef-0123-456789abcdef'); const session = await first;
    await session.stop(); expect(mocks.captureStart).toHaveBeenCalledOnce();
  });
  it('stops native inference even when capture cleanup fails, and permits a later retry', async () => {
    const session = await runtime.startTranscription(callbacks());
    mocks.captureStop.mockRejectedValueOnce(new Error('fixture cleanup failure'));
    await expect(session.stop()).rejects.toThrow('fixture cleanup');
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNEL.stop, '01234567-89ab-cdef-0123-456789abcdef');
    expect(mocks.send).toHaveBeenCalledWith(CHANNEL.diagnostic, 'cleanup_failure');
    const retry = await runtime.startTranscription(callbacks()); await retry.stop();
  });
});
