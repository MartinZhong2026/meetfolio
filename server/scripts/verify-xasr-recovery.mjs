/** Real pinned bytes/native engine; inject only transport interruption, never transcription. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { XAsrModelManager, verifyXAsrArchive } from '../dist/asr/xasrManager.js';
import { XASR } from '../dist/asr/localXasrModel.js';
const [archive, root, reportFile] = process.argv.slice(2);
assert(archive && root, 'Usage: verify-xasr-recovery.mjs <official archive> <disposable root> [report.json]');
await verifyXAsrArchive(archive);
const cache = path.join(root, 'cache');
await fs.mkdir(cache, { recursive: true });
// A dead process has left a lock; no manual removal should be necessary after the stale interval.
const lock = path.join(cache, '.xasr-install-lock');
await fs.mkdir(lock); const old = new Date(Date.now() - 60000); await fs.utimes(lock, old, old);
const requests = [];
let interrupt = true;
const transport = async (_url, options) => {
  const range = options.headers.Range;
  const offset = range ? Number(range.match(/^bytes=(\d+)-$/)[1]) : 0;
  requests.push({ range: range ?? null, offset });
  const source = createReadStream(archive, { start: offset, highWaterMark: 64 * 1024 });
  const body = Readable.from((async function* () {
    let sent = 0;
    for await (const chunk of source) {
      yield chunk; sent += chunk.length;
      if (interrupt && sent >= 2 * 1024 * 1024) { interrupt = false; throw new Error('Injected connection interruption'); }
    }
  })());
  return new Response(Readable.toWeb(body), { status: offset ? 206 : 200, headers: {
    'content-length': String(XASR.size - offset),
    ...(offset ? { 'content-range': `bytes ${offset}-${XASR.size - 1}/${XASR.size}` } : {}),
  } });
};
const manager = new XAsrModelManager({ root: cache, modelDir: path.join(root, 'Research Models 研究', XASR.id), fetch: transport });
const states = [];
manager.on('status', status => { if (states.at(-1) !== status.state) states.push(status.state); });
async function recognize() {
  const wav = await fs.readFile(path.join(manager.modelDir, 'test_wavs/0.wav'));
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4);
    if (name === 'data') { pcm = wav.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + size % 2;
  }
  assert(pcm?.length);
  const results = [];
  const connection = await manager.connect({ sampleRate: 16000, terms: [], languageHints: ['zh', 'en'] }, {
    onResult: result => results.push(result), onClosed: info => assert(info.clean),
  });
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    connection.sendAudio(pcm.subarray(offset, offset + 3200));
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert(await connection.finish(30000));
  assert(await connection.finish(30000), 'finish must be idempotent after process exit');
  const finals = results.filter(result => result.kind === 'final');
  assert(finals.some(result => result.text.includes('Monday')));
  assert(finals.every(result => result.endMs >= result.startMs && result.endMs <= Math.ceil(pcm.length / 32)));
  return finals;
}
try {
  await assert.rejects(manager.download(), /interruption/);
  assert.equal(manager.getStatus().state, 'download-failed');
  const retainedBytes = (await fs.stat(path.join(cache, `${XASR.id}.part`))).size;
  assert(retainedBytes > 0 && retainedBytes < XASR.size);
  await manager.download(); assert.equal(manager.getStatus().state, 'ready');
  assert.equal(requests[1].offset, retainedBytes);
  const beforeRepair = await recognize();
  // Native exit has been awaited by finish(), so Windows no longer holds model file handles.
  await fs.writeFile(path.join(manager.modelDir, XASR.files.encoder), 'damaged ONNX model');
  await assert.rejects(manager.initialize()); assert.equal(manager.getStatus().state, 'error');
  await manager.importArchive(archive, { repair: true }); assert.equal(manager.getStatus().state, 'ready');
  const afterRepair = await recognize();
  const leftovers = (await fs.readdir(path.dirname(manager.modelDir))).filter(name => /^\.xasr-(previous|stage)-/.test(name));
  assert.deepEqual(leftovers, []);
  const report = { platform: process.platform, arch: process.arch, node: process.version, model: XASR.id,
    archiveSha256: XASR.sha256, retainedBytes, requests, states, beforeRepair, afterRepair,
    transport: 'Injected interrupted HTTP-body/range response using actual verified official archive bytes; no network required',
    nativeRecognition: true, physicalMicrophone: false, windowsInstaller: false };
  console.log(JSON.stringify(report, null, 2));
  if (reportFile) await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
} finally { await manager.dispose(); }
