/** Existing web recording compatibility: Chromium file-backed microphone, real local native model. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const [baseURL, sample] = process.argv.slice(2);
assert(baseURL && sample, 'Usage: node server/scripts/verify-xasr-browser.mjs <local test app URL> <sample 0.wav>');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Use an isolated local TEST app/database');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(sample)}`, '--autoplay-policy=no-user-gesture-required'],
});
try {
  const context = await browser.newContext({ baseURL, permissions: ['microphone'] });
  const page = await context.newPage();
  const initial = await (await page.request.get('/api/config')).json();
  assert.equal(initial.asrProvider, 'local-xasr'); assert.equal(initial.demoEnabled, false);
  assert.equal(initial.aiConfigured, false); assert.equal(initial.localAsr.state, 'installed');
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(`native-smoke-${Date.now()}@example.edu.cn`);
  await page.getByLabel('密码').fill('native-test-only-123');
  await page.getByRole('button', { name: '注册并开始' }).click();
  await expect(page.getByRole('heading', { name: '我的会议' })).toBeVisible();
  await page.getByRole('link', { name: /新建会议/ }).first().click();
  await page.getByLabel('会议标题').fill('Native X-ASR official audio fixture');
  await page.getByRole('button', { name: '创建并进入工作台' }).click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  const meetingId = page.url().match(/meetings\/([0-9a-f-]+)\/live/)[1];
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 30000 });
  await expect.poll(async () => (await (await page.request.get('/api/config')).json()).localAsr.state, { timeout: 30000 }).toBe('ready');
  await expect(page.locator('article[id^="seg-"]').filter({ hasText: 'Monday' }).first()).toBeVisible({ timeout: 60000 });
  await page.getByTestId('btn-end').click();
  await page.getByRole('dialog').getByRole('button', { name: '结束并保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${meetingId}$`), { timeout: 30000 });
  await expect(page.locator('body')).toContainText('Monday', { timeout: 20000 });
  const final = await (await page.request.get('/api/config')).json();
  assert.equal(final.localAsr.state, 'installed');
  console.log(JSON.stringify({ result: 'passed', source: 'Chromium file-backed microphone, official speech sample 0.wav',
    flow: 'getUserMedia → AudioWorklet → PCM16 → WebSocket → native CPU inference → persisted transcript → review',
    physicalMicrophone: false, cloudAsr: false, windowsTest: false }, null, 2));
} finally { await browser.close(); }
