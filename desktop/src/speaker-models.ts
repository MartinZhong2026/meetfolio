import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

// Official sherpa-onnx assets, downloaded only after an explicit UI action.
export const SPEAKER_MODELS = {
  segmentation: { name: 'model.int8.onnx', sha256: 'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d' },
  embedding: { name: '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx', sha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b' },
  archive: { sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2' },
  embeddingUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
} as const;
async function verify(file: string, expected: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 50 * 1024 * 1024) throw new Error('Invalid speaker model');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('Speaker model checksum mismatch');
}
export class SpeakerModels {
  private operation: AbortController | null = null;
  readonly directory: string;
  constructor(root: string, private extract: (archive: string, destination: string, signal?: AbortSignal) => Promise<void>, private fetcher: typeof fetch = fetch) {
    this.directory = path.join(root, 'speakers-pyannote3-eres2net-v1');
  }
  get busy() { return this.operation !== null; }
  async files() {
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid speaker model directory');
    const segmentation = path.join(this.directory, SPEAKER_MODELS.segmentation.name);
    const embedding = path.join(this.directory, SPEAKER_MODELS.embedding.name);
    await Promise.all([verify(segmentation, SPEAKER_MODELS.segmentation.sha256), verify(embedding, SPEAKER_MODELS.embedding.sha256)]);
    return { segmentation, embedding };
  }
  async ready() { try { await this.files(); return true; } catch { return false; } }
  cancel() { this.operation?.abort(); }
  async install(source?: string) {
    if (this.operation) throw new Error('Speaker model setup already running');
    const controller = new AbortController(); this.operation = controller;
    const temporary = this.directory + '-' + randomUUID();
    try {
      if (await this.ready()) return;
      await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
      let segmentation: string; let embedding: string;
      if (source) {
        const stat = await fs.lstat(source);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a regular model folder');
        segmentation = path.join(source, SPEAKER_MODELS.segmentation.name);
        embedding = path.join(source, SPEAKER_MODELS.embedding.name);
      } else {
        const download = async (url: string, name: string, hash: string) => {
          const response = await this.fetcher(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
          if (!response.ok || !response.body) throw new Error('Speaker model download failed');
          let size = 0;
          const bound = new Transform({ transform(chunk, _encoding, done) { size += chunk.length; done(size > 50 * 1024 * 1024 ? new Error('Model download too large') : null, chunk); } });
          const target = path.join(temporary, name);
          await pipeline(Readable.fromWeb(response.body as any), bound, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
          await verify(target, hash); return target;
        };
        const archive = await download(SPEAKER_MODELS.archive.url, 'segmentation.tar.bz2', SPEAKER_MODELS.archive.sha256);
        await this.extract(archive, temporary, controller.signal);
        segmentation = path.join(temporary, 'sherpa-onnx-pyannote-segmentation-3-0', SPEAKER_MODELS.segmentation.name);
        embedding = await download(SPEAKER_MODELS.embeddingUrl, 'embedding.download', SPEAKER_MODELS.embedding.sha256);
      }
      await Promise.all([verify(segmentation, SPEAKER_MODELS.segmentation.sha256), verify(embedding, SPEAKER_MODELS.embedding.sha256)]);
      await fs.copyFile(segmentation, path.join(temporary, SPEAKER_MODELS.segmentation.name));
      await fs.copyFile(embedding, path.join(temporary, SPEAKER_MODELS.embedding.name));
      controller.signal.throwIfAborted();
      if (!source) {
        await fs.rm(path.join(temporary, 'segmentation.tar.bz2'));
        await fs.rm(path.join(temporary, 'embedding.download'));
        await fs.rm(path.join(temporary, 'sherpa-onnx-pyannote-segmentation-3-0'), { recursive: true });
      }
      // Preserve an invalid cache so setup can repair it without deleting evidence.
      const existing = await fs.lstat(this.directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      let retained: string | null = null;
      if (existing) {
        if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Invalid speaker model cache');
        retained = this.directory + '-invalid-' + randomUUID();
        await fs.rename(this.directory, retained);
      }
      try { await fs.rename(temporary, this.directory); }
      catch (error) { if (retained) await fs.rename(retained, this.directory); throw error; }
    } finally {
      this.operation = null;
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
