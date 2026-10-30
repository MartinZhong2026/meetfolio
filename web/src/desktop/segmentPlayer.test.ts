import { describe, expect, it, vi } from 'vitest';
import { SegmentPlayer, type PlaybackState } from './segmentPlayer';
import { syntheticInterview } from './fixtures';
import type { DesktopRuntime } from './runtime';

function fixture() {
  const states: PlaybackState[] = [];
  const media: ReturnType<typeof fakeMedia>[] = [];
  const runtime = { preparePlayback: vi.fn(async () => prepared('first')), releasePlayback: vi.fn(async () => {}) };
  const player = new SegmentPlayer(runtime as unknown as DesktopRuntime, 'interview', state => states.push(state), () => {
    const audio = fakeMedia(); media.push(audio); return audio as unknown as HTMLAudioElement;
  });
  const segment = { ...syntheticInterview().segments[0], audio: { recordingId: '01234567-89ab-cdef-0123-456789abcdef', startMs: 100, endMs: 1100 } };
  return { player, segment, states, media, runtime, state: () => states.at(-1)! };
}
const prepared = (token: string) => ({ token, url: `meetfolio://app/recording-playback/${token}`, durationMs: 1000 });
function fakeMedia() {
  const audio = {
    src: '', preload: '', currentTime: 0, ended: false,
    onplaying: null as (() => void) | null, onpause: null as (() => void) | null,
    onended: null as (() => void) | null, onerror: null as (() => void) | null,
    ontimeupdate: null as (() => void) | null, onwaiting: null as (() => void) | null,
    play: vi.fn(async () => { audio.onplaying?.(); }),
    pause: vi.fn(() => audio.onpause?.()), removeAttribute: vi.fn(), load: vi.fn(),
  };
  return audio;
}
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe('segment playback lifecycle', () => {
  it('uses file time rather than interview clock, pauses, resumes, reports progress and releases on end', async () => {
    const f = fixture(); await f.player.play(f.segment);
    expect(f.runtime.preparePlayback).toHaveBeenCalledWith({ interviewId: 'interview', ...f.segment.audio });
    expect(f.state().status).toBe('playing');
    const audio = f.media[0]; audio.currentTime = 0.25; audio.ontimeupdate?.();
    expect(f.state().positionMs).toBe(250);
    f.player.pause(); expect(f.state().status).toBe('paused');
    await f.player.resume(); expect(f.state().status).toBe('playing');
    audio.onended?.(); expect(f.state()).toMatchObject({ status: 'ended', positionMs: 1000 });
    expect(f.runtime.releasePlayback).toHaveBeenCalledWith('first'); expect(audio.load).toHaveBeenCalledOnce();
  });
  it('latest selection wins over a delayed prepare and stale media events cannot overwrite it', async () => {
    const f = fixture(); const pending = deferred<ReturnType<typeof prepared>>();
    f.runtime.preparePlayback.mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(prepared('second'));
    const first = f.player.play(f.segment);
    const secondSegment = { ...f.segment, id: 'second', seq: 2, audio: { ...f.segment.audio, recordingId: '11234567-89ab-cdef-0123-456789abcdef' } };
    await f.player.play(secondSegment);
    pending.resolve(prepared('obsolete')); await first;
    expect(f.state()).toMatchObject({ segmentId: 'second', status: 'playing' });
    expect(f.runtime.releasePlayback).toHaveBeenCalledWith('obsolete');
    const oldEvent = f.media[0].onended;
    f.runtime.preparePlayback.mockResolvedValueOnce(prepared('third')); await f.player.play(f.segment);
    oldEvent?.(); expect(f.state()).toMatchObject({ segmentId: f.segment.id, status: 'playing' });
    expect(f.media[0].pause).toHaveBeenCalled(); expect(f.runtime.releasePlayback).toHaveBeenCalledWith('second');
  });
  it('stop and unmount during loading release late capabilities without starting audio', async () => {
    for (const dispose of [false, true]) {
      const f = fixture(); const pending = deferred<ReturnType<typeof prepared>>();
      f.runtime.preparePlayback.mockImplementationOnce(() => pending.promise);
      const loading = f.player.play(f.segment);
      if (dispose) f.player.dispose(); else f.player.stop();
      const before = f.states.length; pending.resolve(prepared('late')); await loading;
      expect(f.states.length).toBe(before); expect(f.media).toHaveLength(0);
      expect(f.runtime.releasePlayback).toHaveBeenCalledWith('late');
    }
  });
  it('keeps original evidence unchanged after edits and handles unavailable files and decode errors', async () => {
    const f = fixture(); const original = structuredClone(f.segment);
    const edited = { ...f.segment, editedText: 'Corrected text' };
    await f.player.play(edited); f.media[0].onerror?.();
    expect(f.state().status).toBe('error'); expect(f.state().message).toContain('saved WAV');
    expect(f.segment).toEqual(original); expect(edited.audio).toEqual(original.audio);
    f.runtime.preparePlayback.mockRejectedValueOnce(new Error('private/path must never reach UI'));
    await f.player.play(edited); expect(f.state().message).not.toContain('private/path');
    expect(f.state().status).toBe('error');
  });
  it('shows an actionable resume state when autoplay is denied, and leaves legacy text usable', async () => {
    const f = fixture();
    await f.player.play(f.segment);
    f.media[0].play.mockRejectedValueOnce(new Error('NotAllowedError'));
    await f.player.resume(); expect(f.state()).toMatchObject({ status: 'paused' }); expect(f.state().message).toContain('Resume');
    const legacy = { ...f.segment, audio: undefined }; await f.player.play(legacy);
    expect(f.state().status).toBe('error'); expect(f.runtime.preparePlayback).toHaveBeenCalledTimes(1);
  });
});
