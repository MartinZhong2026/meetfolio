/** Downloads only the pinned official archive into ignored test work space. No interview data. */
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { XASR, XASR_URL } from '../../server/dist/asr/localXasrModel.js';
import { XAsrModelManager, verifyXAsrArchive } from '../../server/dist/asr/xasrManager.js';

const out = path.resolve('work/phase3a/ci-fixture'); await fs.mkdir(out, { recursive: true });
const archive = path.join(out, 'official-model.tar.bz2');
try { await verifyXAsrArchive(archive); }
catch {
  const response = await fetch(XASR_URL, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error('Official test model download failed');
  const temporary = archive + '.part';
  const existing = await fs.lstat(temporary).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Unsafe fixture output');
  let bytes = 0;
  const bounded = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length; callback(bytes > XASR.size ? new Error('Official model download exceeds pinned size') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(temporary, { mode: 0o600 }));
  await verifyXAsrArchive(temporary);
  await fs.rename(temporary, archive);
}
const manager = new XAsrModelManager({ root: path.join(out, 'model'), fetch: async () => { throw new Error('Fixture inference must remain offline'); } });
try { await manager.importArchive(archive); }
finally { await manager.dispose(); }
const audio = path.join(out, 'model', XASR.id, 'test_wavs/0.wav');
await fs.stat(audio);
await fs.writeFile(path.join(out, 'fixture.json'), JSON.stringify({ archive, audio }, null, 2));
console.log('Pinned official test fixture verified and native model initialized; no physical microphone tested');
