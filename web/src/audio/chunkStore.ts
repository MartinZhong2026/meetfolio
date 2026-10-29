/**
 * Bounded local audio buffer in IndexedDB (never localStorage: it holds binary PCM).
 *
 * The browser keeps the audio it captured until the server has confirmed the matching transcript.
 * If the network or the speech service fails, this is what makes real recovery possible. Storage is
 * capped per meeting and swept by age so it can never grow without bound.
 */

const DB_NAME = 'meetfolio-audio';
const STORE = 'chunks';
export const FRAME_MS = 100;
export const BYTES_PER_MS = 32; // 16 kHz * 2 bytes

interface Chunk {
  meetingId: string;
  startMs: number;
  endMs: number;
  data: ArrayBuffer;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('indexeddb_unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore(STORE, { keyPath: ['meetingId', 'startMs'] });
        store.createIndex('savedAt', 'savedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

const reqP = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const txDone = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('tx_aborted'));
  });

export interface AudioReadResult {
  /** Timeline position of the first returned sample. */
  fromMs: number;
  pcm: ArrayBuffer;
  coveredMs: number;
}

export interface AudioBufferOptions {
  /** Max audio kept per meeting. 40 min of 16 kHz PCM16 ≈ 77 MB. */
  maxMs?: number;
  chunkMs?: number;
  onError?: (e: Error) => void;
}

export class MeetingAudioBuffer {
  private maxMs: number;
  private chunkMs: number;
  private cur: { startMs: number; parts: Uint8Array[]; bytes: number } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private putsSinceCap = 0;
  private onError?: (e: Error) => void;

  constructor(
    public readonly meetingId: string,
    opts: AudioBufferOptions = {},
  ) {
    this.maxMs = opts.maxMs ?? 40 * 60_000;
    this.chunkMs = opts.chunkMs ?? 2000;
    this.onError = opts.onError;
  }

  /** False once storage has failed (quota, private mode): recording continues but recovery is unavailable. */
  get available() {
    return !this.failed;
  }

  /** Appends a frame captured at timeline position `posMs`. Synchronous; persistence is queued. */
  append(posMs: number, pcm: Int16Array) {
    if (this.failed) return;
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const curEnd = this.cur ? this.cur.startMs + this.cur.bytes / BYTES_PER_MS : 0;
    // A jump in the timeline (e.g. after pause/resume) starts a new chunk so chunks stay contiguous.
    if (this.cur && Math.abs(posMs - curEnd) > 5) this.flushCurrent();
    if (!this.cur) this.cur = { startMs: posMs, parts: [], bytes: 0 };
    this.cur.parts.push(bytes.slice()); // copy: the worklet buffer may be reused
    this.cur.bytes += bytes.byteLength;
    if (this.cur.bytes / BYTES_PER_MS >= this.chunkMs) this.flushCurrent();
  }

  private flushCurrent() {
    const c = this.cur;
    this.cur = null;
    if (!c || !c.bytes) return;
    const data = new Uint8Array(c.bytes);
    let o = 0;
    for (const p of c.parts) {
      data.set(p, o);
      o += p.length;
    }
    const chunk: Chunk = { meetingId: this.meetingId, startMs: Math.round(c.startMs), endMs: Math.round(c.startMs + c.bytes / BYTES_PER_MS), data: data.buffer, savedAt: Date.now() };
    this.enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(chunk);
      await txDone(tx);
      // Enforcing the cap lists every key, so do it periodically rather than after each 2 s chunk.
      if (++this.putsSinceCap >= 15) {
        this.putsSinceCap = 0;
        await this.enforceCap(db);
      }
    });
  }

  /** Writes any partially filled chunk and waits for all pending writes. */
  async flush() {
    this.flushCurrent();
    await this.queue;
  }

  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((e: Error) => {
      if (!this.failed) {
        this.failed = true;
        this.onError?.(e);
      }
    });
  }

  private async enforceCap(db: IDBDatabase) {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const range = IDBKeyRange.bound([this.meetingId, 0], [this.meetingId, Number.MAX_SAFE_INTEGER]);
    const keys = (await reqP(store.getAllKeys(range))) as Array<[string, number]>;
    const maxChunks = Math.ceil(this.maxMs / this.chunkMs);
    const excess = keys.length - maxChunks;
    for (let i = 0; i < excess; i++) store.delete(keys[i]!);
    await txDone(tx);
  }

  private async chunksIn(fromMs: number, toMs: number): Promise<Chunk[]> {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    // Chunks are at most a few seconds long, so look back one chunk-length before `fromMs`.
    const range = IDBKeyRange.bound([this.meetingId, Math.max(0, fromMs - this.chunkMs * 2)], [this.meetingId, toMs]);
    const all = (await reqP(tx.objectStore(STORE).getAll(range))) as Chunk[];
    return all.filter((c) => c.endMs > fromMs && c.startMs < toMs).sort((a, b) => a.startMs - b.startMs);
  }

  /** Newest buffered timeline position (end of the latest chunk), or null if nothing is stored. */
  async latestEnd(): Promise<number | null> {
    await this.flush();
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const keys = (await reqP(tx.objectStore(STORE).getAllKeys(IDBKeyRange.bound([this.meetingId, 0], [this.meetingId, Number.MAX_SAFE_INTEGER])))) as Array<[string, number]>;
    if (!keys.length) return null;
    const last = (await reqP(tx.objectStore(STORE).get(keys[keys.length - 1]!))) as Chunk;
    return last.endMs;
  }

  /** Contiguous audio starting at (or just after) `fromMs`, up to `toMs`. Null if nothing usable is stored. */
  async read(fromMs: number, toMs: number): Promise<AudioReadResult | null> {
    await this.flush();
    const chunks = await this.chunksIn(fromMs, toMs);
    if (!chunks.length) return null;
    const first = chunks[0]!;
    // Do not bridge holes: stitch only while chunks are contiguous (small tolerance for rounding).
    const run: Chunk[] = [first];
    for (const c of chunks.slice(1)) {
      if (Math.abs(c.startMs - run[run.length - 1]!.endMs) > 20) break;
      run.push(c);
    }
    const runStart = first.startMs;
    const runEnd = run[run.length - 1]!.endMs;
    const lo = Math.max(fromMs, runStart);
    const hi = Math.min(toMs, runEnd);
    if (hi - lo < 100) return null;
    const total = new Uint8Array(Math.round((runEnd - runStart) * BYTES_PER_MS));
    for (const c of run) total.set(new Uint8Array(c.data), Math.round((c.startMs - runStart) * BYTES_PER_MS));
    const startByte = Math.round((lo - runStart) * BYTES_PER_MS) & ~1;
    const endByte = Math.round((hi - runStart) * BYTES_PER_MS) & ~1;
    const out = total.slice(startByte, endByte);
    return { fromMs: runStart + startByte / BYTES_PER_MS, pcm: out.buffer, coveredMs: (endByte - startByte) / BYTES_PER_MS };
  }

  /** Drops audio that the server has durably transcribed. */
  async pruneBefore(ms: number) {
    this.enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(IDBKeyRange.bound([this.meetingId, 0], [this.meetingId, Math.max(0, ms)], false, true));
      await txDone(tx);
      // `delete` by range on startMs also removes chunks that straddle `ms`; acceptable (3 s safety margin is applied by callers).
    });
    await this.queue;
  }

  async clear() {
    this.cur = null;
    this.enqueue(async () => {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(IDBKeyRange.bound([this.meetingId, 0], [this.meetingId, Number.MAX_SAFE_INTEGER]));
      await txDone(tx);
    });
    await this.queue;
  }

  async usageMs(): Promise<number> {
    await this.flush();
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const n = await reqP(tx.objectStore(STORE).count(IDBKeyRange.bound([this.meetingId, 0], [this.meetingId, Number.MAX_SAFE_INTEGER])));
    return n * this.chunkMs;
  }
}

/** Deletes buffered audio older than `maxAgeMs` for any meeting. Called once at app start. */
export async function sweepOldAudio(maxAgeMs = 7 * 86_400_000) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const idx = tx.objectStore(STORE).index('savedAt');
    idx.openKeyCursor(IDBKeyRange.upperBound(Date.now() - maxAgeMs)).onsuccess = function () {
      const cur = this.result as IDBCursor | null;
      if (cur) {
        tx.objectStore(STORE).delete(cur.primaryKey);
        cur.continue();
      }
    };
    await txDone(tx);
  } catch {
    /* storage unavailable: nothing to sweep */
  }
}

/** Test helper. */
export async function __resetAudioDb() {
  try {
    (await dbPromise)?.close();
  } catch {
    /* never opened */
  }
  dbPromise = null;
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}
