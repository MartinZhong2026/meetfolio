import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WavRecording, recordingPath, openPlaybackRecording } from './wav-recording';
import { validAudio, validSession, validStart } from './policy';
import type { Segment } from '../../web/src/lib/types';

export const MAX_IMPORT_SAMPLES = 16000 * 20 * 60;
export interface ImportOptions { interviewId: string; diarize: boolean; numSpeakers: number; consent: true }
export function validImport(value: unknown): value is ImportOptions {
  const v = value as ImportOptions;
  return validStart(v) && v.consent === true && typeof v.diarize === 'boolean' && Number.isInteger(v.numSpeakers) && (v.numSpeakers === -1 || (v.numSpeakers >= 1 && v.numSpeakers <= 12));
}
interface Job { id: string; options: ImportOptions; wav: WavRecording; startup: Promise<void>; samples: number; running: boolean; writing: boolean; worker: ChildProcess | null; cancelled: boolean }
export class AudioImports {
  private job: Job | null = null;
  constructor(private root: string, private workerPath: string, private runtimeRoot: string,
    private modelFiles: () => Promise<{ encoder: string; decoder: string; joiner: string; tokens: string }>,
    private speakerFiles: () => Promise<{ segmentation: string; embedding: string }>,
    private progress: (id: string, phase: string, percent: number) => void) {}
  get busy() { return this.job !== null; }
  async begin(options: unknown) {
    if (this.job || !validImport(options)) throw new Error('Stop other audio work and confirm consent before importing');
    const job: Job = { id: randomUUID(), options, wav: null!, startup: Promise.resolve(), samples: 0, running: false, writing: false, worker: null, cancelled: false };
    this.job = job;
    job.startup = WavRecording.create(this.root, job.id, options.interviewId).then(wav => { job.wav = wav; });
    try { await job.startup; if (job.cancelled) { await job.wav.finish('interrupted'); throw new Error('Import cancelled'); } return job.id; }
    catch (error) { if (this.job === job) this.job = null; throw error; }
  }
  async append(value: unknown) {
    if (!validAudio(value)) throw new Error('Invalid import frame');
    const job = this.job;
    if (!job || job.id !== value.id || job.running || job.writing || job.cancelled) throw new Error('Import is not accepting audio');
    if (job.samples + value.pcm.length / 2 > MAX_IMPORT_SAMPLES) throw new Error('Audio exceeds 20 minutes');
    job.writing = true;
    try { await job.wav.append(value.pcm); job.samples += value.pcm.length / 2; }
    finally { job.writing = false; }
  }
  async cancel(id?: unknown) {
    const job = this.job;
    if (!job) return;
    if (id !== undefined && (!validSession(id) || job.id !== id)) throw new Error('Invalid import identity');
    job.cancelled = true;
    await job.startup.catch(() => {});
    if (job.worker) {
      const worker = job.worker;
      const exited = new Promise<void>(resolve => worker.once('close', () => resolve()));
      worker.kill();
      const timer = setTimeout(() => worker.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await job.wav?.finish('interrupted').catch(() => {});
    if (this.job === job) this.job = null;
  }
  async finish(id: unknown): Promise<{ recordingId: string; durationMs: number; segments: Segment[] }> {
    const job = this.job;
    if (!validSession(id) || !job || job.id !== id || job.running || job.writing || !job.samples || job.cancelled) throw new Error('Invalid or empty audio import');
    job.running = true;
    try {
      await job.wav.finish();
      const opened = await openPlaybackRecording(this.root, job.id, job.options.interviewId); await opened.file.close();
      const files = await this.modelFiles();
      const speakers = job.options.diarize ? await this.speakerFiles() : undefined;
      if (job.cancelled) throw new Error('Import cancelled');
      const childOptions: import('node:child_process').ForkOptions & { windowsHide: boolean } = {
        windowsHide: true, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      };
      const worker = fork(this.workerPath, [JSON.stringify({ audio: recordingPath(this.root, job.id), files: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner }, tokens: files.tokens,
        speakers, numSpeakers: job.options.numSpeakers, runtimeRoot: this.runtimeRoot })], childOptions);
      job.worker = worker; worker.stderr?.resume();
      const segments = await new Promise<Segment[]>((resolve, reject) => {
        let result: Segment[] | null = null;
        const timer = setTimeout(() => { worker.kill(); reject(new Error('Local transcription timed out; saved WAV retained')); }, 30 * 60 * 1000);
        worker.on('message', (message: any) => {
          if (message?.type === 'progress' && typeof message.phase === 'string' && Number.isFinite(message.percent)) this.progress(job.id, message.phase, message.percent);
          if (message?.type === 'done' && Array.isArray(message.segments) && message.segments.length <= 10000) {
            const duration = job.samples / 16;
            if (!message.segments.every((s: any) => typeof s.originalText === 'string' && s.originalText.length <= 200000 && Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.startMs >= 0 && s.endMs > s.startMs && s.endMs <= duration && (s.speakerLabel === null || /^Speaker \d{1,3}$/.test(s.speakerLabel)))) return;
            result = message.segments.map((s: any, n: number) => ({ ...s, id: randomUUID(), seq: n + 1, source: 'local', editedText: null, isImportant: false, updatedAt: new Date().toISOString(), audio: { recordingId: job.id, startMs: s.startMs, endMs: s.endMs } }));
          }
        });
        worker.once('error', () => { clearTimeout(timer); reject(new Error('Cannot start local inference')); });
        worker.once('close', code => { clearTimeout(timer); if (!job.cancelled && code === 0 && result) resolve(result); else reject(new Error('Local import stopped. Saved WAV retained in Local storage; check the models and retry.')); });
      });
      // Durable result allows text recovery after a renderer/host interruption during delivery.
      const saved = JSON.stringify({ schema: 1, interviewId: job.options.interviewId, segments });
      if (Buffer.byteLength(saved) > 8 * 1024 * 1024) throw new Error('Transcript exceeds recovery limit; saved WAV retained');
      const target = path.join(this.root, job.id, 'import-transcript.json');
      const temporary = target + '.part';
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(saved); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, target);
      if (job.cancelled) throw new Error('Import cancelled');
      return { recordingId: job.id, durationMs: job.samples / 16, segments };
    } finally { if (this.job === job) this.job = null; }
  }
  async recover(value: unknown) {
    if (!validStart(value) || !validSession((value as any).recordingId)) throw new Error('Invalid saved import');
    const id = (value as any).recordingId;
    const opened = await openPlaybackRecording(this.root, id, value.interviewId); const durationMs = opened.bytes / 32; await opened.file.close();
    const file = path.join(this.root, id, 'import-transcript.json'); const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Invalid saved transcript');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.schema !== 1 || data.interviewId !== value.interviewId || !Array.isArray(data.segments) || data.segments.length > 10000 || !data.segments.every((s: any) =>
      validSession(s?.id) && Number.isInteger(s.seq) && s.seq > 0 && typeof s.originalText === 'string' && s.originalText.length <= 200000 &&
      s.editedText === null && s.source === 'local' && s.isImportant === false && typeof s.updatedAt === 'string' && Number.isFinite(Date.parse(s.updatedAt)) &&
      (s.speakerLabel === null || (typeof s.speakerLabel === 'string' && /^Speaker \d{1,3}$/.test(s.speakerLabel))) &&
      Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.startMs >= 0 && s.endMs > s.startMs && s.endMs <= durationMs &&
      s.audio?.recordingId === id && s.audio.startMs === s.startMs && s.audio.endMs === s.endMs)) throw new Error('Invalid saved transcript');
    return data.segments as Segment[];
  }
}
