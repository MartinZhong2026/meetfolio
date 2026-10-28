import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const saved = async (page: Page) =>
  expect(page.getByTestId('desktop-save-status')).toHaveText('已保存到本机');
async function synthetic(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '载入虚构示例' }).click();
  await saved(page);
}
async function shot(page: Page, name: string, width: number) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `../docs/desktop-screenshots/${name}-${width}.png`,
    fullPage: false,
  });
}

test('reference stages, offline notes and evidence, honest model state, edited exports and restart', async ({
  page,
  context,
}, info) => {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (
      url.origin !== 'http://127.0.0.1:4175' ||
      /^\/(api|ws)(\/|$)/.test(url.pathname)
    ) {
      unexpected.push(url.origin + url.pathname);
      await route.abort();
    } else await route.continue();
  });
  await page.addInitScript(() => {
    window.fetch = () => {
      throw new Error('Desktop attempted backend fetch');
    };
    window.WebSocket = class {
      constructor() {
        throw new Error('Desktop attempted WebSocket');
      }
    } as unknown as typeof WebSocket;
  });
  await synthetic(page);
  await expect(
    page.getByText('普通浏览器未连接本地语音引擎。', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shot(page, 'prepare', info.project.use.viewport!.width);
  await page.getByRole('button', { name: '进入实时访谈' }).last().click();
  const columns = page.getByTestId('desktop-columns');
  const guide = columns.getByRole('region', { name: '访谈提纲', exact: true });
  const transcript = columns.getByRole('region', {
    name: '实时转录',
    exact: true,
  });
  const notes = columns.getByRole('region', { name: '研究笔记', exact: true });
  const boxes = await Promise.all(
    [guide, transcript, notes].map((p) => p.boundingBox()),
  );
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.width).toBeGreaterThan(boxes[2]!.width);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shot(page, 'live', info.project.use.viewport!.width);
  await page.getByRole('button', { name: '模拟开始', exact: true }).click();
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    'DEMO · 模拟展示中',
  );
  await page.getByRole('button', { name: '模拟暂停', exact: true }).click();
  await page
    .getByLabel('新研究笔记', { exact: true })
    .fill('本机研究观察：需要追加访谈。');
  await page
    .getByRole('combobox', { name: '笔记类别', exact: true })
    .selectOption('followup');
  await page.getByRole('button', { name: '保存这条笔记' }).click();
  await saved(page);
  await page.getByRole('button', { name: '编辑片段 2', exact: true }).click();
  await page.getByLabel('修订片段 2').fill('人工校对后的合成陈述。');
  await page.getByRole('button', { name: '保存修订' }).click();
  await page.getByText('对照原始文字', { exact: true }).click();
  await expect(
    page
      .getByText('基本上六点就要起来，他有时候不太愿意吃药。', { exact: false })
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '结束并复核' }).first().click();
  await page.getByRole('button', { name: '来源 00:18:14 ↗' }).click();
  await expect(page.locator('#review-seg-2')).toBeFocused();
  await page
    .getByLabel('研究者复核说明（非 AI 生成）')
    .fill('已核对，仍需后续验证。');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shot(page, 'review', info.project.use.viewport!.width);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 Markdown', exact: true })
    .click();
  const md = await fs.readFile((await (await download).path())!, 'utf8');
  expect(md).toContain('DEMO / synthetic');
  expect(md).toContain('本机研究观察');
  expect(md).toContain('追问问题');
  expect(md).toContain('人工校对后的合成陈述');
  expect(md).toContain('原始版本：基本上六点');
  expect(md).toContain('#seg-2');
  const docx = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 DOCX', exact: true }).click();
  const data = await fs.readFile((await (await docx).path())!);
  expect(data.subarray(0, 2).toString()).toBe('PK');
  await saved(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await saved(page);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('研究者复核说明（非 AI 生成）')).toHaveValue(
    '已核对，仍需后续验证。',
  );
  await expect(
    page.getByText('离线 · 本机工作区', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('unsaved data, retry, backup restoration copies and two-tab safety', async ({
  page,
  context,
}, info) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if ((window as unknown as { failSave?: boolean }).failSave)
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await saved(page);
  await page.evaluate(() => {
    (window as unknown as { failSave: boolean }).failSave = true;
  });
  await page.getByLabel('访谈主题', { exact: true }).fill('未保存测试');
  await expect(page.getByRole('alert')).toContainText('尚未保存');
  await shot(page, 'unsaved', info.project.use.viewport!.width);
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '立即导出 JSON 备份' }).click();
  const file = await (await backup).path();
  await page.evaluate(() => {
    (window as unknown as { failSave: boolean }).failSave = false;
  });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await saved(page);
  const duplicate = await context.newPage();
  await duplicate.goto('/');
  await expect(
    duplicate.getByRole('heading', { name: '请在一个窗口中编辑' }),
  ).toBeVisible();
  await duplicate.close();
  await page.getByRole('button', { name: '模型与设置', exact: true }).click();
  await page.getByLabel('导入本机 JSON 备份').setInputFiles(file!);
  await expect(page.getByRole('status').last()).toContainText(
    '备份已恢复为新副本',
  );
  await page.getByRole('button', { name: '我的访谈', exact: true }).click();
  await expect(page.getByLabel('访谈主题', { exact: true })).toHaveValue(
    '未保存测试（恢复副本）',
  );
});

async function runtime(page: Page, mode: 'installed' | 'download') {
  await page.addInitScript(
    ({ mode }) => {
      let installed = mode === 'installed';
      const state = () => ({
        state:
          installed &&
          !(window as unknown as { revokeModel?: boolean }).revokeModel
            ? ('installed' as const)
            : ('missing' as const),
        modelId: 'mock-local-engine',
        offline: true as const,
        engineLoaded: installed,
      });
      (window as unknown as { allowMic: boolean }).allowMic = false;
      window.meetfolioDesktop = {
        version: 1,
        getModelStatus: async () => state(),
        downloadModel: async (progress) => {
          progress({
            state: 'downloading',
            modelId: 'mock-local-engine',
            offline: true,
            downloadedBytes: 50,
            totalBytes: 100,
          });
          await new Promise((r) => setTimeout(r, 1200));
          installed = true;
        },
        requestMicrophonePermission: async () =>
          (window as unknown as { allowMic: boolean }).allowMic
            ? 'granted'
            : 'denied',
        startTranscription: async (callbacks) => {
          const timer = setTimeout(
            () =>
              callbacks.onSegment({
                id: 'local-1',
                seq: 1,
                startMs: 0,
                endMs: 1000,
                originalText: '本地运行时测试片段（模拟引擎）',
                editedText: null,
                speakerLabel: '测试',
                isImportant: false,
                source: 'local',
                updatedAt: new Date().toISOString(),
              }),
            100,
          );
          (window as unknown as { interrupt: () => void }).interrupt = () =>
            callbacks.onInterruption(
              '测试：麦克风连接中断，缺失音频尚未恢复。',
            );
          return {
            stop: async () => {
              clearTimeout(timer);
            },
          };
        },
      };
    },
    { mode },
  );
}

test('native bridge contract: download, permission denial, interruption and reload recovery', async ({
  page,
}, info) => {
  await runtime(page, 'download');
  await page.goto('/');
  await page.getByLabel('访谈主题', { exact: true }).fill('本机运行时状态测试');
  await page
    .getByRole('checkbox', { name: '已取得参与者的录音知情同意' })
    .check();
  await page.getByRole('button', { name: '下载免费语音模型', exact: true }).click();
  await expect(
    page.getByRole('progressbar', { name: '模型下载进度' }),
  ).toHaveAttribute('value', '50');
  await shot(page, 'model-download', info.project.use.viewport!.width);
  await expect(
    page.getByText('X-ASR Ready · 离线', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '进入实时访谈' }).last().click();
  await page.getByRole('button', { name: '开始本地转录', exact: true }).click();
  await expect(
    page.getByText('麦克风：权限被拒绝', { exact: false }),
  ).toBeVisible();
  await shot(page, 'permission-denied', info.project.use.viewport!.width);
  await page.evaluate(() => {
    (window as unknown as { allowMic: boolean }).allowMic = true;
  });
  await page.getByRole('button', { name: '开始本地转录', exact: true }).click();
  await expect(
    page.getByText('本地运行时测试片段（模拟引擎）', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { interrupt: () => void }).interrupt();
  });
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    '记录已中断',
  );
  await shot(page, 'interrupted', info.project.use.viewport!.width);
  await page
    .getByRole('button', { name: '重新确认并继续', exact: true })
    .click();
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    '本地转录中',
  );
  // Session-relative native times are offset and IDs are namespaced across resume.
  await expect(page.locator('#seg-2 time')).toHaveText('00:00:01');
  await saved(page);
  await page.reload();
  await expect(
    page.getByText('上次记录因页面关闭或刷新中断。', { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    '记录已中断',
  );
});

test('model readiness is rechecked, mobile layout and explicit no-runtime recording block', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('访谈主题', { exact: true }).fill('手机上的手工研究');
  await page.getByRole('button', { name: '进入实时访谈' }).last().click();
  await expect(
    page.getByRole('button', { name: '开始本地转录', exact: true }),
  ).toBeDisabled();
  await page.getByText('添加手工补记（非语音识别）', { exact: true }).click();
  await page
    .getByLabel('手工补记（不作为语音识别结果）')
    .fill('这是手工补记，不是语音识别');
  await saved(page);
  await page.reload();
  await page.getByText('添加手工补记（非语音识别）', { exact: true }).click();
  await expect(page.getByLabel('手工补记（不作为语音识别结果）')).toHaveValue(
    '这是手工补记，不是语音识别',
  );
  await page.getByRole('button', { name: '添加手工片段' }).click();
  await expect(
    page.getByText('这是手工补记，不是语音识别', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('cached ready badge cannot bypass a runtime model revocation', async ({
  page,
}) => {
  await runtime(page, 'installed');
  await page.goto('/');
  await page.getByLabel('访谈主题', { exact: true }).fill('模型状态复核');
  await page
    .getByRole('checkbox', { name: '已取得参与者的录音知情同意' })
    .check();
  await expect(
    page.getByText('X-ASR Ready · 离线', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '进入实时访谈' }).last().click();
  await page.evaluate(() => {
    (window as unknown as { revokeModel: boolean }).revokeModel = true;
  });
  await page.getByRole('button', { name: '开始本地转录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '开始本地转录', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '重新确认并继续', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('麦克风：尚未请求', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('本地运行时测试片段（模拟引擎）', { exact: true }),
  ).toHaveCount(0);
});
