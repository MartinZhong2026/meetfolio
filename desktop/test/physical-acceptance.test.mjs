import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assessPhysicalAcceptance } from '../scripts/review-physical-acceptance.mjs';
const good = () => ({ schemaVersion: 1, source: 'manual-physical-windows-test', phase: 'completed', requestedMinutes: 65, sampleIntervalSeconds: 15,
  observedSeconds: 3900, samples: 260, zeroProcessSamples: 0,
  answers: { physicalMicrophone: 'pass', continuousTranscript: 'pass', finalFlush: 'pass', exportAndRestart: 'pass', deviceDisconnect: 'pass', sleepResume: 'pass' } });
test('complete but self-reported data requires independent review', () => {
  const result = assessPhysicalAcceptance(good());
  assert.equal(result.classification, 'ready-for-independent-review');
  assert.match(result.evidence, /self-reported/);
});
test('short simulated run never qualifies for long interview', () => {
  const report = good(); report.requestedMinutes = 10; report.observedSeconds = 600;
  assert(resultHas(report, 'No measured 60-minute continuous session'));
});
test('missing microphone or interruption check is a blocker', () => {
  const report = good(); report.answers.physicalMicrophone = 'skip'; report.answers.sleepResume = 'fail';
  assert(resultHas(report, 'Real microphone recognition not confirmed'));
  assert(resultHas(report, 'Windows sleep/resume not confirmed'));
});
test('any outage blocks uninterrupted acceptance', () => {
  const report = good(); report.zeroProcessSamples = 1;
  assert(resultHas(report, 'Application process was absent'));
});
test('a report cannot claim a long run with too few samples', () => {
  const report = good(); report.samples = 1;
  assert(resultHas(report, 'Insufficient process-health samples'));
});
test('incomplete or invalid reports fail safely', () => {
  assert.throws(() => assessPhysicalAcceptance({}), /Unsupported/);
  assert.throws(() => assessPhysicalAcceptance({ ...good(), observedSeconds: -1 }), /Invalid test duration/);
  assert(resultHas({ ...good(), phase: 'monitoring' }, 'incomplete'));
});
function resultHas(report, phrase) { return assessPhysicalAcceptance(report).blockers.some(x => x.includes(phrase)); }

test('CLI handles a Windows PowerShell UTF-8 BOM report', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-physical-'));
  try {
    const file = path.join(tmp, 'acceptance.json');
    await fs.writeFile(file, '\uFEFF' + JSON.stringify(good()), 'utf8');
    const output = execFileSync(process.execPath, [new URL('../scripts/review-physical-acceptance.mjs', import.meta.url).pathname, file], { encoding: 'utf8' });
    assert.match(output, /ready-for-independent-review/);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});
