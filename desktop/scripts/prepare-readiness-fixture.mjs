/** Downloads the pinned upstream decoder only into ignored CI work space. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { AudioDecoder } = createRequire(import.meta.url)('../../work/desktop-runtime/xasr/asr/audio-decoder.cjs');
const root = path.resolve('work/phase4-1/ci-decoder');
const decoder = new AudioDecoder(root); await decoder.install();
await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({ archive: path.join(decoder.directory,'upstream.zip'), executable: await decoder.executable() },null,2));
console.log('Pinned upstream decoder verified in disposable CI cache; no audio uploaded');
