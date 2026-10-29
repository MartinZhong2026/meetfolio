import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const XASR = Object.freeze({
  id: 'x-asr-480ms-punct-int8-2026-06-05',
  archive: 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2',
  size: 133895136,
  sha256: 'fa5f63d618e5a01526e275a358bb7772e403f84808a4769fba52cffd8160bf74',
  files: { encoder: 'encoder.int8.onnx', decoder: 'decoder.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' },
});
export const XASR_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${XASR.archive}`;
export type XAsrModelFiles = { encoder: string; decoder: string; joiner: string; tokens: string };

/** Desktop host should pass app.getPath('userData') explicitly. Never install into the app bundle. */
export function defaultXAsrRoot(): string {
  const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : (process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'Meetfolio', 'models');
}
export function modelFiles(dir: string): XAsrModelFiles {
  const files = {} as XAsrModelFiles;
  for (const [key, name] of Object.entries(XASR.files)) {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.isSymbolicLink()) throw new Error(`Invalid model file: ${name}`);
    files[key as keyof XAsrModelFiles] = file;
  }
  return files;
}

const integrityName = '.meetfolio-integrity.json';
async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
/** Called only after the pinned archive was verified and extracted into private staging. */
export async function sealModelCache(dir: string): Promise<void> {
  const files = modelFiles(dir);
  const entries: Record<string, { size: number; sha256: string }> = {};
  for (const [key, file] of Object.entries(files)) entries[key] = { size: (await fsp.stat(file)).size, sha256: await digest(file) };
  await fsp.writeFile(path.join(dir, integrityName), JSON.stringify({ model: XASR.id, files: entries }), { mode: 0o600, flag: 'wx' });
}
/** Detect accidental cache changes before loading native code. This is not a signature against the local account. */
export async function verifyModelCache(dir: string): Promise<void> {
  const files = modelFiles(dir);
  const manifest = path.join(dir, integrityName);
  const stat = await fsp.lstat(manifest).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Model cache has no verified integrity record; import or repair the official model');
  const record = JSON.parse(await fsp.readFile(manifest, 'utf8'));
  if (record?.model !== XASR.id || !record.files) throw new Error('Invalid model integrity record');
  for (const [key, file] of Object.entries(files)) {
    const expected = record.files[key];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.sha256) || expected.size !== (await fsp.stat(file)).size || expected.sha256 !== await digest(file)) {
      throw new Error('Model cache integrity mismatch; import or repair the official model');
    }
  }
}
