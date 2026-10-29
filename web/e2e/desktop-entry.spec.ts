import { expect, test } from '@playwright/test';

test('desktop entry works without an account or backend API and preserves local drafts', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    requests.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  await page.goto('/desktop');
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  await page.getByLabel('Interview topic', { exact: true }).fill('无需账号的本机访谈');
  await page.getByRole('button', { name: 'Start live interview' }).last().click();
  await page.getByLabel('New research note', { exact: true }).fill('本机草稿，不经过服务器');
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  await page.reload();
  await expect(page.getByLabel('New research note', { exact: true })).toHaveValue('本机草稿，不经过服务器');
  expect(requests).toEqual([]);
});
