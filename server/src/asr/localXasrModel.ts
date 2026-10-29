import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
