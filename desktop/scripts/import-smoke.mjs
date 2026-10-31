/** Actual Electron decoding + IPC + offline ASR/diarization. Only public/generated fixtures. */
import { _electron, expect } from '@playwright/test';
import electron from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { XASR } from '../../server/dist/asr/localXasrModel.js';
const { values } = parseArgs({ options: {
  executable: { type: 'string' }, model: { type: 'string', default: `work/phase3a/ci-fixture/model/${XASR.id}` },
  speakers: { type: 'string', default: 'work/phase4/models/sherpa-onnx-pyannote-segmentation-3-0' },
  audio: { type: 'string', default: 'work/phase4/four-speakers.wav' }, out: { type: 'string', default: 'work/phase4/import-smoke' },
  mp3: { type: 'string' }, m4a: { type: 'string' },
  automatic: { type: 'boolean', default: false },
} });
const out = path.resolve(values.out); await fs.mkdir(out, { recursive: true });
const profile = await fs.mkdtemp(path.join(out, 'profile-'));
await fs.cp(path.resolve(values.model), path.join(profile, 'models', XASR.id), { recursive: true });
const brokenCache = path.join(profile, 'models/speakers-pyannote3-eres2net-v1');
await fs.mkdir(brokenCache); await fs.writeFile(path.join(brokenCache, 'retained-fixture.txt'), 'Invalid-cache recovery fixture');
const report = { actualElectron: true, mockBridge: false, publicFixturesOnly: true, networkRequests: 0, stages: [] };
let app;
try {
  const env = { ...process.env, MEETFOLIO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: values.executable ? path.resolve(values.executable) : electron, args: [...(values.executable ? [] : ['desktop']), '--verification'], env, timeout: 60000 });
  const page = await app.firstWindow();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally', { timeout: 30000 });
  await app.evaluate(({ session }) => {
    globalThis.__importNetwork = 0;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => { globalThis.__importNetwork++; callback({ cancel: true }); });
  });
  await page.getByRole('button', { name: 'Import audio', exact: true }).click();
  const region = page.getByRole('region', { name: 'Import audio recording' });
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, path.resolve(values.speakers));
  await region.getByRole('button', { name: 'Import model folder', exact: true }).click();
  await expect(region.getByText('Speaker models ready for offline use.')).toBeVisible({ timeout: 30000 });
  assert((await page.evaluate(() => window.meetfolioDesktop.getSpeakerStatus())).ready);
  const preservedCache = (await fs.readdir(path.join(profile, 'models'))).find(name => name.startsWith('speakers-pyannote3-eres2net-v1-invalid-'));
  assert(preservedCache); assert.equal(await fs.readFile(path.join(profile, 'models', preservedCache, 'retained-fixture.txt'), 'utf8'), 'Invalid-cache recovery fixture');
  report.stages.push('native speaker model folder import and pinned SHA-256 verification');
  await region.getByLabel('Choose audio recording').setInputFiles(path.resolve(values.audio));
  await region.getByLabel('Expected speakers').selectOption(values.automatic ? '-1' : '4');
  await region.getByRole('checkbox', { name: 'I have permission to process this recording locally.' }).check();
  const importStarted = Date.now();
  await region.getByRole('button', { name: 'Transcribe recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New interview', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Review original text' })).toBeVisible({ timeout: 180000 });
  const entries = await page.locator('.dt-segment').count(); assert(entries > 4);
  const labels = await page.locator('.dt-speaker-name').allTextContents();
  assert.equal(new Set(labels).size, 4);
  assert((await page.locator('.dt-transcript-play').allTextContents()).some(text => /[\u4e00-\u9fff]/u.test(text)));
  const recordings = await page.evaluate(() => window.meetfolioDesktop.listRecordings());
  assert.equal(recordings.length, 1); assert.equal(recordings[0].status, 'complete');
  assert(recordings[0].durationMs > 56000 && recordings[0].durationMs < 58000);
  report.segments = entries; report.detectedSpeakers = 4;
  report.speakerCountMode = values.automatic ? 'automatic' : 'specified: 4';
  report.elapsedSeconds = (Date.now() - importStarted) / 1000;
  report.audioSeconds = recordings[0].durationMs / 1000;
  report.realTimeFactor = report.elapsedSeconds / report.audioSeconds;
  report.stages.push('actual WebAudio WAV decode, durable PCM/WAV import, isolated native diarization and Chinese X-ASR, four speakers rendered');
  await page.getByRole('button', { name: 'Play audio for segment 1', exact: true }).click();
  const player = page.getByRole('region', { name: 'Segment audio playback' });
  await expect(player.getByRole('button', { name: 'Pause audio' })).toBeVisible();
  await player.getByRole('button', { name: 'Stop audio' }).click();
  await page.locator('.dt-speaker-name').first().click();
  await page.getByLabel('Speaker for segment 1', { exact: true }).fill('Reviewed voice');
  await page.getByRole('button', { name: 'Save speaker', exact: true }).click();
  await expect(page.locator('.dt-speaker-name').first()).toHaveText('Reviewed voice');
  await page.getByRole('button', { name: 'Edit segment 1', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit segment 1', exact: true }).fill('Public fixture: manually reviewed text.');
  await page.getByRole('button', { name: 'Save edit', exact: true }).click();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  await page.reload();
  await expect(page.locator('.dt-speaker-name').first()).toHaveText('Reviewed voice');
  await expect(page.getByRole('button', { name: 'Play audio for segment 1', exact: true })).toContainText('manually reviewed');
  report.stages.push('actual imported segment playback, text/speaker correction, persisted edits and reload');
  for (const codec of ['mp3', 'm4a']) {
    if (!values[codec]) continue;
    await page.getByRole('button', { name: 'Import audio', exact: true }).click();
    await region.getByLabel('Choose audio recording').setInputFiles(path.resolve(values[codec]));
    await region.getByRole('checkbox', { name: 'Automatically separate speakers' }).uncheck();
    await region.getByRole('checkbox', { name: 'I have permission to process this recording locally.' }).check();
    await region.getByRole('button', { name: 'Transcribe recording', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Review original text' })).toBeVisible({ timeout: 120000 });
    assert(await page.locator('.dt-segment').count() > entries);
    report.stages.push(`actual ${codec.toUpperCase()} decode, normalization and native X-ASR import`);
  }
  report.networkRequests = await app.evaluate(() => globalThis.__importNetwork); assert.equal(report.networkRequests, 0);
  // Recovering an import again must not overwrite a correction or duplicate segment IDs.
  await page.getByRole('button', { name: 'Model & Settings', exact: true }).click();
  await page.getByRole('button', { name: `Recover import text ${recordings[0].id.slice(0,8)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Model & Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play audio for segment 1', exact: true })).toContainText('manually reviewed');
  report.stages.push('durable import transcript recovery preserves existing corrected segment identities');
  // Cancel while the native diarizer is running; keep its already-finalized WAV.
  await page.getByRole('button', { name: 'Import audio', exact: true }).click();
  await region.getByLabel('Choose audio recording').setInputFiles(path.resolve(values.audio));
  await region.getByRole('checkbox', { name: 'I have permission to process this recording locally.' }).check();
  await region.getByRole('button', { name: 'Transcribe recording', exact: true }).click();
  await expect(region.getByText('Separating speakers', { exact: true })).toBeVisible({ timeout: 30000 });
  await region.getByRole('button', { name: 'Cancel processing', exact: true }).click();
  await expect(region.getByRole('alert')).toContainText('Import cancelled', { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'New interview', exact: true })).toBeEnabled();
  const retained = await page.evaluate(() => window.meetfolioDesktop.listRecordings());
  assert.equal(retained.length, 2 + Number(!!values.mp3) + Number(!!values.m4a));
  assert(retained.every(item => item.status === 'complete' && item.bytes > 0));
  report.stages.push('native inference cancellation releases controls and retains finalized audio');
  report.result = 'Passed';
} catch (error) { report.result = 'Failed'; report.error = String(error); throw error; }
finally { if (app) await app.close(); await fs.writeFile(path.join(out, 'import-smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
