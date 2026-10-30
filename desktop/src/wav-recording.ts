import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';

export interface RecordingInfo {
  id: string;
  interviewId: string;
  createdAt: string;
  durationMs: number;
  /** PCM bytes, excluding the 44-byte WAV header. */
  bytes: number;
  status: 'complete' | 'interrupted' | 'recording';
  recoverable: boolean;
  /** Metadata or audio could not be validated; retain a visible warning instead of hiding the entry. */
  unavailable?: boolean;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const INTERVIEW = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_PENDING = 160000; // Five seconds; disk stalls must never grow memory indefinitely.
const MAX_PCM = 0xffffffff - 37; // Even PCM length within classic RIFF's uint32 size.
const active = new Set<string>();

function directory(root: string, id: string): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid recording ID');
  return path.resolve(root, id);
}
export function recordingPath(root: string, id: string): string {
  return path.join(directory(root, id), 'recording.wav');
}
export function header(bytes: number): Buffer {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
async function writeAll(file: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, position + offset);
    if (!bytesWritten) throw new Error('Recording write made no progress');
    offset += bytesWritten;
  }
}
async function readAll(file: FileHandle, size: number, position: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(bytes, offset, size - offset, position + offset);
    if (!bytesRead) throw new Error('Recording is truncated');
    offset += bytesRead;
  }
  return bytes;
}
async function regular(file: string): Promise<void> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid recording file');
}
async function metadata(root: string, id: string): Promise<RecordingInfo> {
  const rootStat = await fs.lstat(path.resolve(root));
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid recording root');
  const dir = directory(root, id);
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid recording directory');
  const name = path.join(dir, 'session.json');
  await regular(name);
  if ((await fs.stat(name)).size > 2048) throw new Error('Invalid recording metadata');
  const value = JSON.parse(await fs.readFile(name, 'utf8'));
  if (value.schema !== 1 || value.id !== id || typeof value.interviewId !== 'string' || !INTERVIEW.test(value.interviewId) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Invalid recording metadata');
  }
  return { id, interviewId: value.interviewId, createdAt: value.createdAt, bytes: 0, durationMs: 0, status: 'interrupted', recoverable: true };
}
async function inspect(file: string, complete: boolean): Promise<number> {
  await regular(file);
  const handle = await fs.open(file, 'r');
  try { return await inspectHandle(handle, complete); }
  finally { await handle.close(); }
}
async function inspectHandle(handle: FileHandle, complete: boolean): Promise<number> {
  const size = (await handle.stat()).size;
  if (size < 44 || size - 44 > MAX_PCM) throw new Error('Invalid recording size');
  const actual = await readAll(handle, 44, 0);
  const expected = header(0);
  for (let i = 0; i < 44; i++) {
    if ((i >= 4 && i < 8) || i >= 40) continue;
    if (actual[i] !== expected[i]) throw new Error('Unsupported recording format');
  }
  const bytes = size - 44;
  const declared = actual.readUInt32LE(40);
  // A failed final header write may leave one size updated; only these own-format values are accepted.
  if (![0, bytes - bytes % 2].includes(declared) || ![36, 36 + bytes - bytes % 2].includes(actual.readUInt32LE(4))) {
    throw new Error('Invalid recording header');
  }
  if (complete && (bytes % 2 || declared !== bytes || actual.readUInt32LE(4) !== bytes + 36)) throw new Error('Incomplete WAV');
  return bytes - bytes % 2;
}

/** Read-only ownership check against native metadata; never accepts a renderer file path. */
export async function openPlaybackRecording(root: string, id: string, interviewId: string): Promise<{ file: FileHandle; bytes: number }> {
  if (!INTERVIEW.test(interviewId)) throw new Error('Invalid interview ID');
  const info = await metadata(root, id);
  if (info.interviewId !== interviewId) throw new Error('Recording belongs to another interview');
  if (active.has(directory(root, id))) throw new Error('Stop capture before playback');
  const name = recordingPath(root, id);
  const before = await fs.lstat(name);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Invalid recording file');
  const file = await fs.open(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || before.ino !== opened.ino || before.dev !== opened.dev) throw new Error('Recording changed');
    const bytes = await inspectHandle(file, true);
    await finalStatus(directory(root, id), bytes);
    return { file, bytes };
  } catch (error) { await file.close(); throw error; }
}

/** One immutable capture session. Pause/resume uses a new session; no existing WAV is appended. */
export class WavRecording {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private written = 0;
  private synced = 0;
  private accepted = 0;
  private failure: Error | null = null;
  private ioFailed = false;
  private closed = false;
  private finishing: Promise<RecordingInfo> | null = null;
  private constructor(private dir: string, private file: FileHandle, private info: RecordingInfo,
    private onError?: (error: Error) => void) {}

  static async create(root: string, id: string, interviewId: string, onError?: (error: Error) => void): Promise<WavRecording> {
    if (typeof interviewId !== 'string' || !INTERVIEW.test(interviewId)) throw new Error('Invalid interview ID');
    const dir = directory(root, id);
    await fs.mkdir(path.resolve(root), { recursive: true });
    const rootStat = await fs.lstat(path.resolve(root));
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid recording root');
    await fs.mkdir(dir, { mode: 0o700 }); // Exclusive ownership: an existing session is never reused.
    const info: RecordingInfo = { id, interviewId, createdAt: new Date().toISOString(), bytes: 0, durationMs: 0, status: 'recording', recoverable: false };
    const session = await fs.open(path.join(dir, 'session.json'), 'wx', 0o600);
    try { await writeAll(session, Buffer.from(JSON.stringify({ schema: 1, ...info })), 0); await session.sync(); }
    finally { await session.close(); }
    const file = await fs.open(path.join(dir, 'capture.part'), 'wx', 0o600);
    try { await writeAll(file, header(0), 0); await file.sync(); }
    catch (error) { await file.close(); throw error; }
    active.add(dir);
    return new WavRecording(dir, file, info, onError);
  }
  private fail(error: unknown): Error {
    if (!this.failure) {
      this.failure = error instanceof Error ? error : new Error('Recording write failed');
      try { this.onError?.(this.failure); } catch { /* Observers cannot break file ownership. */ }
    }
    return this.failure;
  }
  enqueue(pcm: Uint8Array): void {
    if (this.closed || this.failure) throw this.failure ?? new Error('Recording is closed');
    if (!(pcm instanceof Uint8Array) || !pcm.length || pcm.length % 2 || pcm.length > 32000) throw this.fail(new Error('Invalid PCM frame'));
    if (this.pending + pcm.length > MAX_PENDING || this.accepted + pcm.length > MAX_PCM) throw this.fail(new Error('Recording capacity exceeded'));
    const bytes = Buffer.from(pcm);
    this.pending += bytes.length; this.accepted += bytes.length;
    this.queue = this.queue.then(async () => {
      if (this.ioFailed) return;
      try {
        await writeAll(this.file, bytes, 44 + this.written);
        this.written += bytes.length;
        if (this.written - this.synced >= 32000) { await this.file.sync(); this.synced = this.written; }
      } catch (error) { this.ioFailed = true; this.fail(error); }
    }).finally(() => { this.pending -= bytes.length; });
  }
  finish(status: 'complete' | 'interrupted' = 'complete'): Promise<RecordingInfo> {
    if (this.finishing) return this.finishing;
    this.closed = true;
    this.finishing = (async () => {
      let closed = false;
      try {
        await this.queue;
        if (this.failure) throw this.failure;
        await writeAll(this.file, header(this.written), 0);
        await this.file.sync(); await this.file.close(); closed = true;
        // link is exclusive, unlike rename which can replace a pre-existing finalized WAV.
        await fs.link(path.join(this.dir, 'capture.part'), path.join(this.dir, 'recording.wav'));
        const final = await fs.open(path.join(this.dir, 'final.json'), 'wx', 0o600);
        try { await writeAll(final, Buffer.from(JSON.stringify({ status, bytes: this.written })), 0); await final.sync(); }
        finally { await final.close(); }
        await fs.unlink(path.join(this.dir, 'capture.part'));
        return { ...this.info, bytes: this.written, durationMs: this.written / 32, status };
      } catch (error) { throw this.fail(error); }
      finally { try { if (!closed) await this.file.close(); } finally { active.delete(this.dir); } }
    })();
    return this.finishing;
  }
}

async function finalStatus(dir: string, bytes: number): Promise<'complete' | 'interrupted'> {
  try {
    const finalName = path.join(dir, 'final.json');
    await regular(finalName);
    if ((await fs.stat(finalName)).size > 1024) throw new Error('Invalid final metadata');
    const final = JSON.parse(await fs.readFile(finalName, 'utf8'));
    if (!['complete', 'interrupted'].includes(final.status) || final.bytes !== bytes) throw new Error('Invalid final metadata');
    return final.status;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'interrupted'; throw error; }
}
export async function listRecordings(root: string, interviewId?: string): Promise<RecordingInfo[]> {
  if (interviewId !== undefined && (typeof interviewId !== 'string' || !INTERVIEW.test(interviewId))) throw new Error('Invalid interview ID');
  let names: string[];
  try {
    const stat = await fs.lstat(path.resolve(root));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid recording root');
    names = await fs.readdir(root);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: RecordingInfo[] = [];
  for (const id of names.filter(name => UUID.test(name))) {
    let info: RecordingInfo | null = null;
    try {
      info = await metadata(root, id);
      if (interviewId !== undefined && info.interviewId !== interviewId) continue;
      const dir = directory(root, id);
      let bytes: number;
      let status: RecordingInfo['status'];
      let recoverable = false;
      try {
        bytes = await inspect(recordingPath(root, id), true); status = await finalStatus(dir, bytes);
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        bytes = await inspect(path.join(dir, 'capture.part'), false);
        status = active.has(dir) ? 'recording' : 'interrupted';
        recoverable = status === 'interrupted';
      }
      result.push({ ...info, bytes, durationMs: bytes / 32, status, recoverable });
    } catch {
      result.push({ id, interviewId: info?.interviewId ?? 'unknown', createdAt: info?.createdAt ?? '',
        bytes: 0, durationMs: 0, status: 'interrupted', recoverable: false, unavailable: true });
    }
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Explicit recovery preserves the original partial file and never claims missing samples were restored. */
export async function recoverRecording(root: string, id: string): Promise<RecordingInfo> {
  const dir = directory(root, id);
  if (active.has(dir)) throw new Error('Recording is active');
  const info = await metadata(root, id);
  try {
    const bytes = await inspect(recordingPath(root, id), true);
    return { ...info, bytes, durationMs: bytes / 32, status: await finalStatus(dir, bytes), recoverable: false };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bytes = await inspect(path.join(dir, 'capture.part'), false);
  const source = await fs.open(path.join(dir, 'capture.part'), 'r');
  let target: FileHandle | null = null;
  const staging = path.join(dir, `recovered-${randomUUID()}.part`);
  try {
    target = await fs.open(staging, 'wx', 0o600);
    await writeAll(target, header(bytes), 0);
    for (let offset = 0; offset < bytes; offset += 65536) {
      await writeAll(target, await readAll(source, Math.min(65536, bytes - offset), 44 + offset), 44 + offset);
    }
    await target.sync(); await target.close(); target = null;
    await fs.link(staging, recordingPath(root, id));
    await fs.unlink(staging);
    return { ...info, bytes, durationMs: bytes / 32, status: 'interrupted', recoverable: false };
  } finally { try { await source.close(); } finally { await target?.close(); } }
}
