import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WavRecording, recordingPath, header } from '../src/wav-recording';
import { RecordingPlayback } from '../src/playback';

const roots: string[] = [];
const players: RecordingPlayback[] = [];
async function fixture(interviewId = 'interview') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-playback-')); roots.push(root);
  const id = randomUUID(); const wav = await WavRecording.create(root, id, interviewId);
  const pcm = Buffer.alloc(32000);
  for (let n = 0; n < 16000; n++) pcm.writeInt16LE(n, n * 2);
  wav.enqueue(pcm); await wav.finish();
  const player = new RecordingPlayback(root); players.push(player);
  return { root, id, pcm, player, request: { interviewId, recordingId: id, startMs: 100.0625, endMs: 200.125 } };
}
afterEach(async () => {
  for (const player of players.splice(0)) await player.release();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('meetfolio-playback-')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true });
  }
});
const request = (url: string, range?: string, method = 'GET') => new Request(url, { method, headers: range ? { range } : {} });

describe('bounded native recording playback', () => {
  it('maps exact file-relative samples to a virtual WAV without modifying source evidence', async () => {
    const f = await fixture();
    const original = await fs.readFile(recordingPath(f.root, f.id));
    const prepared = await f.player.prepare(f.request);
    expect(prepared.durationMs).toBe(100.0625);
    const response = await f.player.respond(request(prepared.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    const pcm = f.pcm.subarray(1601 * 2, 3202 * 2);
    expect(bytes).toEqual(Buffer.concat([header(pcm.length), pcm]));
    expect(await fs.readFile(recordingPath(f.root, f.id))).toEqual(original);
  });
  it('serves header-spanning, PCM, open-ended and suffix byte ranges and rejects malformed ranges', async () => {
    const f = await fixture(); const prepared = await f.player.prepare(f.request);
    const expected = Buffer.concat([header(3202), f.pcm.subarray(3202, 6404)]);
    for (const [range, start, end] of [['bytes=40-49', 40, 49], ['bytes=44-45', 44, 45], ['bytes=3200-', 3200, 3245], ['bytes=-2', 3244, 3245]] as const) {
      const response = await f.player.respond(request(prepared.url, range));
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/3246`);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(expected.subarray(start, end + 1));
    }
    for (const range of ['bytes=3246-', 'bytes=3-2', 'bytes=-0', 'bytes=0-1,4-6', 'bytes=9007199254740992-', 'items=0-1']) {
      expect((await f.player.respond(request(prepared.url, range))).status).toBe(416);
    }
    const head = await f.player.respond(request(prepared.url, undefined, 'HEAD'));
    expect(head.headers.get('content-length')).toBe('3246'); expect(await head.text()).toBe('');
    expect((await f.player.respond(request(prepared.url, undefined, 'POST'))).status).toBe(405);
  });
  it('rejects cross-interview IDs, arbitrary paths, zero/invalid timestamps and time beyond saved samples', async () => {
    const f = await fixture();
    for (const patch of [{ interviewId: 'other' }, { recordingId: '../private' }, { interviewId: '../interview' },
      { startMs: -1 }, { startMs: NaN }, { endMs: Infinity }, { endMs: 100.0625 }, { endMs: 1001 }]) {
      await expect(f.player.prepare({ ...f.request, ...patch })).rejects.toThrow();
    }
    const p = await f.player.prepare(f.request);
    for (const url of [p.url.replace(p.token, randomUUID()), `${p.url}?path=../secret`, p.url.replace('://app', '://other')]) {
      expect((await f.player.respond(request(url))).status).not.toBe(200);
    }
  });
  it('refuses missing, truncated, corrupt and linked WAVs and unfinalized captures', async () => {
    for (const kind of ['missing', 'truncated', 'corrupt', 'linked', 'partial']) {
      const f = await fixture(); const file = recordingPath(f.root, f.id);
      if (kind === 'missing' || kind === 'partial') await fs.rename(file, path.join(f.root, f.id, 'capture.part'));
      if (kind === 'truncated') await fs.truncate(file, 100);
      if (kind === 'corrupt') await fs.writeFile(file, Buffer.alloc(100));
      if (kind === 'linked') {
        // Directory junctions work on Windows without requiring symlink privileges.
        const link = path.join(f.root, randomUUID()); await fs.symlink(path.join(f.root, f.id), link, process.platform === 'win32' ? 'junction' : 'dir');
        await expect(f.player.prepare({ ...f.request, recordingId: path.basename(link) })).rejects.toThrow(); continue;
      }
      await expect(f.player.prepare(f.request)).rejects.toThrow();
    }
  });
  it('invalidates old tokens and in-flight streams, ignores stale cleanup, and latest rapid selection wins', async () => {
    const f = await fixture(); const old = await f.player.prepare(f.request);
    const response = await f.player.respond(request(old.url));
    const replacement = await f.player.prepare({ ...f.request, startMs: 0, endMs: 500 });
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect((await f.player.respond(request(old.url))).status).toBe(404);
    await f.player.release(old.token);
    expect((await f.player.respond(request(replacement.url, undefined, 'HEAD'))).status).toBe(200);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.player.prepare(f.request)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await f.player.release();
    const last = results.at(-1)!; expect(last.status).toBe('fulfilled');
    if (last.status === 'fulfilled') expect((await f.player.respond(request(last.value.url))).status).toBe(404);
  });
  it('reads a long sparse recording in bounded chunks and releases its file on stop', async () => {
    const f = await fixture(); const file = recordingPath(f.root, f.id); const size = 1024 * 1024 * 1024;
    const disk = await fs.open(file, 'r+');
    try { await disk.truncate(44 + size); await disk.write(header(size), 0, 44, 0); }
    finally { await disk.close(); }
    await fs.writeFile(path.join(f.root, f.id, 'final.json'), JSON.stringify({ status: 'complete', bytes: size }));
    const open = vi.spyOn(fs, 'open');
    const prepared = await f.player.prepare({ ...f.request, startMs: 0, endMs: size / 32 });
    const index = open.mock.calls.findIndex(call => String(call[0]) === file);
    const handle = await open.mock.results[index].value;
    const read = vi.spyOn(handle, 'read'), close = vi.spyOn(handle, 'close');
    const response = await f.player.respond(request(prepared.url, 'bytes=44-1000000'));
    const reader = response.body!.getReader();
    const first = await reader.read(); expect(first.value!.length).toBeLessThanOrEqual(65536);
    await reader.cancel();
    expect(read.mock.calls.every(call => Number(call[2]) <= 65536)).toBe(true);
    await f.player.release(prepared.token); expect(close).toHaveBeenCalledOnce();
  });
  it('detects files changed after preparation and cancels aborted request bodies', async () => {
    const f = await fixture(); const prepared = await f.player.prepare(f.request);
    const abort = new AbortController();
    const response = await f.player.respond(new Request(prepared.url, { signal: abort.signal }));
    abort.abort(); await expect(response.arrayBuffer()).rejects.toThrow();
    await fs.truncate(recordingPath(f.root, f.id), 44);
    expect((await f.player.respond(request(prepared.url))).status).toBe(410);
  });
  it('host lifecycle release cancels queued preparations before they can publish a capability', async () => {
    const f = await fixture();
    const preparing = f.player.prepare(f.request);
    const result = Promise.allSettled([preparing]);
    await f.player.release();
    expect((await result)[0].status).toBe('rejected');
    const next = await f.player.prepare(f.request);
    expect((await f.player.respond(request(next.url, undefined, 'HEAD'))).status).toBe(200);
  });
});
