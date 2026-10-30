/** Actual Electron/preload/protocol/media tests using generated tones and a private disposable profile. */
import { _electron, expect } from '@playwright/test';
import electron from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const { values } = parseArgs({ options: { executable: { type: 'string' }, out: { type: 'string', default: 'work/phase3b2/playback-smoke' } } });
const out = path.resolve(values.out); await fs.mkdir(out, { recursive: true });
const profile = await fs.mkdtemp(path.join(out, 'profile-'));
const interviewId = 'playback-fixture';
const recordings = [randomUUID(), randomUUID(), randomUUID()];
const tone = async (id, frequency, owner = interviewId) => {
  const pcm = Buffer.alloc(16000 * 2 * 5);
  for (let sample = 0; sample < pcm.length / 2; sample++) pcm.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * frequency * sample / 16000)), sample * 2);
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const dir = path.join(profile, 'recordings', id); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify({ schema: 1, id, interviewId: owner, createdAt: '2026-10-30T00:00:00Z' }));
  await fs.writeFile(path.join(dir, 'final.json'), JSON.stringify({ status: 'complete', bytes: pcm.length }));
  const wav = Buffer.concat([h, pcm]); await fs.writeFile(path.join(dir, 'recording.wav'), wav);
  return wav;
};
const originals = [await tone(recordings[0], 440), await tone(recordings[1], 660), await tone(recordings[2], 880, 'other-interview')];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { actualElectron: true, mockBridge: false, generatedAudioOnly: true, physicalAudioOutput: 'Not verified', stages: [] };
let app;
try {
  const env = { ...process.env, MEETFOLIO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: values.executable ? path.resolve(values.executable) : electron,
    args: [...(values.executable ? [] : ['desktop']), '--verification'], env, timeout: 60000 });
  const page = await app.firstWindow();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally', { timeout: 30000 });
  await page.evaluate(async ({ interviewId, recordings }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('meetfolio-desktop-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const book = await new Promise((resolve, reject) => { const r = db.transaction('notebook').objectStore('notebook').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const i = book.interviews[0]; i.id = interviewId; book.activeId = interviewId;
    i.title = 'Generated tone playback fixture'; i.stage = 'review'; i.consent = true; i.recording = 'ended';
    i.segments = Array.from({ length: 5 }, (_, n) => ({ id: `tone-${n}`, seq: n + 1, startMs: 100000 + n * 5000, endMs: 103000 + n * 5000,
      originalText: `Generated tone segment ${n + 1}`, editedText: null, speakerLabel: null, isImportant: false, source: 'local', updatedAt: i.createdAt,
      ...(n === 4 ? {} : { audio: { recordingId: recordings[n] ?? '00000000-0000-0000-0000-000000000000', startMs: 1000, endMs: 4000 } }) }));
    await new Promise((resolve, reject) => { const t = db.transaction('notebook', 'readwrite'); t.objectStore('notebook').put(book, 'current'); t.oncomplete = resolve; t.onerror = () => reject(t.error); }); db.close();
  }, { interviewId, recordings });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Review original text' })).toBeVisible();
  const contract = await page.evaluate(async ({ interviewId, id }) => {
    const api = window.meetfolioDesktop;
    const p = await api.preparePlayback({ interviewId, recordingId: id, startMs: 1000.0625, endMs: 1100.125 });
    const response = await fetch(p.url, { headers: { Range: 'bytes=40-49' } });
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    await api.releasePlayback(p.token);
    const revoked = (await fetch(p.url)).status;
    let denied = false;
    try { await api.preparePlayback({ interviewId: 'other-interview', recordingId: id, startMs: 0, endMs: 1000 }); } catch { denied = true; }
    return { durationMs: p.durationMs, status: response.status, bytes, revoked, denied };
  }, { interviewId, id: recordings[0] });
  assert.equal(contract.durationMs, 100.0625); assert.equal(contract.status, 206); assert.equal(contract.revoked, 404); assert(contract.denied);
  const expected = Buffer.alloc(4); expected.writeUInt32LE(3202);
  assert(Buffer.from(contract.bytes).equals(Buffer.concat([expected, originals[0].subarray(44 + 16001 * 2, 44 + 16001 * 2 + 6)])));
  report.stages.push('real preload IPC, exact sample slicing, byte range response, revoked capability and cross-interview denial');
  const region = page.getByRole('region', { name: 'Segment audio playback' });
  await page.getByRole('button', { name: 'Play audio for segment 1', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Pause audio' })).toBeVisible();
  await expect.poll(() => region.getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await region.getByRole('button', { name: 'Pause audio' }).click();
  await expect(region.getByRole('button', { name: 'Resume audio' })).toBeVisible();
  const paused = await region.getByRole('progressbar').getAttribute('value');
  await page.waitForTimeout(400);
  await expect(region.getByRole('progressbar')).toHaveAttribute('value', paused);
  await region.getByRole('button', { name: 'Resume audio' }).click();
  await expect(region.getByRole('button', { name: 'Pause audio' })).toBeVisible();
  await page.getByRole('button', { name: 'Play audio for segment 2', exact: true }).click();
  await expect(region.getByRole('status').first()).toHaveText('Segment 2 · playing');
  await expect(region.getByRole('status').first()).toHaveText('Segment 2 · ended', { timeout: 10000 });
  await page.getByRole('button', { name: 'Edit segment 1', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit segment 1' }).fill('Corrected generated tone text');
  await page.getByRole('button', { name: 'Save edit', exact: true }).click();
  await page.getByRole('button', { name: 'Play audio for segment 1', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Pause audio' })).toBeVisible();
  await region.getByRole('button', { name: 'Stop audio' }).click();
  await expect(region.getByRole('status')).toHaveText('Select linked transcript text to hear the original audio.');
  for (const seq of [3, 4]) {
    await page.getByRole('button', { name: `Play audio for segment ${seq}`, exact: true }).click();
    await expect(region.getByRole('alert')).toContainText('Audio unavailable');
  }
  assert.equal(await page.getByRole('button', { name: 'Play audio for segment 5', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Play audio for segment 1', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Pause audio' })).toBeVisible();
  await page.getByRole('button', { name: 'Live session', exact: false }).click();
  await expect(region).toHaveCount(0);
  const beforeReload = await page.evaluate(async ({ interviewId, recordingId }) => window.meetfolioDesktop.preparePlayback({ interviewId, recordingId, startMs: 0, endMs: 1000 }), { interviewId, recordingId: recordings[0] });
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  await page.reload();
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, beforeReload.url), 404);
  report.stages.push('actual media playback, progress, pause/resume, multi-recording switch, end/stop, edited text, missing and wrong-owner WAV, legacy text, review unmount');
  await app.close(); app = null;
  for (let n = 0; n < recordings.length; n++) assert.equal(hash(await fs.readFile(path.join(profile, 'recordings', recordings[n], 'recording.wav'))), hash(originals[n]));
  report.stages.push('native shutdown with original WAV hashes unchanged'); report.result = 'Passed';
} catch (error) { report.result = 'Failed'; throw error; }
finally {
  if (app) await app.close().catch(() => app.process().kill());
  await fs.writeFile(path.join(out, 'playback-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
