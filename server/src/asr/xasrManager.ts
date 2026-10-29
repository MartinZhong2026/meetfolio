import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rm, rename, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LocalXAsrProvider } from './localXasr.js';
import { XASR, XASR_URL, defaultXAsrRoot, modelFiles, sealModelCache, verifyModelCache } from './localXasrModel.js';
import { extractXAsrArchive } from './xasrArchive.js';
import { AsrError, type AsrProvider, type AsrConnection, type AsrHandlers, type AsrConnectOptions } from './types.js';

export type XAsrState = 'not-installed' | 'downloading' | 'download-failed' | 'installed' | 'loading' | 'ready' | 'error';
export interface XAsrStatus {
  state: XAsrState;
  downloadedBytes: number;
  totalBytes: number;
  detail?: string;
}
export interface XAsrManagerOptions {
  root?: string;
  /** Trusted host override for an existing model directory, never supplied by renderer IPC. */
  modelDir?: string;
  /** Injection points for transport/worker tests. Production defaults use the pinned official artifact. */
  fetch?: typeof globalThis.fetch;
  provider?: (dir: string) => AsrProvider;
}

export async function verifyXAsrArchive(file: string): Promise<void> {
  if ((await stat(file)).size !== XASR.size) throw new Error('Model archive size mismatch');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== XASR.sha256) throw new Error('Model archive SHA-256 mismatch');
}

/** No HTTP server, login, DB or cloud API is needed. Bind these methods to trusted desktop IPC. */
export class XAsrModelManager extends EventEmitter implements AsrProvider {
  readonly name = 'local-xasr';
  readonly model = XASR.id;
  readonly isDemo = false;
  readonly root: string;
  readonly modelDir: string;
  private status: XAsrStatus;
  private operation?: Promise<void>;
  private controller?: AbortController;
  private warm?: AsrConnection;
  private handlers?: AsrHandlers;
  private recording = false;
  private disposed = false;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly makeProvider: (dir: string) => AsrProvider;

  constructor(options: XAsrManagerOptions = {}) {
    super();
    this.root = path.resolve(options.root ?? defaultXAsrRoot());
    this.modelDir = path.resolve(options.modelDir ?? path.join(this.root, XASR.id));
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.makeProvider = options.provider ?? (dir => new LocalXAsrProvider(dir));
    this.status = { state: this.installed() ? 'installed' : 'not-installed', downloadedBytes: 0, totalBytes: XASR.size };
  }
  getStatus(): Readonly<XAsrStatus> { return { ...this.status }; }
  private installed(): boolean { try { modelFiles(this.modelDir); return true; } catch { return false; } }
  private update(state: XAsrState, detail?: string, downloadedBytes = this.status.downloadedBytes): void {
    this.status = { state, detail, downloadedBytes, totalBytes: XASR.size };
    this.emit('status', this.getStatus());
  }
  private exclusive(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Model manager is closed'));
    if (this.operation || this.recording) return Promise.reject(new Error('Model operation or recording already in progress'));
    this.controller = new AbortController();
    this.operation = task(this.controller.signal).finally(() => { this.operation = undefined; this.controller = undefined; });
    return this.operation;
  }
  cancel(): void { this.controller?.abort(); }

  /** Retry resumes the same pinned archive; servers that ignore Range safely restart the download. */
  download(options: { repair?: boolean } = {}): Promise<void> {
    return this.exclusive(async signal => {
      if (!options.repair && this.installed()) { await this.load(signal); return; }
      if (this.warm) await this.warm.finish();
      this.update('downloading', undefined, 0);
      try {
        await this.withInstallLock(async () => {
          const partial = path.join(this.root, `${XASR.id}.part`);
          let offset = await stat(partial).then(s => s.size).catch(() => 0);
          if (offset > XASR.size) { await rm(partial); offset = 0; }
          if (offset < XASR.size) {
            const response = await this.fetcher(XASR_URL, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal });
            if (response.status === 200) offset = 0;
            else if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${XASR.size - 1}/${XASR.size}`) {
              await response.body?.cancel();
              throw new Error(`Model download failed: HTTP ${response.status} or invalid range`);
            }
            if (!response.body) throw new Error('Empty model download response');
            const length = response.headers.get('content-length');
            if (length && Number(length) !== XASR.size - offset) {
              await response.body.cancel();
              throw new Error('Unexpected model download size');
            }
            this.update('downloading', undefined, offset);
            let downloaded = offset;
            const progress = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
              downloaded += chunk.length;
              if (downloaded > XASR.size) { callback(new Error('Model download exceeds expected size')); return; }
              this.update('downloading', undefined, downloaded);
              callback(null, chunk);
            } });
            await pipeline(Readable.fromWeb(response.body as never), progress,
              createWriteStream(partial, { flags: offset ? 'a' : 'w', mode: 0o600 }), { signal });
          }
          try { await verifyXAsrArchive(partial); }
          catch (error) { await rm(partial, { force: true }); throw error; }
          await this.installArchive(partial, signal, options.repair ?? false);
          await rm(partial, { force: true });
        });
      } catch (error) {
        this.update(signal.aborted ? (this.installed() ? 'installed' : 'not-installed') : 'download-failed', signal.aborted ? 'Download cancelled; retry resumes retained bytes' : String(error));
        throw error;
      }
      await this.load(signal);
    });
  }
  /** The native file picker supplies an archive path; accept the exact pinned archive only. */
  importArchive(file: string, options: { repair?: boolean } = {}): Promise<void> {
    return this.exclusive(async signal => {
      if (!options.repair && this.installed()) { await this.load(signal); return; }
      if (this.warm) await this.warm.finish();
      try {
        await this.withInstallLock(async () => {
          // Copy first so validation and extraction read the same private file, even on removable media.
          const imported = path.join(this.root, `${randomUUID()}.import`);
          try {
            await copyFile(file, imported);
            signal.throwIfAborted();
            await verifyXAsrArchive(imported);
            await this.installArchive(imported, signal, options.repair ?? false);
          } finally { await rm(imported, { force: true }); }
        });
      } catch (error) { this.update('error', String(error)); throw error; }
      await this.load(signal);
    });
  }
  /** Explicit repair replaces a damaged managed model, never interview data. */
  repair(): Promise<void> { return this.download({ repair: true }); }

  private async withInstallLock(task: () => Promise<void>): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.root, {
      lockfilePath: path.join(this.root, '.xasr-install-lock'), realpath: false,
      stale: 30_000, update: 10_000, retries: 0,
      // Losing exclusivity must cancel extraction/promotion, not crash the application.
      onCompromised: error => this.controller?.abort(error),
    }).catch(error => { throw new Error(`Another installer owns the model cache, or the cache is unavailable: ${String(error)}`); });
    try { await task(); } finally { await release(); }
  }
  private async installArchive(archive: string, signal: AbortSignal, repair: boolean): Promise<void> {
    const parent = path.dirname(this.modelDir);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    // Sibling staging also supports a configured model directory on another Windows drive.
    const staging = path.join(parent, `.xasr-stage-${randomUUID()}`);
    const backup = path.join(parent, `.xasr-previous-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    let movedPrevious = false;
    let promoted = false;
    try {
      await extractXAsrArchive(archive, staging, signal);
      const extracted = path.join(staging, XASR.archive.replace(/\.tar\.bz2$/, ''));
      modelFiles(extracted);
      await sealModelCache(extracted);
      signal.throwIfAborted();
      const existing = await lstat(this.modelDir).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (existing) {
        if (!repair) throw new Error('Model directory already exists; choose Repair to replace it');
        if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Repair target must be a real model directory');
        await rename(this.modelDir, backup);
        movedPrevious = true;
      }
      try {
        signal.throwIfAborted();
        await rename(extracted, this.modelDir);
        promoted = true;
      } catch (error) {
        if (movedPrevious) await rename(backup, this.modelDir);
        throw error;
      }
      this.update('installed', undefined, XASR.size);
    } finally {
      await rm(staging, { recursive: true, force: true });
      // Preserve backup if promotion/rollback failed; never erase the only previous copy.
      if (movedPrevious && promoted) await rm(backup, { recursive: true, force: true });
    }
  }
  initialize(): Promise<void> { return this.exclusive(signal => this.load(signal)); }
  private async load(signal: AbortSignal): Promise<void> {
    if (this.warm) return;
    if (!this.installed()) { this.update('not-installed'); throw new Error('Install the X-ASR model first'); }
    this.update('loading');
    try {
      await verifyModelCache(this.modelDir);
      this.warm = await this.makeProvider(this.modelDir).connect({ sampleRate: 16000, terms: [], languageHints: ['zh', 'en'] }, {
        onResult: result => this.handlers?.onResult(result),
        onClosed: info => {
          this.warm = undefined;
          this.recording = false;
          this.update(this.disposed || info.clean ? 'installed' : 'error', info.error?.message);
          const handlers = this.handlers;
          this.handlers = undefined;
          handlers?.onClosed(info);
        },
      }, signal);
      this.update('ready');
    } catch (error) { this.update('error', String(error)); throw error; }
  }
  async connect(opts: AsrConnectOptions, handlers: AsrHandlers, signal?: AbortSignal): Promise<AsrConnection> {
    if (opts.sampleRate !== 16000) throw new AsrError('fatal', 'local_sample_rate', 'X-ASR requires 16 kHz mono PCM16');
    if (signal?.aborted) throw new AsrError('transient', 'local_asr_aborted', 'Recognition cancelled');
    if (this.recording || this.operation) throw new AsrError('transient', 'local_asr_busy', 'X-ASR is busy');
    if (!this.warm) {
      const abort = () => this.cancel();
      signal?.addEventListener('abort', abort, { once: true });
      try { await this.initialize(); } finally { signal?.removeEventListener('abort', abort); }
    }
    if (signal?.aborted) { this.warm?.close(); throw new AsrError('transient', 'local_asr_aborted', 'Recognition cancelled'); }
    this.recording = true;
    this.handlers = handlers;
    return this.warm!;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancel();
    await this.operation?.catch(() => {});
    this.warm?.close();
    this.warm = undefined;
    this.update(this.installed() ? 'installed' : 'not-installed');
  }
}
