import { expect, type Page, type TestInfo } from '@playwright/test';

let n = 0;
export const uniqueEmail = () => `e2e${Date.now()}${++n}@example.edu.cn`;

export const isPhone = (info: TestInfo) => (info.project.use.viewport?.width ?? 1440) < 768;
export const isTablet = (info: TestInfo) => {
  const w = info.project.use.viewport?.width ?? 1440;
  return w >= 768 && w < 1200;
};

export async function registerUser(page: Page, email = uniqueEmail(), password = 'e2e-password-123') {
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '注册并开始' }).click();
  await expect(page.getByRole('heading', { name: '我的会议' })).toBeVisible();
  return { email, password };
}

export async function createMeetingViaUi(page: Page, title: string) {
  await page.getByRole('link', { name: /新建会议/ }).first().click();
  await page.getByLabel('会议标题').fill(title);
  await page.getByRole('button', { name: '创建并进入工作台' }).click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  return page.url().match(/meetings\/([0-9a-f-]+)\/live/)![1]!;
}

/** Makes a panel visible regardless of layout (desktop: always; tablet: side tabs; phone: bottom tabs). */
export async function openPanel(page: Page, info: TestInfo, which: 'ref' | 'transcript' | 'notes') {
  if (isPhone(info)) {
    const name = { ref: '参考资料', transcript: '实时转录', notes: '人工笔记' }[which];
    await page.getByRole('tab', { name }).click();
  } else if (isTablet(info) && which !== 'transcript') {
    await page.getByRole('tab', { name: which === 'ref' ? '参考资料' : '人工笔记' }).click();
  }
}

export async function killBrowserSockets(page: Page) {
  const r = await page.request.post('/__e2e/kill-browser-sockets');
  return (await r.json()).killed as number;
}
