import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WavRecording, recordingPath, openPlaybackRecording } from './wav-recording';
import { validAudio, validSession, validStart } from './policy';
import type { Segment } from '../../web/src/lib/types';
import { atomicJson, IMPORT_MAX_SAMPLES, readCheckpoint, validImportSegments } from './import-checkpoint';
import { decodeAudioFile } from './audio-decoder';

export const MAX_IMPORT_SAMPLES = IMPORT_MAX_SAMPLES;
export interface ImportOptions { interviewId: string; diarize: boolean; numSpeakers: number; consent: true; name?: string }
export function validImport(value: unknown): value is ImportOptions {
  const v = value as ImportOptions;
  return validStart(v) && v.consent === true && (v.name === undefined || (typeof v.name === 'string' && v.name.length <= 200)) && typeof v.diarize === 'boolean' && Number.isInteger(v.numSpeakers) && (v.numSpeakers === -1 || (v.numSpeakers >= 1 && v.numSpeakers <= 12));
}
interface Job { id: string; options: ImportOptions; wav: WavRecording | null; startup: Promise<void>; samples: number; running: boolean; writing: boolean; worker: ChildProcess | null; cancelled: boolean; controller: AbortController; source?: string; resume?: boolean }
export class AudioImports {
  private job: Job | null = null;
  constructor(private root: string, private workerPath: string, private runtimeRoot: string,
    private modelFiles: () => Promise<{ encoder: string; decoder: string; joiner: string; tokens: string }>,
    private speakerFiles: () => Promise<{ segmentation: string; embedding: string }>,
    private progress: (id: string, phase: string, percent: number, detail?: { completedMs: number; totalMs: number }) => void,
    private decoder?: () => Promise<string>) {}
  get busy() { return this.job !== null; }
  async begin(options: unknown) {
    if (this.job || !validImport(options)) throw new Error('Stop other audio work and confirm consent before importing');
    const job: Job = { id: randomUUID(), options, wav: null, startup: Promise.resolve(), samples: 0, running: false, writing: false, worker: null, cancelled: false, controller: new AbortController() };
    this.job = job;
    job.startup = WavRecording.create(this.root, job.id, options.interviewId).then(wav => { job.wav = wav; });
    try { await job.startup; if (job.cancelled) { await job.wav!.finish('interrupted'); throw new Error('Import cancelled'); } return job.id; }
    catch (error) { if (this.job === job) this.job = null; throw error; }
  }
  async append(value: unknown) {
    if (!validAudio(value)) throw new Error('Invalid import frame');
    const job = this.job;
    if (!job || job.id !== value.id || job.running || job.writing || job.cancelled) throw new Error('Import is not accepting audio');
    if (job.samples + value.pcm.length / 2 > MAX_IMPORT_SAMPLES) throw new Error('Audio exceeds 120 minutes');
    job.writing = true;
    try { await job.wav!.append(value.pcm); job.samples += value.pcm.length / 2; }
    finally { job.writing = false; }
  }
  async cancel(id?: unknown) {
    const job = this.job;
    if (!job) return;
    if (id !== undefined && (!validSession(id) || job.id !== id)) throw new Error('Invalid import identity');
    job.cancelled = true;
    job.controller.abort();
    await job.startup.catch(() => {});
    if (job.worker && job.worker.exitCode === null && job.worker.signalCode === null) {
      const worker = job.worker;
      const exited = new Promise<void>(resolve => worker.once('close', () => resolve()));
      worker.kill();
      const timer = setTimeout(() => worker.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await job.wav?.finish('interrupted').catch(() => {});
    if (this.job === job) this.job = null;
  }
  async beginFile(options: unknown, source: string) {
    if (!this.decoder) throw new Error('Native decoder unavailable');
    if (!validImport(options)) throw new Error('Invalid import settings');
    const id = await this.begin({ ...options, name: path.basename(source).slice(0,200) });
    this.job!.source = source; return id;
  }
  async resume(value: unknown) {
    if (this.job || !validStart(value) || !validSession((value as any).recordingId)) throw new Error('Invalid resume request');
    const id = (value as any).recordingId;
    const opened = await openPlaybackRecording(this.root, id, value.interviewId); const samples = opened.bytes / 2; await opened.file.close();
    if (samples > MAX_IMPORT_SAMPLES) throw new Error('Recording exceeds 120 minutes');
    const checkpoint = await readCheckpoint(path.join(this.root, id, 'import-checkpoint.json'), id, samples);
    if (checkpoint.completedSamples === samples) throw new Error('Transcription is complete; recover its saved text instead');
    const options: ImportOptions = { interviewId: value.interviewId, diarize: checkpoint.diarize, numSpeakers: checkpoint.numSpeakers, consent: true, name: checkpoint.name };
    this.job = { id, options, wav: null, startup: Promise.resolve(), samples, running: false, writing: false, worker: null, cancelled: false, controller: new AbortController(), resume: true };
    return id;
  }
  async status(interviewId: string) {
    const { listRecordings } = await import('./wav-recording');
    const results = [];
    for (const recording of await listRecordings(this.root, interviewId)) {
      if (recording.unavailable || recording.recoverable || recording.status === 'recording') continue;
      try {
        const c = await readCheckpoint(path.join(this.root, recording.id, 'import-checkpoint.json'), recording.id, recording.bytes / 2);
        results.push({ recordingId: recording.id, durationMs: recording.durationMs, completedMs: c.completedSamples / 16, segmentCount: c.segments.length, complete: c.completedSamples === c.samples, name: c.name });
      } catch { /* Old recordings have no checkpoint and remain available through the catalog. */ }
    }
    return results;
  }
  async finish(id: unknown): Promise<{ recordingId: string; durationMs: number; segments: Segment[] }> {
    const job = this.job;
    if (!validSession(id) || !job || job.id !== id || job.running || job.writing || (!job.samples && !job.source) || job.cancelled) throw new Error('Invalid or empty audio import');
    job.running = true;
    try {
      if (job.source) {
        const executable = await this.decoder!();
        await decodeAudioFile(executable, job.source, async frame => { await job.wav!.append(frame); job.samples += frame.length / 2; }, job.controller.signal,
          child => { job.worker = child; }, decodedMs => this.progress(job.id, `Saving audio · ${Math.floor(decodedMs / 60000)} min decoded`, 0));
        job.worker = null;
      }
      await job.wav?.finish();
      const opened = await openPlaybackRecording(this.root, job.id, job.options.interviewId); await opened.file.close();
      const files = await this.modelFiles();
      const speakers = job.options.diarize ? await this.speakerFiles() : undefined;
      if (job.cancelled) throw new Error('Import cancelled');
      const childOptions: import('node:child_process').ForkOptions & { windowsHide: boolean } = {
        windowsHide: true, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      };
      const worker = fork(this.workerPath, [JSON.stringify({ audio: recordingPath(this.root, job.id), files: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner }, tokens: files.tokens,
        speakers, numSpeakers: job.options.numSpeakers, runtimeRoot: this.runtimeRoot, recordingId: job.id, resume: job.resume, name: job.options.name })], childOptions);
      job.worker = worker; worker.stderr?.resume();
      const segments = await new Promise<Segment[]>((resolve, reject) => {
        let result: Segment[] | null = null;
        let failedPhase = '';
        let timer = setTimeout(() => { worker.kill(); reject(new Error('Local transcription made no progress; saved audio and checkpoints retained')); }, 10 * 60 * 1000);
        worker.on('message', (message: any) => {
          if (message?.type === 'failed' && ['loading models', 'reading checkpoint', 'saving checkpoint', 'reading saved audio', 'separating speakers', 'transcribing audio'].includes(message.phase)) failedPhase = message.phase;
          if (message?.type === 'progress' && typeof message.phase === 'string' && Number.isFinite(message.percent)) {
            clearTimeout(timer); timer = setTimeout(() => { worker.kill(); reject(new Error('Local transcription made no progress; checkpoint retained')); }, 10 * 60 * 1000);
            this.progress(job.id, message.phase, message.percent, { completedMs: message.completedMs, totalMs: message.totalMs });
          }
          if (message?.type === 'done' && Array.isArray(message.segments) && message.segments.length <= 10000) {
            const duration = job.samples / 16;
            if (!validImportSegments(message.segments, job.id, duration)) return;
            result = message.segments;
          }
        });
        worker.once('error', () => { clearTimeout(timer); reject(new Error('Cannot start local inference')); });
        worker.once('close', code => { clearTimeout(timer); if (!job.cancelled && code === 0 && result) resolve(result); else reject(new Error(`Local import stopped${failedPhase ? ` while ${failedPhase}` : ''}. Saved WAV and checkpoints retained in Local storage; check storage and models before resuming.`)); });
      });
      // Durable result allows text recovery after a renderer/host interruption during delivery.
      await atomicJson(path.join(this.root, job.id, 'import-transcript.json'), { schema: 1, interviewId: job.options.interviewId, segments });
      if (job.cancelled) throw new Error('Import cancelled');
      return { recordingId: job.id, durationMs: job.samples / 16, segments };
    } finally {
      const worker = job.worker;
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const closed = new Promise<void>(resolve => worker.once('close', () => resolve())); worker.kill();
        const force = setTimeout(() => worker.kill('SIGKILL'), 2000);
        try { await closed; } finally { clearTimeout(force); }
      }
      await job.wav?.finish('interrupted').catch(() => {}); if (this.job === job) this.job = null;
    }
  }
  async recover(value: unknown) {
    if (!validStart(value) || !validSession((value as any).recordingId)) throw new Error('Invalid saved import');
    const id = (value as any).recordingId;
    const opened = await openPlaybackRecording(this.root, id, value.interviewId); const durationMs = opened.bytes / 32; await opened.file.close();
    const file = path.join(this.root, id, 'import-transcript.json');
    const stat = await fs.lstat(file).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (!stat) return (await readCheckpoint(path.join(this.root, id, 'import-checkpoint.json'), id, opened.bytes / 2)).segments;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Invalid saved transcript');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.schema !== 1 || data.interviewId !== value.interviewId || !validImportSegments(data.segments, id, durationMs)) throw new Error('Invalid saved transcript');
    return data.segments as Segment[];
  }
}
