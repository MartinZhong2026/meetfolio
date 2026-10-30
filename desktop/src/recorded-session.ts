import type { AsrProvider } from '../../server/src/asr/types.js';
import { NativeSession, type LocalResult } from './native-session.js';
import { WavRecording } from './wav-recording.js';

interface Callbacks {
  final(result: LocalResult & { audio: { recordingId: string; startMs: number; endMs: number } }): void;
  partial(result: { key: string; text: string; startMs: number }): void;
  interrupted(reason: string): void;
  recovering(): void;
  diagnostic(code: string): void;
  released(): void;
}

/** One capture owns one WAV. Native replay never appends the same audio a second time. */
export class RecordedSession {
  private native: NativeSession;
  private wav: WavRecording | null = null;
  private startup: Promise<void> | null = null;
  private ending: Promise<void> | null = null;
  private interrupted = false;
  constructor(provider: AsrProvider, private callbacks: Callbacks) {
    this.native = new NativeSession(provider, {
      ...callbacks,
      final: segment => callbacks.final({ ...segment, audio: {
        recordingId: this.id, startMs: segment.startMs, endMs: segment.endMs,
      } }),
      interrupted: reason => {
        this.interrupted = true;
        callbacks.interrupted(reason);
        void this.stop().catch(() => {});
      },
    });
  }
  get id(): string { return this.native.id; }
  start(root: string, interviewId: string): Promise<void> {
    if (this.startup) throw new Error('Recording already started');
    this.startup = (async () => {
      this.wav = await WavRecording.create(root, this.id, interviewId, () => this.storageFailed());
      if (this.interrupted) throw new Error('Recording start cancelled');
      await this.native.start();
      if (this.interrupted) throw new Error('Recording start interrupted');
    })();
    return this.startup;
  }
  private storageFailed(): void {
    this.callbacks.diagnostic('recording_write');
    this.abort('Recording storage failed or is too slow. Capture stopped; saved audio may be incomplete. Recover and export it before continuing.');
  }
  send(pcm: Uint8Array): void {
    if (this.ending || this.interrupted || !this.wav) return;
    try { this.wav.enqueue(pcm); }
    catch { this.storageFailed(); return; }
    this.native.send(pcm);
  }
  abort(reason: string): void {
    this.interrupted = true;
    this.native.abort(reason);
    void this.stop().catch(() => {});
  }
  stop(interrupted = false): Promise<void> {
    this.interrupted ||= interrupted;
    if (this.ending) return this.ending;
    this.ending = (async () => {
      let failure: unknown;
      try { await this.startup; await this.native.stop(); }
      catch (error) { failure = error; this.interrupted = true; }
      try { await this.wav?.finish(this.interrupted ? 'interrupted' : 'complete'); }
      catch (error) { failure ??= error; this.callbacks.diagnostic('recording_write'); }
      finally { this.callbacks.released(); }
      if (failure || this.interrupted) throw failure ?? new Error('Recording interrupted; review saved audio and text');
    })();
    return this.ending;
  }
}
