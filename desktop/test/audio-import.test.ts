import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AudioImports, validImport } from '../src/audio-import';
import { listRecordings, recordingPath } from '../src/wav-recording';
import { atomicJson } from '../src/import-checkpoint';
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-import-test-')); folders.push(root);
  const manager = new AudioImports(root, 'missing-worker.cjs', root, async () => { throw new Error('model fixture unavailable'); }, async () => { throw new Error('speaker fixture unavailable'); }, vi.fn());
  return { root, manager };
}
const options = { interviewId: 'test-interview', consent: true as const, diarize: false, numSpeakers: -1 };
describe('durable local audio import boundary', () => {
  it('resumes a validated checkpoint using its owned WAV and retains the same recording identity', async () => {
    const { manager, root } = await fixture(); const id = await manager.begin(options);
    await manager.append({ id, pcm: new Uint8Array(32000) });
    await expect(manager.finish(id)).rejects.toThrow('model fixture');
    await atomicJson(path.join(root, id, 'import-checkpoint.json'), { schema: 1, samples: 16000, completedSamples: 0, diarize: false, numSpeakers: -1, voices: [], segments: [] });
    expect(await manager.status(options.interviewId)).toMatchObject([{ recordingId: id, complete: false, durationMs: 1000, completedMs: 0 }]);
    await expect(manager.resume({ interviewId: 'other', recordingId: id })).rejects.toThrow('another interview');
    expect(await manager.resume({ interviewId: options.interviewId, recordingId: id })).toBe(id);
    await expect(manager.finish(id)).rejects.toThrow('model fixture');
    expect(manager.busy).toBe(false); expect((await listRecordings(root))[0].bytes).toBe(32000);
    expect(await manager.recover({ interviewId: options.interviewId, recordingId: id })).toEqual([]);
  });
  it('requires consent, bounded speaker count and a valid interview identity', () => {
    expect(validImport(options)).toBe(true);
    for (const change of [{ consent: false }, { interviewId: '../unsafe' }, { numSpeakers: 0 }, { numSpeakers: 13 }, { numSpeakers: 1.5 }, { diarize: 'yes' }]) expect(validImport({ ...options, ...change })).toBe(false);
  });
  it('serializes imports, rejects unowned frames and preserves cancelled audio as interrupted', async () => {
    const { manager, root } = await fixture(); const id = await manager.begin(options);
    await expect(manager.begin(options)).rejects.toThrow();
    await expect(manager.append({ id: '11111111-1111-1111-1111-111111111111', pcm: new Uint8Array(32000) })).rejects.toThrow();
    await manager.append({ id, pcm: new Uint8Array(32000).fill(1) });
    await expect(manager.cancel('11111111-1111-1111-1111-111111111111')).rejects.toThrow();
    await manager.cancel(id);
    const records = await listRecordings(root); expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id, interviewId: options.interviewId, status: 'interrupted', bytes: 32000, durationMs: 1000 });
    expect((await fs.readFile(recordingPath(root, id))).subarray(44)).toEqual(Buffer.alloc(32000, 1));
    expect(manager.busy).toBe(false);
  });
  it('keeps a finalized, playable WAV when the model fails and releases the import lock', async () => {
    const { manager, root } = await fixture(); const id = await manager.begin(options);
    await manager.append({ id, pcm: new Uint8Array(32000) });
    await expect(manager.finish(id)).rejects.toThrow('model fixture');
    expect(manager.busy).toBe(false);
    expect((await listRecordings(root))[0]).toMatchObject({ status: 'complete', bytes: 32000 });
    await expect(manager.recover({ interviewId: 'other', recordingId: id })).rejects.toThrow('another interview');
    const next = await manager.begin(options); expect(next).not.toBe(id); await manager.cancel(next);
  });
  it('rejects empty, odd and oversized PCM frames without corrupting existing audio', async () => {
    const { manager } = await fixture(); const id = await manager.begin(options);
    for (const size of [0, 3, 32002]) await expect(manager.append({ id, pcm: new Uint8Array(size) })).rejects.toThrow('Invalid import frame');
    await expect(manager.finish(id)).rejects.toThrow('empty'); await manager.cancel(id);
  });
  it('cancels during asynchronous WAV creation without leaking an active recording', async () => {
    const { manager, root } = await fixture(); const starting = manager.begin(options);
    const [started, stopped] = await Promise.allSettled([starting, manager.cancel()]);
    expect(started.status).toBe('rejected'); expect(stopped.status).toBe('fulfilled');
    expect(manager.busy).toBe(false);
    expect((await listRecordings(root))[0].status).toBe('interrupted');
  });
  it('rejects corrupt saved transcript fields and foreign audio references before returning recovery data', async () => {
    const { manager, root } = await fixture(); const id = await manager.begin(options);
    await manager.append({ id, pcm: new Uint8Array(32000) });
    await expect(manager.finish(id)).rejects.toThrow('model fixture');
    const segment = { id: '11111111-1111-1111-1111-111111111111', seq: 1, originalText: 'Fixture', editedText: null, speakerLabel: 'Speaker 1', isImportant: false, source: 'local', updatedAt: '2026-10-31T00:00:00Z', startMs: 0, endMs: 1000, audio: { recordingId: id, startMs: 0, endMs: 1000 } };
    const file = path.join(root, id, 'import-transcript.json');
    const save = async (s: unknown) => fs.writeFile(file, JSON.stringify({ schema: 1, interviewId: options.interviewId, segments: [s] }));
    await save(segment); expect(await manager.recover({ interviewId: options.interviewId, recordingId: id })).toEqual([segment]);
    for (const corrupt of [{ ...segment, originalText: null }, { ...segment, endMs: 2000 }, { ...segment, audio: { ...segment.audio, recordingId: 'foreign' } }]) {
      await save(corrupt); await expect(manager.recover({ interviewId: options.interviewId, recordingId: id })).rejects.toThrow('Invalid saved transcript');
    }
    expect((await listRecordings(root))[0].bytes).toBe(32000);
  });
});
