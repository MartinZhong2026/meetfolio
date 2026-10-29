/** Real artifact/native smoke. Requires a built server and an already downloaded pinned archive. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { XAsrModelManager } from '../dist/asr/xasrManager.js';
import { XASR, sealModelCache } from '../dist/asr/localXasrModel.js';
import { LocalXAsrProvider } from '../dist/asr/localXasr.js';
const [archive, root, reportFile] = process.argv.slice(2);
assert(archive && root, 'Usage: node server/scripts/verify-xasr.mjs <pinned archive> <empty app-data directory> [report.json]');
let native;
const manager = new XAsrModelManager({ root, fetch: async () => { throw new Error('Network forbidden during offline verification'); },
  provider: dir => (native = new LocalXAsrProvider(dir)),
});
const states = [manager.getStatus().state], results = [];
manager.on('status', s => { states.push(s.state); console.log(s.state); });
const report = { platform: process.platform, arch: process.arch, node: process.version, runtime: '1.13.8', tests: [] };
function pcm16(wav) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  let pcm, format;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4);
    assert(offset + 8 + size <= wav.length, 'truncated WAV');
    const data = wav.subarray(offset + 8, offset + 8 + size);
    if (name === 'fmt ') { assert(size >= 16); format = [data.readUInt16LE(0), data.readUInt16LE(2), data.readUInt32LE(4), data.readUInt16LE(14)]; }
    if (name === 'data') pcm = data;
    offset += 8 + size + size % 2;
  }
  assert.deepEqual(format, [1, 1, 16000, 16], 'Use PCM16 mono 16 kHz WAV'); assert(pcm?.length); return pcm;
}
try {
  // Manual import verifies the official checksum, safely extracts, atomically installs and really loads.
  await manager.importArchive(archive);
  assert.equal(manager.getStatus().state, 'ready');
  assert(states.includes('installed') && states.includes('loading'));
  const fragments = ['Monday', 'always', 'frequently', '时态'];
  for (let n = 0; n < 4; n++) {
    const pcm = pcm16(await fs.readFile(path.join(manager.modelDir, `test_wavs/${n}.wav`)));
    const events = [], start = performance.now();
    let hostTicks = 0;
    const timer = setInterval(() => hostTicks++, 20);
    try {
      const connection = await manager.connect({ sampleRate: 16000, terms: [], languageHints: ['zh', 'en'] }, {
        onResult: event => events.push(event), onClosed: info => assert(info.clean, 'unexpected native close'),
      });
      for (let offset = 0; offset < pcm.length; offset += 3200) {
        connection.sendAudio(pcm.subarray(offset, offset + 3200));
        // Replay at 2x; use the same 100ms PCM frames as MicCapture.
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(await connection.finish(30000), 'final flush must be acknowledged');
      const finals = events.filter(event => event.kind === 'final');
      const text = finals.map(event => event.text).join(' ');
      assert(text.includes(fragments[n]), `sample ${n} must recognize its reference fragment`);
      assert(events.some(event => event.kind === 'interim'), 'partial results required');
      assert(finals.length && new Set(finals.map(event => event.key)).size === finals.length);
      assert(finals.every(event => event.startMs >= 0 && event.endMs >= event.startMs && event.endMs <= Math.ceil(pcm.length / 32)));
      assert(hostTicks > 0, 'host must remain responsive during inference');
      report.tests.push({ sample: n, audioMs: pcm.length / 32, elapsedMs: Math.round(performance.now() - start), text,
        partials: events.filter(event => event.kind === 'interim').length, finals, hostTicks,
        hostRss: process.memoryUsage().rss, nativeMetrics: native.lastMetrics });
      results.push(text);
    } finally { clearInterval(timer); }
  }
  // Invalid ONNX may cause the upstream C++ runtime to exit/abort: the host must survive and never show Ready.
  const invalidDir = path.join(root, 'invalid-model-fixture');
  await fs.mkdir(invalidDir, { recursive: true });
  for (const file of Object.values(XASR.files)) await fs.writeFile(path.join(invalidDir, file), 'invalid native model fixture');
  await sealModelCache(invalidDir);
  const failedStates = [];
  const failed = new XAsrModelManager({ root: path.join(root, 'failure'), modelDir: invalidDir });
  failed.on('status', s => failedStates.push(s.state));
  await assert.rejects(failed.initialize());
  assert.equal(failed.getStatus().state, 'error');
  assert(!failedStates.includes('ready'));
  // Repair the model directory and retry in the same manager to verify recovery.
  for (const file of Object.values(XASR.files)) await fs.copyFile(path.join(manager.modelDir, file), path.join(invalidDir, file));
  await fs.rm(path.join(invalidDir, '.meetfolio-integrity.json'));
  await sealModelCache(invalidDir);
  await failed.initialize(); assert.equal(failed.getStatus().state, 'ready');
  await failed.dispose();
  report.failureRecoveryStates = failedStates;
  report.states = states;
  report.network = 'Transport disabled in manager; run this script in a network-disabled OS/container for stronger evidence';
  report.reference = 'Fragment smoke assertions only; this is not a WER/CER accuracy benchmark';
  console.log(JSON.stringify(report, null, 2));
  if (reportFile) await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
} finally { await manager.dispose(); }
