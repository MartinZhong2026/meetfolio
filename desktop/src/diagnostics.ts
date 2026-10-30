import fs from 'node:fs/promises';
import path from 'node:path';

export const DIAGNOSTIC_CODES = ['startup', 'model_load', 'native_init', 'microphone_permission', 'audio_capture',
  'inference_timeout', 'queue_overload', 'ipc_error', 'child_exit', 'cleanup_failure', 'recovery', 'shutdown', 'recording_write'] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];

/** Fixed event codes only: no free text, paths, audio, transcript, renderer arguments or exception strings. */
export class Diagnostics {
  private tail = Promise.resolve();
  private queued = 0;
  constructor(private directory: string, private development = false, private maxBytes = 128 * 1024) {}
  record(code: DiagnosticCode, severity: 'info' | 'error' = 'error'): void {
    if (!DIAGNOSTIC_CODES.includes(code) || (!this.development && severity === 'info') || this.queued >= 64) return;
    const line = JSON.stringify({ at: new Date().toISOString(), code, severity }) + '\n';
    this.queued++;
    this.tail = this.tail.then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!(await fs.lstat(this.directory)).isDirectory() || (await fs.lstat(this.directory)).isSymbolicLink()) throw new Error('Unsafe diagnostics directory');
      const file = path.join(this.directory, 'native.jsonl');
      const previous = path.join(this.directory, 'native.previous.jsonl');
      const status = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (status && (!status.isFile() || status.isSymbolicLink())) throw new Error('Unsafe diagnostics file');
      if ((status?.size ?? 0) + Buffer.byteLength(line) > this.maxBytes) {
        // Both paths are fixed files within the private diagnostics directory; no user paths are accepted.
        await fs.rm(previous, { force: true });
        if (status) await fs.rename(file, previous);
      }
      await fs.appendFile(file, line, { mode: 0o600 });
    }).catch(() => { console.error('Meetfolio diagnostics write failed'); }).finally(() => { this.queued--; });
  }
  flush(): Promise<void> { return this.tail; }
}

export function asrDiagnostic(code?: string): DiagnosticCode {
  if (code?.includes('timeout')) return 'inference_timeout';
  if (code === 'local_asr_overloaded') return 'queue_overload';
  if (code === 'local_asr_worker_exit') return 'child_exit';
  if (code?.includes('ipc')) return 'ipc_error';
  if (code?.includes('native')) return 'native_init';
  if (code?.includes('model') || code?.includes('load')) return 'model_load';
  return 'recovery';
}
