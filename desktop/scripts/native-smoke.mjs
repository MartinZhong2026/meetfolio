/** Real Electron + preload + optional file-backed microphone. Never uses the user's ordinary profile. */
import { _electron, expect } from '@playwright/test';
import electron from 'electron';
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const { values } = parseArgs({ options: { executable: { type: 'string' }, archive: { type: 'string' }, audio: { type: 'string' }, out: { type: 'string', default: 'work/phase3a' } } });
assert.equal(!!values.archive, !!values.audio, 'Supply both the verified model archive and a public test WAV, or neither');
const out = path.resolve(values.out); await fs.mkdir(out, { recursive: true });
const profile = await fs.mkdtemp(path.join(out, 'profile-'));
const report = { platform: process.platform, actualElectron: true, mockBridge: false, physicalMicrophone: false,
  longSession: 'Not verified', nativeInference: 'Not run', stages: [] };
let instance;
const launch = async () => {
  const env = { ...process.env, MEETFOLIO_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  instance = await _electron.launch({ executablePath: values.executable ? path.resolve(values.executable) : electron, args: [...(values.executable ? [] : ['desktop']), '--verification',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(values.audio ? [`--use-file-for-fake-audio-capture=${path.resolve(values.audio)}`] : [])], env, timeout: 60000 });
  const page = await instance.firstWindow();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally', { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => ({ node: typeof window.require, bridge: window.meetfolioDesktop?.version, secure: isSecureContext })),
    { node: 'undefined', bridge: 1, secure: true });
  const state = await instance.evaluate(({ BrowserWindow, app }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    const load = process.getBuiltinModule('module').createRequire(app.isPackaged ? process.resourcesPath + '/xasr/package.json' : process.cwd() + '/package.json');
    return { isolation: prefs.contextIsolation, sandbox: prefs.sandbox, node: prefs.nodeIntegration,
      native: typeof load('sherpa-onnx-node').OnlineRecognizer, profile: app.getPath('userData'), electron: process.versions.electron, packaged: app.isPackaged };
  });
  assert.equal(state.profile, profile); assert.equal(state.native, 'function');
  assert.equal(state.packaged, !!values.executable); report.packaged = state.packaged;
  assert(state.isolation && state.sandbox && !state.node);
  report.electron = state.electron;
  await instance.evaluate(({ session }) => {
    globalThis.__phase3aNetworkAttempts = 0;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
      globalThis.__phase3aNetworkAttempts++; callback({ cancel: true });
    });
  });
  report.network = 'Electron HTTP/WebSocket requests blocked during verification; not an OS firewall test';
  report.stages.push('actual Electron, sandboxed preload, secure app protocol and native module import');
  return page;
};
try {
  let page = await launch();
  const duplicateEnv = { ...process.env, MEETFOLIO_USER_DATA: profile }; delete duplicateEnv.ELECTRON_RUN_AS_NODE;
  const duplicate = spawn(values.executable ? path.resolve(values.executable) : electron,
    [...(values.executable ? [] : ['desktop']), '--verification'], { env: duplicateEnv, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { duplicate.kill(); reject(new Error('Second instance did not exit')); }, 10000);
    duplicate.once('error', error => { clearTimeout(deadline); reject(error); });
    duplicate.once('exit', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error('Second instance failed')); });
  });
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  report.stages.push('second instance exited without creating another recording window');
  assert.equal((await page.evaluate(() => window.meetfolioDesktop.getModelStatus())).state, 'missing');
  report.stages.push('fresh profile reports missing model without touching ordinary application data');
  if (values.archive) {
    // Only the native file-picker response is supplied by the test; IPC, model install and inference are real.
    await instance.evaluate(({ dialog }, archive) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] }); }, path.resolve(values.archive));
    await page.evaluate(() => window.meetfolioDesktop.importModel());
    const model = await page.evaluate(() => window.meetfolioDesktop.getModelStatus());
    assert(model.engineLoaded && model.offline && model.state === 'installed');
    await page.getByLabel('Interview topic', { exact: true }).fill('Public fixture native smoke');
    await page.getByRole('checkbox', { name: 'I have obtained informed recording consent from the participant (required)' }).check();
    await page.getByRole('button', { name: 'Start live interview' }).last().click();
    await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('Transcribing locally', { timeout: 45000 });
    await expect(page.locator('.dt-segment').first()).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'Pause transcription', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('Paused', { timeout: 30000 });
    let evidence = await page.locator('.dt-segment').count(); assert(evidence > 0);
    await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('Transcribing locally', { timeout: 45000 });
    await expect.poll(() => page.locator('.dt-segment').count(), { timeout: 60000 }).toBeGreaterThan(evidence);
    await page.getByRole('button', { name: 'Finish & review', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Review original text' })).toBeVisible({ timeout: 30000 });
    evidence = await page.locator('.dt-segment').count();
    report.segmentCount = evidence; report.nativeInference = 'Passed with public file-backed test audio; no physical microphone';
    report.stages.push('real model import/hash verification, AudioWorklet capture, native CPU inference, rendered transcript, pause/resume and final stop');
    await instance.close(); instance = null;
    page = await launch();
    const restored = await page.evaluate(() => window.meetfolioDesktop.getModelStatus());
    assert(restored.engineLoaded && restored.offline);
    await expect(page.locator('.dt-segment')).toHaveCount(evidence);
    report.stages.push('normal shutdown and restart preserved model cache and confirmed fixture transcript');
  }
  assert.equal(await instance.evaluate(() => globalThis.__phase3aNetworkAttempts), 0, 'Unexpected network attempt in offline workflow');
  await instance.close(); instance = null;
  report.result = 'Passed';
} catch (error) {
  report.result = 'Failed'; throw error;
} finally {
  if (instance) await instance.close().catch(() => instance.process().kill());
  // This report contains counts/statuses only. Do not copy the disposable notebook or stderr into source control.
  await fs.writeFile(path.join(out, 'native-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
