import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createMeetingViaUi, registerUser } from './helpers';

// WCAG 2.1 A/AA automated checks. Automated scanning finds a subset of issues; it does not replace manual review.
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(bad.map((v) => `${name}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `${name} accessibility`).toEqual([]);
}

test('main screens have no serious or critical accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await scan(page, 'landing');
  await page.goto('/login');
  await scan(page, 'login');
  await registerUser(page);
  await scan(page, 'dashboard');
  await page.goto('/meetings/new');
  await scan(page, 'new-meeting');
  await page.getByLabel('会议标题').fill('无障碍检查');
  await page.getByRole('button', { name: '创建并进入工作台' }).click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  await scan(page, 'workspace');
  const id = page.url().match(/meetings\/([0-9a-f-]+)\/live/)![1]!;
  await page.goto(`/meetings/${id}`);
  await expect(page.getByTestId('review-title')).toBeVisible();
  await scan(page, 'review');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '账户', exact: true })).toBeVisible();
  await scan(page, 'settings');
  void createMeetingViaUi;
});
