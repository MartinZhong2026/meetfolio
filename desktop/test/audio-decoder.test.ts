import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AudioDecoder, decodeAudioFile, probeAudioFile } from '../src/audio-decoder';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-decoder-')); roots.push(root); return root; }
it('rejects unknown input formats before attempting to spawn a decoder', async () => {
  await expect(probeAudioFile('must-never-execute', 'unsafe.m3u8')).rejects.toThrow('Unsupported audio file');
  await expect(decodeAudioFile('must-never-execute', 'unsafe.exe', async () => {}, new AbortController().signal, () => {}, () => {})).rejects.toThrow('Unsupported audio file');
});
it('rejects empty input and cancellation without executing an unverified path', async () => {
  const file = path.join(await fixture(), 'empty.wav'); await fs.writeFile(file, '');
  await expect(decodeAudioFile('must-never-execute', file, async () => {}, new AbortController().signal, () => {}, () => {})).rejects.toThrow('2 GiB');
  await fs.writeFile(file, 'not audio'); const controller = new AbortController(); controller.abort();
  await expect(decodeAudioFile('must-never-execute', file, async () => {}, controller.signal, () => {}, () => {})).rejects.toThrow();
});
it.runIf(process.platform === 'win32' && process.arch === 'x64')('refuses a corrupt offline archive and preserves the previous cache', async () => {
  const root = await fixture(); const decoder = new AudioDecoder(root);
  await fs.mkdir(decoder.directory); await fs.writeFile(path.join(decoder.directory, 'ffmpeg.exe'), 'invalid old cache');
  const archive = path.join(root, 'untrusted.zip'); await fs.writeFile(archive, 'not the pinned upstream archive');
  expect(await decoder.ready()).toBe(false);
  await expect(decoder.install(archive)).rejects.toThrow('verifying archive: checksum mismatch');
  expect(await fs.readFile(path.join(decoder.directory, 'ffmpeg.exe'), 'utf8')).toBe('invalid old cache');
  expect(await fs.readFile(archive, 'utf8')).toBe('not the pinned upstream archive');
  expect((await fs.readdir(root)).sort()).toEqual([path.basename(decoder.directory), 'untrusted.zip'].sort());
  expect(decoder.busy).toBe(false);
});
it.runIf(process.platform === 'win32' && process.arch === 'x64')('cleans a rejected partial download without installing executable bytes', async () => {
  const root = await fixture(); const decoder = new AudioDecoder(root, (async () => new Response('truncated download')) as typeof fetch);
  await expect(decoder.install()).rejects.toThrow('checksum mismatch');
  expect(await fs.readdir(root)).toEqual([]); expect(decoder.busy).toBe(false); expect(await decoder.ready()).toBe(false);
});
it.runIf(process.platform === 'win32' && process.arch === 'x64')('cancels an unfinished download and releases setup controls without installing it', async () => {
  const root = await fixture(); let announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const decoder = new AudioDecoder(root, (async () => {
    announce(); return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); } }));
  }) as typeof fetch);
  const operation = decoder.install(); const failure = expect(operation).rejects.toThrow('downloading archive');
  await started; decoder.cancel(); await failure;
  expect(decoder.busy).toBe(false); expect(await decoder.ready()).toBe(false); expect(await fs.readdir(root)).toEqual([]);
});
