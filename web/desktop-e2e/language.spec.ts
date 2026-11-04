import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Chinese and English UI switch instantly, persist locally and preserve interview input', async ({ page }) => {
  await page.goto('/');
  const language = page.getByRole('group', { name: 'Interface language' });
  await expect(language.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Interview topic', { exact: true }).fill('访谈测试 — user content');
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');

  await language.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('group', { name: '界面语言' }).getByRole('button', { name: '中文' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('访谈主题', { exact: true })).toHaveValue('访谈测试 — user content');
  await expect(page.getByRole('button', { name: '我的访谈', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '访谈准备', exact: true })).toBeVisible();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('已保存到本地');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.reload();
  await expect(page.getByRole('group', { name: '界面语言' }).getByRole('button', { name: '中文' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('访谈主题', { exact: true })).toHaveValue('访谈测试 — user content');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByLabel('Interview topic', { exact: true })).toHaveValue('访谈测试 — user content');
  await expect(page.getByRole('heading', { name: 'Preparation', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Chinese interface translates import, review and speaker controls without translating transcript data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load fictional demo', exact: true }).click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: /复核与导出/ }).click();
  await expect(page.getByRole('region', { name: '复核转录原文' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '转录文字', exact: false })).toBeVisible();
  await expect(page.getByText('I usually get up at six.', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: '说话人管理' })).toBeVisible();
  await page.getByRole('button', { name: '显示复核侧栏' }).count().then(async count => {
    if (count) await page.getByRole('button', { name: '显示复核侧栏' }).click();
  });
  await page.locator('.dt-review-export-menu > summary').click();
  await expect(page.getByRole('button', { name: '导出 Markdown', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导入音频', exact: true }).click();
  await expect(page.getByRole('region', { name: '导入音频录音' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '自动区分说话人' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '转录录音' })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
