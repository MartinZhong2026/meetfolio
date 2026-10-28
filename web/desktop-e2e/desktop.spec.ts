import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const saved = async (page: Page) =>
  expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
async function synthetic(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load fictional demo' }).click();
  await saved(page);
}
async function shot(page: Page, name: string, info: import('@playwright/test').TestInfo) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
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
    page.getByText('Download or import the free speech model in the installed desktop application.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shot(page, 'prepare', info);
  await page.getByRole('button', { name: 'Start live interview' }).last().click();
  const columns = page.getByTestId('desktop-columns');
  const guide = columns.getByRole('region', { name: 'Interview guide', exact: true });
  const transcript = columns.getByRole('region', {
    name: 'Live transcription',
    exact: true,
  });
  const notes = columns.getByRole('region', { name: 'Research notes', exact: true });
  const boxes = await Promise.all(
    [guide, transcript, notes].map((p) => p.boundingBox()),
  );
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.width).toBeGreaterThan(boxes[2]!.width);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shot(page, 'live', info);
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    'DEMO · Demo running',
  );
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page
    .getByLabel('New research note', { exact: true })
    .fill('本机研究观察：需要追加访谈。');
  await page
    .getByRole('combobox', { name: 'Note category', exact: true })
    .selectOption('followup');
  await page.getByRole('button', { name: 'Save note' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Edit segment 2', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit segment 2' }).fill('人工校对后的合成陈述。');
  await page.getByRole('button', { name: 'Save edit' }).click();
  await page.getByText('Compare original text', { exact: true }).click();
  await expect(
    page
      .getByText('I usually get up at six. He sometimes resists his medicine', { exact: false })
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish & review' }).first().click();
  await page.getByRole('button', { name: 'Source 00:18:14 ↗' }).click();
  await expect(page.locator('#review-seg-2')).toBeFocused();
  await page
    .getByLabel('Researcher review notes')
    .fill('已核对，仍需后续验证。');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shot(page, 'review', info);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export Markdown', exact: true })
    .click();
  const md = await fs.readFile((await (await download).path())!, 'utf8');
  expect(md).toContain('DEMO / synthetic');
  expect(md).toContain('本机研究观察');
  expect(md).toContain('Follow-up question');
  expect(md).toContain('人工校对后的合成陈述');
  expect(md).toContain('Original text: I usually get up at six');
  expect(md).toContain('#seg-2');
  const docx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export DOCX', exact: true }).click();
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
  await expect(page.getByLabel('Researcher review notes')).toHaveValue(
    '已核对，仍需后续验证。',
  );
  await expect(
    page.getByText('Offline · Local workspace', { exact: true }),
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
  await page.getByLabel('Interview topic', { exact: true }).fill('未保存测试');
  await expect(page.getByRole('alert')).toContainText('Unsaved: local storage is unavailable or full');
  await shot(page, 'unsaved', info);
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON backup now' }).click();
  const file = await (await backup).path();
  await page.evaluate(() => {
    (window as unknown as { failSave: boolean }).failSave = false;
  });
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await saved(page);
  const duplicate = await context.newPage();
  await duplicate.goto('/');
  await expect(
    duplicate.getByRole('heading', { name: 'Use one window for editing' }),
  ).toBeVisible();
  await duplicate.close();
  await page.getByRole('button', { name: 'Model & Settings', exact: true }).click();
  await page.getByLabel('Import local JSON backup').setInputFiles(file!);
  await expect(page.getByRole('status').last()).toContainText(
    'Backup restored as copies',
  );
  await page.getByRole('button', { name: 'My interviews', exact: true }).click();
  await expect(page.getByLabel('Interview topic', { exact: true })).toHaveValue(
    '未保存测试 (restored copy)',
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
  await page.getByLabel('Interview topic', { exact: true }).fill('本机运行时状态测试');
  await page
    .getByRole('checkbox', { name: 'I have obtained informed recording consent from the participant (required)' })
    .check();
  await page.getByRole('button', { name: 'Download free speech model', exact: true }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Model download progress' }),
  ).toHaveAttribute('value', '50');
  await shot(page, 'model-download', info);
  await expect(
    page.getByText('X-ASR Ready · Offline', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start live interview' }).last().click();
  await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
  await expect(
    page.getByText('Microphone: Permission denied', { exact: false }),
  ).toBeVisible();
  await shot(page, 'permission-denied', info);
  await page.evaluate(() => {
    (window as unknown as { allowMic: boolean }).allowMic = true;
  });
  await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
  await expect(
    page.getByText('本地运行时测试片段（模拟引擎）', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { interrupt: () => void }).interrupt();
  });
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    'Recording interrupted',
  );
  await shot(page, 'interrupted', info);
  await page
    .getByRole('button', { name: 'Check device and resume', exact: true })
    .click();
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    'Transcribing locally',
  );
  // Session-relative native times are offset and IDs are namespaced across resume.
  await expect(page.locator('#seg-2 time')).toHaveText('00:00:01');
  await saved(page);
  await page.reload();
  await expect(
    page.getByText('The previous session was interrupted by reload or exit.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId('desktop-recording-status')).toHaveText(
    'Recording interrupted',
  );
});

test('model readiness is rechecked, mobile layout and explicit no-runtime recording block', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Interview topic', { exact: true }).fill('手机上的手工研究');
  await page.getByRole('button', { name: 'Start live interview' }).last().click();
  await expect(
    page.getByRole('button', { name: 'Start transcription', exact: true }),
  ).toBeDisabled();
  await page.getByText('Add manual segment (not ASR)', { exact: true }).click();
  await page
    .getByLabel('Manual entry (not ASR output)')
    .fill('这是手工补记，不是语音识别');
  await saved(page);
  await page.reload();
  await page.getByText('Add manual segment (not ASR)', { exact: true }).click();
  await expect(page.getByLabel('Manual entry (not ASR output)')).toHaveValue(
    '这是手工补记，不是语音识别',
  );
  await page.getByRole('button', { name: 'Add manual segment', exact: true }).click();
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
  await page.getByLabel('Interview topic', { exact: true }).fill('模型状态复核');
  await page
    .getByRole('checkbox', { name: 'I have obtained informed recording consent from the participant (required)' })
    .check();
  await expect(
    page.getByText('X-ASR Ready · Offline', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start live interview' }).last().click();
  await page.evaluate(() => {
    (window as unknown as { revokeModel: boolean }).revokeModel = true;
  });
  await page.getByRole('button', { name: 'Start transcription', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start transcription', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Check device and resume', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('Microphone: Not requested', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('本地运行时测试片段（模拟引擎）', { exact: true }),
  ).toHaveCount(0);
});
