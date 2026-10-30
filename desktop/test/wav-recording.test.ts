import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { WavRecording, listRecordings, recordingPath, recoverRecording } from '../src/wav-recording';

const directories: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-wav-'));
  directories.push(root);
  return { root, id: randomUUID() };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of directories.splice(0)) {
    // Recursive deletion is restricted to this suite's verified absolute temporary directories.
    const absolute = path.resolve(root);
    if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('meetfolio-wav-')) throw new Error('Unsafe test cleanup');
    await fs.rm(absolute, { recursive: true });
  }
});

describe('durable PCM WAV recording (real temporary filesystem)', () => {
  it('writes exact PCM bytes, WAV fields, sample duration and durable association; finish is idempotent', async () => {
    const { root, id } = await fixture();
    const recording = await WavRecording.create(root, id, 'interview_1');
    const first = new Uint8Array(3200).fill(7);
    recording.enqueue(first); first.fill(8); // Capture buffers may be reused immediately.
    recording.enqueue(new Uint8Array([1, 2]));
    const pending = recording.finish();
    expect(recording.finish()).toBe(pending);
    expect(await pending).toMatchObject({ id, interviewId: 'interview_1', bytes: 3202, durationMs: 100.0625, status: 'complete' });
    const wav = await fs.readFile(recordingPath(root, id));
    expect(wav.length).toBe(3246); expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(3238); expect(wav.readUInt32LE(40)).toBe(3202);
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt32LE(24)).toBe(16000); expect(wav.readUInt32LE(28)).toBe(32000);
    expect(wav.readUInt16LE(22)).toBe(1); expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(44, 3244)).toEqual(Buffer.alloc(3200, 7));
    expect(wav.subarray(3244)).toEqual(Buffer.from([1, 2]));
    expect(await listRecordings(root, 'interview_1')).toEqual([await pending]);
    expect(await listRecordings(root, 'other')).toEqual([]);
    expect(() => recording.enqueue(new Uint8Array(2))).toThrow('closed');
    await expect(WavRecording.create(root, id, 'interview_1')).rejects.toThrow();
  });
  it('persists interruption status even when its WAV was finalized successfully', async () => {
    const { root, id } = await fixture();
    const recording = await WavRecording.create(root, id, 'interview');
    recording.enqueue(new Uint8Array(320));
    expect(await recording.finish('interrupted')).toMatchObject({ status: 'interrupted', durationMs: 10 });
    expect(await listRecordings(root, 'interview')).toMatchObject([{ status: 'interrupted', durationMs: 10 }]);
  });
  it('rejects traversal and invalid frame formats and reports failure once', async () => {
    const { root, id } = await fixture();
    expect(() => recordingPath(root, '../outside')).toThrow('Invalid recording ID');
    await expect(WavRecording.create(root, id, '../interview')).rejects.toThrow('Invalid interview ID');
    const onError = vi.fn(); const recording = await WavRecording.create(root, id, 'interview', onError);
    recording.enqueue(new Uint8Array(32));
    expect(() => recording.enqueue(new Uint8Array(3))).toThrow('Invalid PCM');
    expect(() => recording.enqueue(new Uint8Array(2))).toThrow('Invalid PCM');
    await expect(recording.finish()).rejects.toThrow('Invalid PCM');
    expect(onError).toHaveBeenCalledOnce();
    expect(await recoverRecording(root, id)).toMatchObject({ bytes: 32, status: 'interrupted' });
  });
  it('bounds queued memory, retains previously accepted frames and explicitly recovers an interrupted session', async () => {
    const { root, id } = await fixture();
    const onError = vi.fn(); const recording = await WavRecording.create(root, id, 'interview', onError);
    await expect(recoverRecording(root, id)).rejects.toThrow('active');
    for (let n = 0; n < 5; n++) recording.enqueue(new Uint8Array(32000).fill(n));
    // All five accepted writes are queued synchronously; the sixth exceeds the five-second bound.
    expect(() => recording.enqueue(new Uint8Array(2))).toThrow('capacity');
    await expect(recording.finish()).rejects.toThrow('capacity');
    expect(onError).toHaveBeenCalledOnce();
    expect(await listRecordings(root, 'interview')).toMatchObject([{ status: 'interrupted', durationMs: 5000 }]);
    const part = path.join(root, id, 'capture.part'); const original = await fs.readFile(part);
    const info = await recoverRecording(root, id);
    expect(info).toMatchObject({ bytes: 160000, durationMs: 5000, status: 'interrupted' });
    expect(await fs.readFile(part)).toEqual(original);
    const wav = await fs.readFile(recordingPath(root, id));
    expect(wav.subarray(44)).toEqual(original.subarray(44));
    expect(wav.readUInt32LE(40)).toBe(160000);
    expect(await listRecordings(root, 'interview')).toMatchObject([{ status: 'interrupted', bytes: 160000 }]);
    expect(await recoverRecording(root, id)).toEqual(info);
    expect(await fs.readFile(recordingPath(root, id))).toEqual(wav);
  });
  it('recovers only complete PCM samples after abrupt termination and rejects foreign/corrupt files', async () => {
    const { root, id } = await fixture();
    const recording = await WavRecording.create(root, id, 'interview');
    // Force a safe interrupted close, then simulate a torn trailing sample on disk.
    expect(() => recording.enqueue(new Uint8Array(0))).toThrow();
    await expect(recording.finish()).rejects.toThrow();
    const part = path.join(root, id, 'capture.part');
    await fs.appendFile(part, new Uint8Array([5, 6, 7]));
    expect(await recoverRecording(root, id)).toMatchObject({ bytes: 2, durationMs: 0.0625, status: 'interrupted' });
    expect((await fs.readFile(recordingPath(root, id))).subarray(44)).toEqual(Buffer.from([5, 6]));
    expect((await fs.readFile(part)).length).toBe(47);
    const foreign = await fixture(); const bad = await WavRecording.create(foreign.root, foreign.id, 'interview');
    expect(() => bad.enqueue(new Uint8Array(1))).toThrow(); await expect(bad.finish()).rejects.toThrow();
    await fs.writeFile(path.join(foreign.root, foreign.id, 'capture.part'), Buffer.alloc(46));
    await expect(recoverRecording(foreign.root, foreign.id)).rejects.toThrow('Unsupported recording format');
  });
  it('handles short writes and reports disk errors without silently finalizing a truncated recording', async () => {
    const { root, id } = await fixture();
    const open = vi.spyOn(fs, 'open');
    const onError = vi.fn(); const recording = await WavRecording.create(root, id, 'interview', onError);
    const result = open.mock.calls.findIndex(call => String(call[0]).endsWith('capture.part'));
    const handle = await open.mock.results[result].value;
    const write = handle.write.bind(handle);
    const mocked = vi.spyOn(handle, 'write');
    mocked.mockImplementation(((buffer: Uint8Array, offset: number, length: number, position: number) => write(buffer, offset, Math.min(2, length), position)) as typeof handle.write);
    recording.enqueue(new Uint8Array([1, 2, 3, 4]));
    // Wait for the accepted frame; subsequent IO fails with a disk-full style error.
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
    mocked.mockImplementationOnce(((buffer: Uint8Array, offset: number, length: number, position: number) => write(buffer, offset, Math.min(2, length), position)) as typeof handle.write);
    mocked.mockRejectedValueOnce(new Error('fixture ENOSPC'));
    recording.enqueue(new Uint8Array([5, 6, 7, 8]));
    await expect(recording.finish()).rejects.toThrow('ENOSPC');
    expect(onError).toHaveBeenCalledOnce();
    expect(await recoverRecording(root, id)).toMatchObject({ bytes: 6, status: 'interrupted' });
    expect((await fs.readFile(recordingPath(root, id))).subarray(44)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });
  it('does not overwrite an existing final WAV and preserves the recoverable capture on finalization failure', async () => {
    const { root, id } = await fixture();
    const recording = await WavRecording.create(root, id, 'interview');
    recording.enqueue(new Uint8Array([1, 2]));
    const final = recordingPath(root, id);
    await fs.writeFile(final, 'pre-existing evidence', { flag: 'wx' });
    await expect(recording.finish()).rejects.toThrow();
    expect(await fs.readFile(final, 'utf8')).toBe('pre-existing evidence');
    expect((await fs.readFile(path.join(root, id, 'capture.part'))).subarray(44)).toEqual(Buffer.from([1, 2]));
    await expect(recoverRecording(root, id)).rejects.toThrow();
    expect(await fs.readFile(final, 'utf8')).toBe('pre-existing evidence');
  });
  it('keeps valid sessions discoverable and exposes corrupt/failed creation entries explicitly', async () => {
    const { root, id } = await fixture();
    const good = await WavRecording.create(root, id, 'interview');
    good.enqueue(new Uint8Array(32)); const info = await good.finish();
    const failed = randomUUID();
    const open = vi.spyOn(fs, 'open').mockRejectedValueOnce(new Error('fixture metadata write failure'));
    await expect(WavRecording.create(root, failed, 'interview')).rejects.toThrow('metadata');
    open.mockRestore();
    const corrupt = randomUUID(); await fs.mkdir(path.join(root, corrupt));
    await fs.writeFile(path.join(root, corrupt, 'session.json'), '{');
    const sessions = await listRecordings(root);
    expect(sessions).toContainEqual(info);
    expect(sessions.filter(value => value.unavailable)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: failed, interviewId: 'unknown', status: 'interrupted', recoverable: false }),
      expect.objectContaining({ id: corrupt, interviewId: 'unknown', status: 'interrupted', recoverable: false }),
    ]));
    expect(sessions).toHaveLength(3);
  });
  it('rejects a symlink/junction storage root even when it is empty', async () => {
    const { root, id } = await fixture();
    const actual = path.join(root, 'actual'); const link = path.join(root, 'link');
    await fs.mkdir(actual);
    await fs.symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(listRecordings(link)).rejects.toThrow('Invalid recording root');
    await expect(WavRecording.create(link, id, 'interview')).rejects.toThrow('Invalid recording root');
    expect(await fs.readdir(actual)).toEqual([]);
  });
  it('reopens audio from a child process killed without finish or cleanup', async () => {
    const { root, id } = await fixture();
    // Use the production build tool to run this module in a real independent Node process.
    const compiled = await transform(await fs.readFile(path.resolve('src/wav-recording.ts'), 'utf8'), { loader: 'ts', format: 'esm', target: 'node22' });
    const moduleFile = path.join(root, 'wav-recording.mjs'); await fs.writeFile(moduleFile, compiled.code);
    const moduleUrl = pathToFileURL(moduleFile).href;
    const code = `
      import fs from 'node:fs/promises';
      import { setTimeout as delay } from 'node:timers/promises';
      import { WavRecording } from ${JSON.stringify(moduleUrl)};
      const recording = await WavRecording.create(${JSON.stringify(root)}, ${JSON.stringify(id)}, 'interview');
      for (let n = 0; n < 10; n++) recording.enqueue(new Uint8Array(3200).fill(n));
      while ((await fs.stat(${JSON.stringify(path.join(root, id, 'capture.part'))})).size < 32044) await delay(10);
      await delay(50);
      process.stdout.write('ready');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes.toString(); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Child recording startup timed out: ${stderr}`)), 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); reject(new Error(`Child exited before termination: ${stderr}`)); });
        let stdout = '';
        child.stdout.on('data', bytes => {
          stdout += bytes.toString();
          if (stdout.includes('ready')) { clearTimeout(timer); resolve(); }
        });
      });
      child.kill('SIGKILL'); await exited;
      expect(await listRecordings(root)).toMatchObject([{ id, status: 'interrupted', recoverable: true, bytes: 32000 }]);
      expect(await recoverRecording(root, id)).toMatchObject({ id, status: 'interrupted', recoverable: false, durationMs: 1000 });
      const wav = await fs.readFile(recordingPath(root, id));
      for (let n = 0; n < 10; n++) expect(wav.subarray(44 + n * 3200, 44 + (n + 1) * 3200)).toEqual(Buffer.alloc(3200, n));
    } finally { child.kill('SIGKILL'); await exited; }
  }, 15000);
});
