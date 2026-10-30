/** Real Electron + preload + optional file-backed microphone. Never uses the user's ordinary profile. */
import { _electron, expect } from '@playwright/test';
import electron from 'electron';
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';

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
  instance.process().once('exit', code => console.log(`Verification Electron exited: ${code}`));
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
    console.log('First native capture paused and WAV finalized');
    const firstRecordings = await page.evaluate(() => window.meetfolioDesktop.listRecordings());
    assert.equal(firstRecordings.length, 1);
    assert.equal(firstRecordings[0].status, 'complete');
    assert(firstRecordings[0].bytes > 0 && firstRecordings[0].durationMs === firstRecordings[0].bytes / 32);
    await expect(page.getByText(/^WAV .*file time/).first()).toBeVisible();
    let evidence = await page.locator('.dt-segment').count(); assert(evidence > 0);
    await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('Transcribing locally', { timeout: 45000 });
    console.log('Second native capture started');
    await expect.poll(() => page.locator('.dt-segment').count(), { timeout: 60000 }).toBeGreaterThan(evidence);
    await page.getByRole('button', { name: 'Finish & review', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Review original text' })).toBeVisible({ timeout: 30000 });
    evidence = await page.locator('.dt-segment').count();
    report.segmentCount = evidence; report.nativeInference = 'Passed with public file-backed test audio; no physical microphone';
    report.stages.push('real model import/hash verification, AudioWorklet capture, native CPU inference, rendered transcript, pause/resume and final stop');
    const recordings = await page.evaluate(() => window.meetfolioDesktop.listRecordings());
    assert.equal(recordings.length, 2); assert(recordings.every(item => item.status === 'complete' && item.bytes > 0));
    const exported = path.join(out, 'public-fixture-recording.wav');
    await instance.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, exported);
    assert.equal(await page.evaluate(id => window.meetfolioDesktop.exportRecording(id), recordings[0].id), true);
    const wav = await fs.readFile(exported);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.length, recordings[0].bytes + 44); assert.equal(wav.readUInt32LE(40), recordings[0].bytes);
    assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readUInt16LE(22), 1);
    report.stages.push('two independent sample-counted WAV captures, transcript audio identities, and native file-dialog WAV export');
    await instance.close(); instance = null;
    page = await launch();
    const restored = await page.evaluate(() => window.meetfolioDesktop.getModelStatus());
    assert(restored.engineLoaded && restored.offline);
    await expect(page.locator('.dt-segment')).toHaveCount(evidence);
    assert.deepEqual(await page.evaluate(() => window.meetfolioDesktop.listRecordings()), recordings);
    report.stages.push('normal shutdown and restart preserved model cache and confirmed fixture transcript');
    // Start another fictional capture then terminate the host without its save/stop handshake.
    await page.getByRole('button', { name: 'Live session', exact: false }).click();
    await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('Transcribing locally', { timeout: 45000 });
    await expect.poll(async () => (await page.evaluate(() => window.meetfolioDesktop.listRecordings())).find(item => item.status === 'recording')?.bytes ?? 0).toBeGreaterThan(32000);
    const child = instance.process();
    // Wait for inherited Chromium handles as well as the host. On Windows terminate only
    // this isolated test process tree; surviving GPU processes can retain profile locks.
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Verification process tree did not close')), 15000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    if (process.platform === 'win32') {
      // taskkill /T can terminate the ASR/renderer first, allowing Main to finalize an interrupted WAV.
      // Snapshot this isolated tree, kill Main first, then clean up only its known descendants.
      const processes = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { windowsHide: true, encoding: 'utf8' }));
      const owned = new Set([child.pid]);
      let added = true;
      while (added) { added = false; for (const proc of processes) if (owned.has(proc.ParentProcessId) && !owned.has(proc.ProcessId)) { owned.add(proc.ProcessId); added = true; } }
      child.kill('SIGKILL');
      for (const pid of [...owned].reverse().filter(pid => pid !== child.pid)) {
        try { process.kill(pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    } else child.kill('SIGKILL');
    await exited; instance = null;
    page = await launch();
    const interrupted = (await page.evaluate(() => window.meetfolioDesktop.listRecordings())).find(item => item.recoverable);
    assert(interrupted && interrupted.status === 'interrupted' && interrupted.bytes > 0);
    const recovered = await page.evaluate(id => window.meetfolioDesktop.recoverRecording(id), interrupted.id);
    assert.equal(recovered.bytes, interrupted.bytes); assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.recoverable, false);
    assert.deepEqual(await page.evaluate(id => window.meetfolioDesktop.recoverRecording(id), interrupted.id), recovered);
    report.stages.push('forced host termination, restart discovery and explicit non-overwriting recovery of saved partial WAV; missing tail not claimed recovered');
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
