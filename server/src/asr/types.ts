/**
 * Provider-neutral realtime ASR contracts. The pipeline only knows these types; each DashScope
 * protocol lives in its own adapter so a different model/protocol can be swapped in via config.
 */

/** 16 kHz, mono, 16-bit little-endian PCM. */
export const SAMPLE_RATE = 16_000;
export const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 32
export const msToBytes = (ms: number) => Math.round(ms * BYTES_PER_MS) & ~1; // keep sample alignment
export const bytesToMs = (bytes: number) => bytes / BYTES_PER_MS;

export interface AsrResult {
  kind: 'interim' | 'final';
  /** Stable within one provider connection for the sentence being recognised. */
  key: string;
  text: string;
  /** Milliseconds from the start of the audio stream sent on THIS provider connection. */
  startMs: number;
  endMs: number | null;
}

export type AsrErrorKind =
  /** Credentials / model / permission problems: retrying will not help. */
  | 'fatal'
  /** Network drop, provider restart, time limit, throttling: reconnect and carry on. */
  | 'transient';

export class AsrError extends Error {
  constructor(
    public kind: AsrErrorKind,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AsrHandlers {
  onResult(r: AsrResult): void;
  /**
   * The connection is gone. `clean` is true only after we asked it to finish. Anything else is an
   * abnormal disconnect and the pipeline must reconnect and re-send unconfirmed audio.
   */
  onClosed(info: { clean: boolean; error?: AsrError }): void;
}

export interface AsrConnectOptions {
  languageHints: string[];
  terms: string[];
  /** Short free-text context (title, topic) given to models that accept prompt context. */
  context?: string;
  sampleRate: number;
}

export interface AsrConnection {
  sendAudio(pcm: Buffer): void;
  /**
   * Ask the provider to flush remaining results and end the task. Resolves true only when the provider
   * confirmed completion (so every audio byte sent has been processed); false on timeout or abnormal close.
   */
  finish(timeoutMs?: number): Promise<boolean>;
  /** Hard close without waiting for results. */
  close(): void;
}

export interface AsrProvider {
  readonly name: string;
  readonly model: string;
  readonly isDemo: boolean;
  /** Resolves when the provider has accepted the session and audio may be sent. */
  connect(opts: AsrConnectOptions, handlers: AsrHandlers, signal?: AbortSignal): Promise<AsrConnection>;
}

export interface AsrProviderFactory {
  /** Returns the live provider, or null when credentials are not configured. */
  live(): AsrProvider | null;
  /** Demo provider: synthetic transcript, never contacts a paid API. */
  demo(): AsrProvider | null;
}
