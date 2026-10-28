import { describe, expect, it, vi } from 'vitest';
import { NativeSession } from '../src/native-session';
import { AsrError, type AsrProvider, type AsrHandlers } from '../../server/src/asr/types';
function fixture() {
  const connections: { handlers: AsrHandlers; audio: Buffer[] }[] = [];
  const provider: AsrProvider = { name: 'test-only', model: 'fixture', isDemo: false, async connect(_opts, handlers) {
    const data = { handlers, audio: [] as Buffer[] }; connections.push(data);
    return { sendAudio: pcm => data.audio.push(pcm), close: () => {}, finish: async () => { handlers.onClosed({ clean: true }); return true; } };
  } };
  const callbacks = { final: vi.fn(), partial: vi.fn(), interrupted: vi.fn(), recovering: vi.fn() };
  const live = new NativeSession(provider, callbacks);
  return { live, connections, callbacks };
}
describe('native session replay (injected provider, not model accuracy)', () => {
  it('persists finals, keeps partials ephemeral and acknowledges silent endpoints', async () => {
    const f = fixture(); await f.live.start(); f.live.send(new Uint8Array(3200));
    f.connections[0].handlers.onResult({ kind: 'interim', key: '0', text: 'partial', startMs: 0, endMs: null });
    expect(f.callbacks.final).not.toHaveBeenCalled();
    f.connections[0].handlers.onResult({ kind: 'final', key: '0', text: 'spoken fixture', startMs: 0, endMs: 100 });
    expect(f.callbacks.final.mock.calls[0][0]).toMatchObject({ originalText: 'spoken fixture', startMs: 0, endMs: 100, source: 'local' });
    await f.live.stop(); await f.live.stop(); expect(f.callbacks.interrupted).not.toHaveBeenCalled();
  });
  it('replays only unconfirmed audio, offsets timestamps and ignores obsolete native events', async () => {
    const f = fixture(); await f.live.start();
    f.live.send(new Uint8Array(3200)); f.live.send(new Uint8Array(3200).fill(1));
    f.connections[0].handlers.onResult({ kind: 'final', key: '0', text: 'first', startMs: 0, endMs: 100 });
    f.connections[0].handlers.onClosed({ clean: false, error: new AsrError('transient', 'crash', 'injected') });
    await new Promise(resolve => setImmediate(resolve));
    expect(f.connections).toHaveLength(2); expect(f.connections[1].audio).toHaveLength(1);
    expect(f.connections[1].audio[0][0]).toBe(1);
    f.connections[0].handlers.onResult({ kind: 'final', key: '1', text: 'stale duplicate', startMs: 100, endMs: 200 });
    f.connections[1].handlers.onResult({ kind: 'final', key: '0', text: 'second', startMs: 0, endMs: 100 });
    expect(f.callbacks.final.mock.calls.map(call => call[0].originalText)).toEqual(['first', 'second']);
    expect(f.callbacks.final.mock.calls[1][0]).toMatchObject({ startMs: 100, endMs: 200 });
    expect(f.callbacks.final.mock.calls[1][0].id).not.toBe(f.callbacks.final.mock.calls[0][0].id);
    await f.live.stop();
  });
  it('surfaces fatal errors and bounds unconfirmed audio instead of losing it silently', async () => {
    const f = fixture(); await f.live.start();
    for (let n = 0; n < 602; n++) f.live.send(new Uint8Array(3200));
    expect(f.callbacks.interrupted).toHaveBeenCalledOnce();
    await expect(f.live.stop()).rejects.toThrow('中断');
  });
});
