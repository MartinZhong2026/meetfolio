import { beforeEach, describe, expect, it } from 'vitest';
import { __resetAudioDb, MeetingAudioBuffer, sweepOldAudio } from './chunkStore';

/** 100 ms frame whose samples all equal `marker` (so content can be verified after round-trips). */
const frame = (marker: number) => new Int16Array(1600).fill(marker);

async function fill(buf: MeetingAudioBuffer, fromMs: number, toMs: number) {
  for (let t = fromMs; t < toMs; t += 100) buf.append(t, frame(Math.floor(t / 100) % 30000));
  await buf.flush();
}

beforeEach(async () => {
  await __resetAudioDb();
});

describe('MeetingAudioBuffer (IndexedDB)', () => {
  it('stores frames and reads back exactly the requested contiguous range with correct content', async () => {
    const b = new MeetingAudioBuffer('m1');
    await fill(b, 0, 10_000);
    const r = (await b.read(3_000, 5_000))!;
    expect(r.fromMs).toBe(3_000);
    expect(r.coveredMs).toBe(2_000);
    const pcm = new Int16Array(r.pcm);
    expect(pcm.length).toBe(32_000);
    expect(pcm[0]).toBe(30); // frame at 3000 ms
    expect(pcm[1600]).toBe(31);
    expect(pcm[pcm.length - 1]).toBe(49);
  });

  it('survives a "page reload": a fresh instance still reads what the previous one wrote', async () => {
    const a = new MeetingAudioBuffer('m1');
    await fill(a, 0, 6_000);
    const b = new MeetingAudioBuffer('m1');
    expect(await b.latestEnd()).toBe(6_000);
    const r = (await b.read(0, 6_000))!;
    expect(r.coveredMs).toBe(6_000);
  });

  it('does not bridge holes: returns only the contiguous run that starts the range', async () => {
    const b = new MeetingAudioBuffer('m1');
    await fill(b, 0, 4_000);
    await fill(b, 8_000, 12_000); // 4 s hole (e.g. while paused)
    const r = (await b.read(2_000, 12_000))!;
    expect(r.fromMs).toBe(2_000);
    expect(r.coveredMs).toBe(2_000); // stops at the hole instead of fabricating audio
    const later = (await b.read(8_000, 12_000))!;
    expect(later.coveredMs).toBe(4_000);
    expect(await b.read(5_000, 7_000)).toBeNull(); // inside the hole: nothing
  });

  it('is bounded: oldest audio is evicted beyond the per-meeting cap', async () => {
    const b = new MeetingAudioBuffer('m1', { maxMs: 10_000, chunkMs: 2000 });
    await fill(b, 0, 30_000);
    expect(await b.usageMs()).toBeLessThanOrEqual(10_000);
    expect(await b.read(0, 5_000)).toBeNull();
    const newest = (await b.read(20_000, 30_000))!;
    expect(newest.coveredMs).toBeGreaterThanOrEqual(8_000);
  });

  it('isolates meetings and prunes confirmed audio', async () => {
    const a = new MeetingAudioBuffer('a');
    const b = new MeetingAudioBuffer('b');
    await fill(a, 0, 6_000);
    await fill(b, 0, 6_000);
    await a.pruneBefore(4_000);
    expect(await a.read(0, 3_000)).toBeNull();
    expect((await a.read(4_000, 6_000))!.coveredMs).toBe(2_000);
    expect((await b.read(0, 6_000))!.coveredMs).toBe(6_000); // untouched
    await b.clear();
    expect(await b.read(0, 6_000)).toBeNull();
  });

  it('sweeps audio older than the retention period', async () => {
    const b = new MeetingAudioBuffer('old');
    await fill(b, 0, 4_000);
    await sweepOldAudio(-1000); // everything counts as older than "now + 1s"
    expect(await new MeetingAudioBuffer('old').read(0, 4_000)).toBeNull();
  });

  it('reports storage failure once and keeps accepting frames without throwing', async () => {
    const errors: Error[] = [];
    const b = new MeetingAudioBuffer('m', { onError: (e) => errors.push(e) });
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      await fill(b, 0, 5_000);
      b.append(5_000, frame(1)); // must not throw
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
    expect(errors).toHaveLength(1);
    expect(b.available).toBe(false);
  });
});
