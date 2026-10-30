import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { header, openPlaybackRecording } from './wav-recording';
import { validPlayback, validSession } from './policy';

const PREFIX = '/recording-playback/';
const READ_SIZE = 65536;
type Capture = { token: string; file: FileHandle; offset: number; bytes: number; size: number;
  modified: number; cancel: Set<() => void> };

function range(value: string | null, size: number): [number, number] | null {
  if (value === null) return [0, size - 1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return null;
  return [start, Math.min(end, size - 1)];
}

/** One revocable media capability. Native reads and queued stream chunks are bounded. */
export class RecordingPlayback {
  private current: Capture | null = null;
  private generation = 0;
  private opening: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}

  private async dispose(capture: Capture | null): Promise<void> {
    if (!capture) return;
    for (const cancel of capture.cancel) cancel();
    await capture.file.close();
  }
  prepare(value: unknown): Promise<{ token: string; url: string; durationMs: number }> {
    if (!validPlayback(value)) return Promise.reject(new Error('Invalid playback request'));
    const generation = ++this.generation;
    const operation = this.opening.catch(() => {}).then(async () => {
      if (generation !== this.generation) throw new Error('Playback superseded');
      const previous = this.current; this.current = null;
      await this.dispose(previous);
      const opened = await openPlaybackRecording(this.root, value.recordingId, value.interviewId);
      try {
        const start = Math.round(value.startMs * 16), end = Math.round(value.endMs * 16);
        if (generation !== this.generation) throw new Error('Playback superseded');
        if (start >= end || end > opened.bytes / 2) throw new Error('Audio timestamps are outside saved recording');
        const stat = await opened.file.stat();
        if (generation !== this.generation) throw new Error('Playback superseded');
        const token = randomUUID();
        this.current = { token, file: opened.file, offset: 44 + start * 2, bytes: (end - start) * 2,
          size: stat.size, modified: stat.mtimeMs, cancel: new Set() };
        return { token, url: `meetfolio://app${PREFIX}${token}`, durationMs: (end - start) / 16 };
      } catch (error) { await opened.file.close(); throw error; }
    });
    this.opening = operation;
    return operation;
  }
  /** A stale UI cleanup cannot revoke a newer selection. No token means host lifecycle cleanup. */
  async release(token?: unknown): Promise<void> {
    if (token !== undefined && (!validSession(token) || token !== this.current?.token)) return;
    ++this.generation;
    const pending = this.opening;
    const previous = this.current; this.current = null;
    await this.dispose(previous);
    if (token === undefined) await pending.catch(() => {});
  }
  async respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const capture = this.current;
    const token = url.pathname.slice(PREFIX.length);
    if (url.protocol !== 'meetfolio:' || url.host !== 'app' || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(PREFIX) || !validSession(token) || !capture || capture.token !== token) return new Response(null, { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const size = 44 + capture.bytes;
    const selection = range(request.headers.get('range'), size);
    if (!selection) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    try {
      const stat = await capture.file.stat();
      if (stat.size !== capture.size || stat.mtimeMs !== capture.modified || capture !== this.current) throw new Error('Recording changed');
    } catch { return new Response(null, { status: 410 }); }
    const [first, last] = selection;
    const partial = request.headers.has('range');
    const headers: Record<string, string> = { 'Content-Type': 'audio/wav', 'Content-Length': String(last - first + 1),
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (partial) headers['Content-Range'] = `bytes ${first}-${last}/${size}`;
    if (request.method === 'HEAD') return new Response(null, { status: partial ? 206 : 200, headers });
    // Media seeking may overlap requests; cancel the previous response before opening another.
    for (const cancel of capture.cancel) cancel();
    let position = first;
    let cancelled = false;
    let terminate: () => void;
    const wavHeader = header(capture.bytes);
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        terminate = () => { if (cancelled) return; cancelled = true; capture.cancel.delete(terminate);
          request.signal.removeEventListener('abort', terminate); controller.error(new Error('Playback released')); };
        capture.cancel.add(terminate);
        request.signal.addEventListener('abort', terminate, { once: true });
        if (request.signal.aborted) terminate();
      },
      pull: async controller => {
        if (cancelled) return;
        try {
          if (position < 44) {
            const end = Math.min(44, last + 1);
            controller.enqueue(wavHeader.subarray(position, end)); position = end;
          } else {
            const chunk = Buffer.alloc(Math.min(READ_SIZE, last - position + 1));
            const { bytesRead } = await capture.file.read(chunk, 0, chunk.length, capture.offset + position - 44);
            if (cancelled) return;
            if (!bytesRead) throw new Error('Recording truncated');
            position += bytesRead; controller.enqueue(chunk.subarray(0, bytesRead));
          }
          if (position > last) { cancelled = true; capture.cancel.delete(terminate);
            request.signal.removeEventListener('abort', terminate); controller.close(); }
        } catch { if (!cancelled) terminate(); }
      },
      cancel: () => { cancelled = true; capture.cancel.delete(terminate); request.signal.removeEventListener('abort', terminate); },
    });
    return new Response(body, { status: partial ? 206 : 200, headers });
  }
}
