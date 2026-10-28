/** Actual Electron/packaged application verification. No mock ASR; fake microphone plays official public speech. */
import { _electron, expect } from '@playwright/test';
import electron from 'electron';
import fuses from '@electron/fuses';
const { getCurrentFuseWire, FuseV1Options } = fuses;
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { values } = parseArgs({ options: {
  executable: { type: 'string' }, archive: { type: 'string' }, audio: { type: 'string' }, profile: { type: 'string' },
  out: { type: 'string', default: 'work/electron-verification' }, 'import-only': { type: 'boolean', default: false },
  'after-update': { type: 'boolean', default: false },
  'block-network': { type: 'boolean', default: false },
} });
assert(values.profile && (values['after-update'] || (values.archive && values.audio)), 'Supply a disposable --profile, official --archive and --audio sample');
const out = path.resolve(values.out); await fs.mkdir(out, { recursive: true });
const executable = values.executable ? path.resolve(values.executable) : electron;
const fuse = await getCurrentFuseWire(executable);
assert.equal(fuse[FuseV1Options.RunAsNode], '1'.charCodeAt(0), 'Native fork requires Electron RunAsNode');
const args = [ ...(values.executable ? [] : ['desktop']), '--verification', '--disable-dev-shm-usage',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ...(values.audio ? [`--use-file-for-fake-audio-capture=${path.resolve(values.audio)}`] : []), '--autoplay-policy=no-user-gesture-required' ];
let app;
let firewall = null;
const powershellQuote = value => "'" + value.replace(/'/g, "''") + "'";
const report = { platform: process.platform, packaged: !!values.executable, executable, nativeAsr: true,
  microphone: 'Chromium file-backed microphone using official X-ASR speech WAV; no physical hardware',
  physicalMicrophone: false, longInterviewQualified: false, runAsNode: true, linuxVerificationNoSandbox: process.platform === 'linux', stages: [] };
const launch = async () => {
  const environment = { ...process.env, MEETFOLIO_USER_DATA: path.resolve(values.profile) };
  if (process.platform === 'win32') {
    for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    environment.Path = path.join(windows, 'System32') + ';' + windows;
    report.applicationPathExcludesDeveloperTools = true;
  }
  const instance = await _electron.launch({ executablePath: executable, args,
    env: environment, timeout: 60000 });
  instance.process().stderr.on('data', chunk => { void fs.appendFile(path.join(out, 'electron-stderr.txt'), chunk); });
  const page = await instance.firstWindow();
  page.on('pageerror', error => { void fs.appendFile(path.join(out, 'page-errors.txt'), String(error) + '\n'); });
  await expect(page.getByTestId('desktop-save-status')).toHaveText('已保存到本机', { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => ({ node: typeof window.require, runtime: window.meetfolioDesktop?.version, secure: isSecureContext })),
    { node: 'undefined', runtime: 1, secure: true });
  const prefs = await instance.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, isolation: p.contextIsolation, node: p.nodeIntegration };
  });
  assert.deepEqual(prefs, { sandbox: true, isolation: true, node: false });
  return { instance, page };
};
const saved = page => expect(page.getByTestId('desktop-save-status')).toHaveText('已保存到本机', { timeout: 20000 });
async function screenshot(page, name, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await page.screenshot({ path: path.join(out, `${name}-${width}.png`), timeout: 60000 });
}
try {
  let current = await launch(); app = current.instance; let page = current.page;
  if (values['after-update']) {
    await expect(page.locator('body')).toContainText('离线访谈 · 安装验证');
    await expect(page.locator('body')).toContainText('研究观察：升级后应保留。');
    await expect(page.locator('body')).toContainText('已复核：');
    const status = await page.evaluate(() => window.meetfolioDesktop.getModelStatus());
    assert(status.offline && status.engineLoaded && status.state === 'installed');
    await expect(page.getByLabel('新研究笔记', { exact: true })).toHaveValue('退出瞬间的研究草稿');
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('记录已中断');
    report.stages.push('reinstalled binary preserved notebook, corrections, notes, unsaved draft, model and interrupted state');
  } else {
    await page.getByRole('button', { name: '新建访谈', exact: true }).click();
    await page.getByLabel('访谈主题', { exact: true }).fill('离线访谈 · 安装验证');
    await page.getByLabel('访谈参与者（姓名、身份或匿名编号）', { exact: true }).fill('张老师、P07');
    await page.getByLabel('访谈提纲（每行一个问题）', { exact: true }).fill('1. 请介绍这次经历。\n2. 还有哪些需要补充的内容？');
    await page.getByRole('checkbox', { name: '已取得参与者的录音知情同意（真实录音前必需）' }).check();
    await saved(page);
    await app.evaluate(({ dialog }, archive) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] }); }, path.resolve(values.archive));
    if (!values['import-only']) {
      await page.getByRole('button', { name: '下载免费语音模型', exact: true }).click();
      await expect(page.getByRole('progressbar')).toHaveAttribute('value', /[1-9]/, { timeout: 60000 });
      await page.getByRole('button', { name: '取消下载', exact: true }).click();
      await expect(page.getByRole('button', { name: '导入官方模型', exact: true })).toBeEnabled({ timeout: 30000 });
      report.stages.push('automatic official model download and cancellation through native UI');
    }
    await expect(page.getByRole('button', { name: '导入官方模型', exact: true })).toBeEnabled({ timeout: 45000 });
    await page.getByRole('button', { name: '导入官方模型', exact: true }).click();
    await expect(page.getByText('X-ASR Ready · 离线', { exact: true }).first()).toBeVisible({ timeout: 180000 });
    report.stages.push('native file picker import, integrity verification, installation and actual initialization');
    if (!values['import-only']) {
      await page.getByRole('button', { name: '修复模型', exact: true }).click();
      await expect(page.getByRole('button', { name: '修复模型', exact: true })).toBeEnabled({ timeout: 180000 });
      await expect(page.getByText('X-ASR Ready · 离线', { exact: true }).first()).toBeVisible({ timeout: 180000 });
      report.stages.push('official download resumes retained bytes and repairs/reinitializes existing model');
    }
    if (values['block-network']) {
      assert.equal(process.platform, 'win32'); assert(values.executable, 'Firewall check requires the installed application');
      firewall = 'MeetfolioVerify-' + randomUUID();
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `New-NetFirewallRule -DisplayName ${powershellQuote(firewall)} -Direction Outbound -Program ${powershellQuote(executable)} -Action Block -Profile Any | Out-Null`]);
      const blocked = await app.evaluate(async ({ net }) => {
        try { await net.fetch('https://github.com/k2-fsa/sherpa-onnx', { signal: AbortSignal.timeout(8000) }); return false; }
        catch { return true; }
      });
      assert(blocked, 'Installed app must be unable to fetch externally under its outbound firewall rule');
      report.stages.push('Windows outbound firewall blocks network for the installed app and its native helper before transcription');
    }
    await screenshot(page, 'prepare', 1366, 768);
    await page.getByRole('button', { name: '进入实时访谈', exact: true }).last().click();
    await expect(page.getByRole('button', { name: '结束并复核', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '开始本地转录', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('本地转录中', { timeout: 45000 });
    await expect(page.getByTestId('native-partial')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.dt-segment').filter({ hasText: 'Monday' }).first()).toBeVisible({ timeout: 60000 });
    // Kill the real native child. The host keeps capture and replays only unconfirmed audio.
    const count = await page.locator('.dt-segment').count();
    await app.evaluate(() => {
      const children = process._getActiveHandles().filter(handle => handle.constructor.name === 'ChildProcess' && handle.spawnargs?.some(arg => String(arg).includes('localXasrWorker.js')));
      if (children.length !== 1) throw new Error(`Expected one native inference child, found ${children.length}`);
      children[0].kill();
    });
    await expect.poll(() => page.locator('.dt-segment').count(), { timeout: 60000 }).toBeGreaterThan(count);
    await page.getByRole('button', { name: '暂停转录', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('已暂停', { timeout: 45000 });
    report.stages.push('actual partial/final CPU inference; native child termination/replay; capture pause and final flush');
    await page.getByLabel('新研究笔记', { exact: true }).fill('研究观察：升级后应保留。');
    await page.getByRole('combobox', { name: '笔记类别', exact: true }).selectOption('observation');
    await page.getByRole('button', { name: '保存这条笔记', exact: true }).click();
    const original = await page.locator('.dt-segment').first().locator('.dt-bubble > p').innerText();
    await page.getByRole('button', { name: '编辑片段 1', exact: true }).click();
    await page.getByLabel('修订片段 1', { exact: true }).fill('已复核：' + original);
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await saved(page);
    await screenshot(page, 'live', 1366, 768); await screenshot(page, 'live', 1920, 1080);
    await page.getByRole('button', { name: '开始本地转录', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('本地转录中', { timeout: 45000 });
    await page.getByRole('button', { name: '结束并复核', exact: true }).click();
    await expect(page.getByRole('button', { name: '导出 TXT', exact: true })).toBeVisible({ timeout: 45000 });
    await expect(page.locator('body')).toContainText('研究观察：升级后应保留。');
    await expect(page.locator('body')).toContainText('已复核：');
    await app.evaluate(({ dialog }, directory) => {
      dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: directory + '/' + options.defaultPath });
    }, out);
    for (const format of ['TXT', 'Markdown', 'DOCX']) {
      await page.getByRole('button', { name: `导出 ${format}`, exact: true }).click();
      const extension = { TXT: '.txt', Markdown: '.md', DOCX: '.docx' }[format];
      await expect.poll(async () => (await fs.readdir(out)).some(file => file.startsWith('Meetfolio-') && file.endsWith(extension)), { timeout: 30000 }).toBe(true);
      const file = (await fs.readdir(out)).find(file => file.startsWith('Meetfolio-') && file.endsWith(extension));
      const bytes = await fs.readFile(path.join(out, file)); assert(bytes.length > 20);
      if (format !== 'DOCX') { assert(bytes.toString('utf8').includes('已复核：')); assert(bytes.toString('utf8').includes('研究观察：升级后应保留。')); }
      else { const zip = await JSZip.loadAsync(bytes); const xml = await zip.file('word/document.xml').async('string'); assert(xml.includes('已复核：')); assert(xml.includes('研究观察：升级后应保留。')); }
    }
    const segments = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('meetfolio-desktop-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const book = await new Promise((resolve, reject) => { const request = db.transaction('notebook').objectStore('notebook').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close(); return book.interviews.find(interview => interview.id === book.activeId).segments;
    });
    assert(segments.length >= 2 && new Set(segments.map(segment => segment.id)).size === segments.length);
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      assert(segment.source === 'local' && Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.endMs >= segment.startMs && segment.startMs >= 0);
      if (index) assert(segment.startMs >= segments[index - 1].endMs - 1, 'recovery/resume timestamps must not overlap');
    }
    assert(segments[0].originalText.includes('Monday') && segments[0].editedText.startsWith('已复核：'));
    report.timestamps = segments.map(({ seq, startMs, endMs }) => ({ seq, startMs, endMs }));
    report.stages.push('notes/categories, preserved originals, nonoverlapping recovery/resume timestamps and TXT/Markdown/DOCX content');
    await screenshot(page, 'review', 1920, 1080);
    await saved(page);
    await page.getByRole('button', { name: '← 返回转录', exact: true }).click();
    await page.getByRole('button', { name: '开始本地转录', exact: true }).click();
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('本地转录中', { timeout: 45000 });
    await page.getByLabel('新研究笔记', { exact: true }).fill('退出瞬间的研究草稿');
    const closingProcess = app.process();
    await app.evaluate(({ BrowserWindow }) => { setImmediate(() => BrowserWindow.getAllWindows()[0].close()); });
    await expect.poll(() => closingProcess.exitCode, { timeout: 60000 }).toBe(0);
    app = null;
    current = await launch(); app = current.instance; page = current.page;
    await expect(page.locator('body')).toContainText('研究观察：升级后应保留。');
    await expect(page.locator('body')).toContainText('已复核：');
    await expect(page.getByLabel('新研究笔记', { exact: true })).toHaveValue('退出瞬间的研究草稿');
    await expect(page.getByTestId('desktop-recording-status')).toHaveText('记录已中断');
    report.stages.push('native window close while recording flushed native finals and the last unsaved draft; restart preserved notebook/model with an explicit interruption');
  }
  report.result = 'passed';
  await fs.writeFile(path.join(out, values['after-update'] ? 'after-update.json' : 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await fs.writeFile(path.join(out, 'failure-body.txt'), await page.locator('body').innerText()).catch(() => {});
    await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.close();
  if (firewall) execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-NetFirewallRule -DisplayName ${powershellQuote(firewall)} | Remove-NetFirewallRule`]);
}
