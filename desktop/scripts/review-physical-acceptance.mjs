/** Review a user's manual Windows test report without accessing any research content. */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function assessPhysicalAcceptance(report) {
  if (!report || report.schemaVersion !== 1 || report.source !== 'manual-physical-windows-test') {
    throw new Error('Unsupported or incomplete physical-test report');
  }
  const blockers = [];
  const requested = Number(report.requestedMinutes);
  const observed = Number(report.observedSeconds);
  if (!Number.isFinite(requested) || requested < 1 || requested > 120 || !Number.isFinite(observed) || observed < 0) {
    throw new Error('Invalid test duration');
  }
  if (report.phase !== 'completed') blockers.push('Session report is incomplete');
  if (requested < 60 || observed < 60 * 60 * 0.95) blockers.push('No measured 60-minute continuous session');
  const interval = Number(report.sampleIntervalSeconds);
  if (!Number.isFinite(interval) || interval < 5 || interval > 120 || !Number.isInteger(report.samples) || report.samples < 1 ||
      report.samples < Math.floor((observed / interval) * 0.8)) {
    blockers.push('Insufficient process-health samples for the stated monitoring duration');
  }
  if (!Number.isInteger(report.zeroProcessSamples) || report.zeroProcessSamples > 0) blockers.push('Application process was absent during monitoring or count was invalid');
  const mandatory = {
    physicalMicrophone: 'Real microphone recognition not confirmed',
    continuousTranscript: 'Continuous transcript not confirmed',
    finalFlush: 'Final audio flush/correction not confirmed',
    exportAndRestart: 'Export and restart persistence not confirmed',
    deviceDisconnect: 'Physical device disconnect/reconnect not confirmed',
    sleepResume: 'Windows sleep/resume not confirmed',
  };
  for (const [key, label] of Object.entries(mandatory)) {
    if (report.answers?.[key] !== 'pass') blockers.push(label);
  }
  return {
    classification: blockers.length ? 'needs-further-physical-verification' : 'ready-for-independent-review',
    evidence: 'self-reported human observations and process metrics, not a CI/hardware attestation',
    blockers,
    requestedMinutes: requested,
    observedMinutes: Math.round(observed / 60 * 10) / 10,
  };
}

const currentFile = pathToFileURL(path.resolve(process.argv[1] || '')).href;
if (currentFile === import.meta.url) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node desktop/scripts/review-physical-acceptance.mjs acceptance.json'); process.exitCode = 2; }
  else {
    try {
      const verdict = assessPhysicalAcceptance(JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
      console.log(JSON.stringify(verdict, null, 2));
      if (verdict.blockers.length) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 2; }
  }
}
