import type { Segment } from '../lib/types';
import type { DesktopRuntime } from './runtime';

export interface PlaybackState {
  segmentId: string | null;
  seq: number;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  positionMs: number;
  durationMs: number;
  message: string;
}
const unavailable = 'Audio unavailable. Check the saved WAV, recover interrupted recordings in Local storage & backup info, and verify this interview owns the recording. JSON backups do not include audio.';
const initial: PlaybackState = { segmentId: null, seq: 0, status: 'idle', positionMs: 0, durationMs: 0, message: '' };

/** UI lifecycle owns one media element and one native capability; obsolete async results are released. */
export class SegmentPlayer {
  private generation = 0;
  private media: HTMLAudioElement | null = null;
  private token: string | null = null;
  private disposed = false;
  private value = initial;
  constructor(private runtime: DesktopRuntime | null, private interviewId: string,
    private changed: (state: PlaybackState) => void, private createMedia = () => new Audio()) {}
  private update(patch: Partial<PlaybackState>): void {
    this.value = { ...this.value, ...patch };
    if (!this.disposed) this.changed(this.value);
  }
  private cleanup(): void {
    if (this.media) {
      const audio = this.media; this.media = null;
      audio.onplaying = audio.onpause = audio.onended = audio.onerror = audio.ontimeupdate = audio.onwaiting = null;
      audio.pause(); audio.removeAttribute('src'); audio.load();
    }
    if (this.token) { const token = this.token; this.token = null; void this.runtime?.releasePlayback?.(token).catch(() => {}); }
  }
  async play(segment: Segment): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.cleanup();
    this.update({ segmentId: segment.id, seq: segment.seq, status: 'loading', positionMs: 0, durationMs: 0, message: '' });
    if (!segment.audio || !this.runtime?.preparePlayback || !this.runtime.releasePlayback) {
      this.update({ status: 'error', message: 'Audio playback requires the native desktop app and a linked local recording.' }); return;
    }
    try {
      const prepared = await this.runtime.preparePlayback({ interviewId: this.interviewId, ...segment.audio });
      if (generation !== this.generation || this.disposed) { await this.runtime.releasePlayback(prepared.token); return; }
      this.token = prepared.token;
      if (prepared.url !== `meetfolio://app/recording-playback/${prepared.token}` ||
          !Number.isFinite(prepared.durationMs) || prepared.durationMs <= 0) throw new Error('Invalid media capability');
      const audio = this.createMedia(); this.media = audio;
      this.update({ durationMs: prepared.durationMs });
      const current = () => generation === this.generation && this.media === audio && !this.disposed;
      audio.onplaying = () => { if (current()) this.update({ status: 'playing', message: '' }); };
      audio.onpause = () => { if (current() && !audio.ended) this.update({ status: 'paused' }); };
      audio.onwaiting = () => { if (current()) this.update({ message: 'Buffering local audio…' }); };
      audio.ontimeupdate = () => { if (current()) this.update({ positionMs: Math.min(prepared.durationMs, Math.max(0, audio.currentTime * 1000)) }); };
      audio.onended = () => { if (current()) { this.cleanup(); this.update({ status: 'ended', positionMs: prepared.durationMs, message: '' }); } };
      audio.onerror = () => { if (current()) { this.cleanup(); this.update({ status: 'error', message: unavailable }); } };
      audio.preload = 'metadata'; audio.src = prepared.url;
      await this.resume();
    } catch { if (generation === this.generation && !this.disposed) { this.cleanup(); this.update({ status: 'error', message: unavailable }); } }
  }
  pause(): void { this.media?.pause(); }
  async resume(): Promise<void> {
    const audio = this.media;
    if (!audio) return;
    try { await audio.play(); }
    catch { if (this.media === audio && !this.disposed) this.update({ status: 'paused', message: 'Playback could not start. Press Resume, or replay this segment.' }); }
  }
  stop(): void { ++this.generation; this.cleanup(); this.update({ ...initial }); }
  dispose(): void { this.disposed = true; ++this.generation; this.cleanup(); }
}

export const initialPlaybackState = initial;
