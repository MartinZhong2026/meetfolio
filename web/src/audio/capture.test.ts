import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicCapture } from './capture';

class Track extends EventTarget { stop = vi.fn(); }
const track = new Track();
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const disconnect = vi.fn();
const close = vi.fn(async () => {});
const addModule = vi.fn(async () => {});
const portClose = vi.fn();
const getUserMedia = vi.fn(async () => stream);
let node: { port: { onmessage?: (event: unknown) => void; postMessage: ReturnType<typeof vi.fn>; close: typeof portClose }; onprocessorerror?: () => void };
const graph = { disconnect, connect: () => graph };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  getUserMedia.mockResolvedValue(stream);
  addModule.mockResolvedValue(undefined);
  vi.stubGlobal('AudioContext', class {
    state = 'running'; audioWorklet = { addModule }; destination = {};
    createMediaStreamSource = () => graph;
    createGain = () => ({ ...graph, gain: { value: 1 } });
    addEventListener() {} close = close;
  });
  vi.stubGlobal('AudioWorkletNode', class {
    port = { onmessage: undefined as ((event: unknown) => void) | undefined,
      close: portClose, postMessage: vi.fn(() => queueMicrotask(() => this.port.onmessage?.({ data: { flushed: true } }))) };
    connect = () => graph; disconnect = disconnect;
    constructor() { node = this; }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('real capture lifecycle with simulated media devices', () => {
  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError'])('classifies %s and allows retry', async name => {
    getUserMedia.mockRejectedValueOnce(new DOMException('fixture', name));
    const capture = new MicCapture();
    await expect(capture.start(vi.fn(), vi.fn())).rejects.toHaveProperty('kind',
      name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'no_device' : 'busy');
    await capture.start(vi.fn(), vi.fn()); await capture.stop();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('releases tracks/context when worklet initialization fails', async () => {
    addModule.mockRejectedValueOnce(new Error('worklet load failure'));
    await expect(new MicCapture().start(vi.fn(), vi.fn())).rejects.toThrow('worklet load');
    expect(track.stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it('rejects concurrent starts and stops a late permission result after cancellation', async () => {
    let allow!: (value: typeof stream) => void;
    getUserMedia.mockReturnValueOnce(new Promise(resolve => { allow = resolve; }));
    const capture = new MicCapture(); const pending = capture.start(vi.fn(), vi.fn());
    await expect(capture.start(vi.fn(), vi.fn())).rejects.toThrow('already');
    await capture.stop(); allow(stream);
    await expect(pending).rejects.toThrow('cancelled'); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('notifies a device/processor failure once, validates frames and releases resources idempotently', async () => {
    const frame = vi.fn(), ended = vi.fn(); const capture = new MicCapture();
    await capture.start(frame, ended);
    node.port.onmessage?.({ data: { pcm: new ArrayBuffer(3200), rms: 0.2 } });
    node.port.onmessage?.({ data: { pcm: new ArrayBuffer(3), rms: NaN } });
    expect(frame).toHaveBeenCalledOnce();
    track.dispatchEvent(new Event('ended')); node.onprocessorerror?.();
    expect(ended).toHaveBeenCalledOnce();
    await Promise.all([capture.stop(), capture.stop()]);
    expect(track.stop).toHaveBeenCalledOnce(); expect(portClose).toHaveBeenCalledOnce();
    await capture.start(frame, ended); await capture.stop();
    expect(track.stop).toHaveBeenCalledTimes(2);
  });
  it('still closes all resources when flushing fails', async () => {
    const capture = new MicCapture(); await capture.start(vi.fn(), vi.fn());
    node.port.postMessage.mockImplementation(() => { throw new Error('port closed'); });
    await expect(capture.stop()).rejects.toThrow('port closed');
    expect(track.stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
});
