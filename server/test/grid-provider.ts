import { AsrError, bytesToMs, type AsrConnectOptions, type AsrConnection, type AsrHandlers, type AsrProvider } from '../src/asr/types.js';

/** 100 ms of PCM whose first 4 bytes carry the frame's absolute timeline position (ms). */
export function pcmFrame(absStartMs: number, ms = 100): Buffer {
  const b = Buffer.alloc(Math.round(ms * 32));
  b.writeInt32LE(Math.round(absStartMs), 0);
  return b;
}

export const CELL_MS = 3000;
export const SPEECH_MS = 2500;

/**
 * Deterministic stand-in for a streaming ASR service. Speech occupies [g*3000, g*3000+2500) on the
 * ABSOLUTE timeline (read back from the frame markers), and a final "cell-g" is emitted only when the
 * connection has received that whole span. This makes loss and duplication directly observable:
 * every cell must appear exactly once, or lie inside an explicitly recorded gap.
 */
export class GridProvider implements AsrProvider {
  readonly name = 'grid';
  readonly model = 'grid-v1';
  readonly isDemo = false;
  connections: GridConnection[] = [];
  failNextConnects = 0;
  fatalNextConnect = false;
  /** Per connection index: kill it once it has received this many ms of audio. */
  dropAfterMs = new Map<number, number>();
  hangFinish = false;
  duplicateFinals = false;
  /** Provider-side hard session limit: kills the connection after this much audio, like a service time cap. */
  sessionLimitMs: number | null = null;

  async connect(_o: AsrConnectOptions, handlers: AsrHandlers): Promise<AsrConnection> {
    if (this.fatalNextConnect) throw new AsrError('fatal', 'InvalidApiKey', 'bad key');
    if (this.failNextConnects > 0) {
      this.failNextConnects--;
      throw new AsrError('transient', 'ECONNREFUSED', 'refused');
    }
    const c = new GridConnection(this, this.connections.length, handlers);
    this.connections.push(c);
    return c;
  }
  get current() {
    return this.connections[this.connections.length - 1];
  }
}

export class GridConnection implements AsrConnection {
  baseAbs: number | null = null;
  receivedMs = 0;
  closed = false;
  private done = new Set<number>();
  private lastInterim = -1;
  constructor(
    private p: GridProvider,
    public index: number,
    private h: AsrHandlers,
  ) {}

  sendAudio(buf: Buffer) {
    if (this.closed) return;
    const abs = buf.readInt32LE(0);
    if (this.baseAbs === null) this.baseAbs = abs;
    const frameMs = bytesToMs(buf.length);
    const absEnd = abs + frameMs;
    this.receivedMs = absEnd - this.baseAbs;
    const base = this.baseAbs;
    const gMax = Math.floor(absEnd / CELL_MS);
    for (let g = Math.max(0, Math.floor(base / CELL_MS)); g <= gMax; g++) {
      const start = g * CELL_MS;
      const end = start + SPEECH_MS;
      if (start < base || this.done.has(g)) continue; // joined mid-cell: the service cannot recognise a partial sentence
      if (absEnd >= end) {
        this.done.add(g);
        const r = { kind: 'final' as const, key: String(start - base), text: `cell-${g}`, startMs: start - base, endMs: end - base };
        this.h.onResult(r);
        if (this.p.duplicateFinals) this.h.onResult(r);
      } else if (absEnd > start) {
        // Streaming services keep updating the partial sentence while speech continues.
        this.lastInterim = g;
        this.h.onResult({ kind: 'interim', key: String(start - base), text: `cell-${g}…`, startMs: start - base, endMs: null });
      }
    }
    const drop = this.p.dropAfterMs.get(this.index);
    if ((drop !== undefined && this.receivedMs >= drop) || (this.p.sessionLimitMs !== null && this.receivedMs >= this.p.sessionLimitMs)) this.kill();
  }

  async finish() {
    if (this.closed) return false;
    if (this.p.hangFinish) {
      this.kill();
      return false;
    }
    // Like a real service, end-of-task flushes the sentence that is still in progress as a final.
    const absNow = (this.baseAbs ?? 0) + this.receivedMs;
    const g = Math.floor(absNow / CELL_MS);
    const start = g * CELL_MS;
    if (this.baseAbs !== null && !this.done.has(g) && start >= this.baseAbs && absNow > start && absNow < start + SPEECH_MS) {
      this.done.add(g);
      this.h.onResult({ kind: 'final', key: String(start - this.baseAbs), text: `cell-${g}`, startMs: start - this.baseAbs, endMs: absNow - this.baseAbs });
    }
    this.closed = true;
    this.h.onClosed({ clean: true });
    return true;
  }
  close() {
    this.closed = true;
  }
  kill() {
    if (this.closed) return;
    this.closed = true;
    this.h.onClosed({ clean: false, error: new AsrError('transient', 'ws_close_1006', 'abnormal closure') });
  }
}
