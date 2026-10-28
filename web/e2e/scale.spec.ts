import { expect, test } from '@playwright/test';
import { registerUser } from './helpers';

// Playwright's trace recorder snapshots the whole DOM on every poll, which distorts timing on a 140k-node page,
// so this file records no traces/screenshots. The assertions measure the application, not the recorder.
test.use({ trace: 'off', screenshot: 'off' });

test('a 6,000-segment transcript stays responsive (load, search, scroll)', async ({ page }) => {
  test.setTimeout(120_000);
  await registerUser(page);
  const r = await page.request.post('/api/meetings', { data: { title: '超长访谈' } });
  const id = (await r.json()).meeting.id as string;
  await page.request.post('/__e2e/seed-segments', { data: { meetingId: id, count: 6000 } });

  const t0 = Date.now();
  await page.goto(`/meetings/${id}`);
  await page.getByTestId('tab-transcript').click();
  await expect(page.locator('article[id^="seg-"]').first()).toBeVisible();
  const loadMs = Date.now() - t0;
  expect(await page.locator('article[id^="seg-"]').count()).toBe(6000);
  expect(loadMs).toBeLessThan(8_000);

  const s0 = Date.now();
  await page.getByLabel('在转录中搜索').fill('第5999段');
  await expect(page.getByTestId('review-transcript').locator('mark').first()).toBeVisible();
  expect(Date.now() - s0).toBeLessThan(4_000);

  const sc = Date.now();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('#seg-6000')).toBeAttached();
  expect(Date.now() - sc).toBeLessThan(3_000);

  // Editing one row among thousands does not re-render the rest: the edit applies quickly.
  const e0 = Date.now();
  const row = page.locator('#seg-6000');
  await row.hover();
  await row.getByRole('button', { name: '编辑文字' }).click();
  await row.getByLabel('编辑转录文字').fill('修改后的文字');
  await row.getByLabel('编辑转录文字').press('Control+Enter');
  await expect(row).toContainText('已修订');
  expect(Date.now() - e0).toBeLessThan(3_000);
  console.log(`6000 segments: load ${loadMs} ms`);
});
