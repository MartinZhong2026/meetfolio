/** Messages exchanged on the /ws/transcribe socket (JSON text frames; audio is binary PCM16 16 kHz mono). */

export interface WireSegment {
  id: string;
  seq: number;
  startMs: number;
  endMs: number;
  originalText: string;
  editedText: string | null;
  speakerLabel: string | null;
  isImportant: boolean;
  source: string;
  updatedAt: string;
}

export interface WireGap {
  id: string;
  startMs: number;
  endMs: number | null;
  reason: string;
  status: string;
  recoveredMs: number;
  createdAt: string;
}

export type ClientMsg =
  | { type: 'hello'; meetingId: string; audioStartMs: number; demo?: boolean; reason?: 'network' | 'page_reload' | 'capture_stopped' }
  | { type: 'pause' }
  | { type: 'resume'; audioStartMs: number }
  | { type: 'stop' }
  | { type: 'ping'; t?: number }
  /** Demo sessions only: kill the provider connection to demonstrate recovery. */
  | { type: 'demo_drop_provider' };

export type ProviderState = 'connecting' | 'ok' | 'reconnecting' | 'failed' | 'rotating' | 'idle';

export type ServerMsg =
  | { type: 'ready'; sessionId: string; serverRecordedMs: number; demo: boolean; provider: string; gaps: WireGap[] }
  | { type: 'provider_state'; state: ProviderState; attempt?: number }
  | { type: 'interim'; key: string; text: string; startMs: number }
  | { type: 'interim_clear' }
  | { type: 'final'; segment: WireSegment; interimKey?: string }
  | { type: 'gap'; gap: WireGap }
  | { type: 'ack'; receivedMs: number; confirmedMs: number }
  | { type: 'persist_state'; ok: boolean; pending: number }
  | { type: 'paused' }
  | { type: 'stopped'; unsaved: number }
  | { type: 'pong'; t?: number }
  | { type: 'error'; code: string; message: string; fatal: boolean };
