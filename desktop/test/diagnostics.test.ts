import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Diagnostics, asrDiagnostic } from '../src/diagnostics';

describe('privacy-minimal diagnostics', () => {
  it('retains only bounded fixed-code records and rotates instead of growing without limit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-diagnostics-'));
    try {
      const log = new Diagnostics(directory, false, 256);
      log.record('startup', 'info');
      log.record('private transcript and user path' as never);
      for (let i = 0; i < 70; i++) { log.record('ipc_error'); await log.flush(); }
      const names = await fs.readdir(directory); expect(names.sort()).toEqual(['native.jsonl', 'native.previous.jsonl']);
      for (const name of names) {
        const bytes = await fs.readFile(path.join(directory, name)); expect(bytes.length).toBeLessThanOrEqual(256);
        for (const line of bytes.toString().trim().split('\n')) {
          const record = JSON.parse(line);
          expect(Object.keys(record).sort()).toEqual(['at', 'code', 'severity']);
          expect(record.code).toBe('ipc_error');
        }
      }
      expect(asrDiagnostic('local_asr_ack_timeout')).toBe('inference_timeout');
      expect(asrDiagnostic('local_asr_native_missing')).toBe('native_init');
      expect(asrDiagnostic('local_asr_overloaded')).toBe('queue_overload');
    } finally { await fs.rm(directory, { recursive: true }); }
  });
});
