import { expect, test } from '@playwright/test';

test('desktop entry works without an account or backend API and preserves local drafts', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    requests.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  await page.goto('/desktop');
  await expect(page.getByRole('heading', { name: '访谈准备' })).toBeVisible();
  await page.getByLabel('访谈主题', { exact: true }).fill('无需账号的本机访谈');
  await page.getByRole('button', { name: '进入实时访谈' }).last().click();
  await page.getByLabel('新研究笔记', { exact: true }).fill('本机草稿，不经过服务器');
  await expect(page.getByTestId('desktop-save-status')).toHaveText('已保存到本机');
  await page.reload();
  await expect(page.getByLabel('新研究笔记', { exact: true })).toHaveValue('本机草稿，不经过服务器');
  expect(requests).toEqual([]);
});
