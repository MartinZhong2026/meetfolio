/** Public fixtures and pinned model assets only; everything is kept in ignored work/. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extractXAsrArchive } from '../../server/dist/asr/xasrArchive.js';
const require = createRequire(import.meta.url);
const { SpeakerModels } = require('../../work/desktop-runtime/xasr/asr/speaker-models.cjs');
const root = path.resolve('work/phase4/ci-fixture'); await fs.mkdir(root, { recursive: true });
const models = new SpeakerModels(root, extractXAsrArchive); await models.install();
const audio = path.join(root, 'four-speakers.wav');
const expected = 'bedf036caed208386c67b4ef4b11f83d74dd0d420b102163a1c33cd09cde7010';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(await fs.readFile(audio).catch(() => Buffer.alloc(0))) !== expected) {
  const response = await fetch('https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/0-four-speakers-zh.wav', { signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error('Public diarization fixture download failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 3 * 1024 * 1024) throw new Error('Fixture too large'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks); if (hash(bytes) !== expected) throw new Error('Public fixture checksum mismatch');
  await fs.writeFile(audio, bytes);
}
await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({ speakers: models.directory, audio }, null, 2));
console.log('Pinned speaker models and public four-speaker WAV verified; no interview data');
