import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import yauzl from 'yauzl';
import { IMPORT_MAX_SAMPLES, renameWithRetry } from './import-checkpoint';
export const DECODER = {
  id: 'ffmpeg-9.0.2-gyan-win64',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  archiveSha: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  executableSha: '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec',
  size: 114768076,
};
async function digest(file: string) {
  const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 300 * 1024 * 1024) throw new Error('Invalid decoder file');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
async function extractExecutable(archive: string, destination: string) {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('Cannot open decoder archive'));
      const fail = (error: Error) => { zip.close(); reject(error); };
      let found = false, count = 0;
      zip.on('error', fail); zip.on('end', () => found ? resolve() : reject(new Error('Decoder absent from archive')));
      zip.on('entry', entry => {
        if (++count > 2000) { zip.close(); reject(new Error('Decoder archive has too many entries')); return; }
        if (!entry.fileName.endsWith('/bin/ffmpeg.exe')) { zip.readEntry(); return; }
        if (found || entry.uncompressedSize > 200 * 1024 * 1024 || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) { zip.close(); reject(new Error('Invalid decoder entry')); return; }
        found = true;
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error || new Error('Cannot read decoder'));
          void pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o700 })).then(() => zip.readEntry(), fail);
        });
      }); zip.readEntry();
    });
  });
}
/** Optional upstream download, never bundled in the Meetfolio installer. */
export class AudioDecoder {
  private operation: AbortController | null = null;
  readonly directory: string;
  constructor(root: string, private fetcher: typeof fetch = fetch, private progress: (bytes: number, total: number) => void = () => {}) { this.directory = path.join(root, DECODER.id); }
  get supported() { return process.platform === 'win32' && process.arch === 'x64'; }
  get busy() { return this.operation !== null; }
  cancel() { this.operation?.abort(); }
  async executable() {
    if (!this.supported) throw new Error('The native decoder is currently available on Windows x64');
    const stat = await fs.lstat(this.directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid decoder folder');
    const file = path.join(this.directory, 'ffmpeg.exe');
    if (await digest(file) !== DECODER.executableSha) throw new Error('Decoder checksum mismatch'); return file;
  }
  async ready() { try { await this.executable(); return true; } catch { return false; } }
  async install(archive?: string) {
    if (this.operation || !this.supported) throw new Error('Decoder setup unavailable');
    const controller = new AbortController(); this.operation = controller;
    const stage = this.directory + '-' + randomUUID();
    let phase = 'checking installed decoder';
    try {
      if (await this.ready()) return;
      await fs.mkdir(stage, { recursive: true, mode: 0o700 });
      let source = archive;
      if (!source) {
        phase = 'downloading archive';
        source = path.join(stage, 'upstream.zip');
        let lastActivity = Date.now();
        const inactivity = setInterval(() => { if (Date.now() - lastActivity > 60000) controller.abort(Object.assign(new Error('Decoder download stalled'), { code: 'DOWNLOAD_STALLED' })); }, 10000);
        try {
          const response = await this.fetcher(DECODER.url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)]) });
          if (!response.ok || !response.body) throw new Error('Decoder download failed');
          let size = 0, reported = 0; const progress = this.progress;
          const bound = new Transform({ transform(chunk, _encoding, done) { lastActivity = Date.now(); size += chunk.length; if (size - reported >= 1024 * 1024 || size === DECODER.size) { reported = size; progress(size, DECODER.size); } done(size > DECODER.size ? new Error('Decoder archive too large') : null, chunk); } });
          await pipeline(Readable.fromWeb(response.body as any), bound, createWriteStream(source, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
        } finally { clearInterval(inactivity); }
      }
      phase = 'verifying archive';
      if (await digest(source) !== DECODER.archiveSha) throw new Error('Decoder archive checksum mismatch');
      phase = 'extracting decoder';
      await extractExecutable(source, path.join(stage, 'ffmpeg.exe'));
      phase = 'verifying executable';
      if (await digest(path.join(stage, 'ffmpeg.exe')) !== DECODER.executableSha) throw new Error('Decoder checksum mismatch');
      controller.signal.throwIfAborted();
      const previous = await fs.lstat(this.directory).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      let retained: string | null = null;
      phase = 'saving verified decoder';
      if (previous) { if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('Invalid decoder cache'); retained = this.directory + '-invalid-' + randomUUID(); await renameWithRetry(this.directory, retained); }
      try { await renameWithRetry(stage, this.directory); } catch (error) { if (retained) await renameWithRetry(retained, this.directory); throw error; }
    } catch (error) {
      // Include a safe stage/code, never a local source path or native stderr.
      const code = (controller.signal.reason as NodeJS.ErrnoException | undefined)?.code || (error as NodeJS.ErrnoException).code;
      const detail = error instanceof Error && error.message.includes('checksum mismatch') ? 'checksum mismatch' : code && /^[A-Z_]{2,30}$/.test(code) ? code : 'operation incomplete';
      throw new Error(`Decoder setup failed while ${phase}: ${detail}`);
    } finally { this.operation = null; await fs.rm(stage, { recursive: true, force: true }); }
  }
}
/** Stream normalized PCM with disk backpressure. No full audio buffer or network protocols. */
export async function decodeAudioFile(executable: string, file: string, append: (pcm: Uint8Array) => Promise<void>, signal: AbortSignal,
  onChild: (child: ChildProcess) => void, onProgress: (decodedMs: number) => void) {
  const ext = path.extname(file).toLowerCase();
  if (!['.wav','.mp3','.m4a'].includes(ext)) throw new Error('Unsupported audio file');
  const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 2 * 1024 ** 3) throw new Error('Choose an audio file up to 2 GiB');
  signal.throwIfAborted();
  const child = spawn(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe',
    '-f', ext === '.wav' ? 'wav' : ext === '.mp3' ? 'mp3' : 'mov', '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-threads', '2', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
    { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  onChild(child); child.stderr.resume();
  const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  // Attach rejection handling before iterating stdout in case process creation fails.
  void closed.catch(() => {});
  const abort = () => { child.kill(); }; signal.addEventListener('abort', abort, { once: true });
  let total = 0, carry = Buffer.alloc(0);
  try {
    for await (const raw of child.stdout) {
      signal.throwIfAborted();
      const bytes = carry.length ? Buffer.concat([carry, raw]) : raw as Buffer;
      const length = bytes.length - bytes.length % 2; carry = Buffer.from(bytes.subarray(length));
      for (let offset = 0; offset < length; offset += 32000) {
        const frame = bytes.subarray(offset, Math.min(length, offset + 32000)); total += frame.length / 2;
        if (total > IMPORT_MAX_SAMPLES) throw new Error('Recording exceeds 120 minutes; saved audio retained');
        await append(frame); onProgress(total / 16); signal.throwIfAborted();
      }
    }
    const code = await closed; signal.throwIfAborted();
    if (code !== 0 || carry.length || !total) throw new Error('Cannot decode this recording. Try a PCM WAV; saved audio is retained.');
    return total;
  } finally {
    signal.removeEventListener('abort', abort); child.kill();
    const force = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await closed.catch(() => {}); } finally { clearTimeout(force); }
  }
}
export async function probeAudioFile(executable: string, file: string): Promise<number> {
  const ext = path.extname(file).toLowerCase();
  if (!['.wav','.mp3','.m4a'].includes(ext)) throw new Error('Unsupported audio file');
  const child = spawn(executable, ['-nostdin','-hide_banner','-protocol_whitelist','file,pipe','-f',ext === '.wav' ? 'wav' : ext === '.mp3' ? 'mp3' : 'mov','-i',file,'-map','0:a:0','-t','0','-f','null','-'], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
  let output = '', overflow = false;
  child.stderr.on('data', chunk => { if (output.length + chunk.length > 65536) { overflow = true; child.kill(); } else output += chunk.toString('utf8'); });
  return await new Promise<number>((resolve,reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Cannot inspect this recording. Try a PCM WAV.')); }, 20000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Cannot start the local decoder')); });
    child.once('close', code => {
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
      const seconds = m ? Number(m[1])*3600+Number(m[2])*60+Number(m[3]) : NaN;
      if (code !== 0 || overflow || !Number.isFinite(seconds) || seconds <= 0) reject(new Error('Cannot inspect this recording. Try a PCM WAV.'));
      else if (seconds > 7200.05) reject(new Error('Recording exceeds 120 minutes. Trim it before importing.'));
      else resolve(Math.min(seconds,7200)*1000);
    });
  });
}
