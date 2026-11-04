import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('model setup installs offline components via one user action (mock native bridge)', async ({ page }) => {
  await page.addInitScript(() => {
    let speech = false;
    let speaker = false;
    let decoder = false;
    (window as any).meetfolioDesktop = {
      version: 1,
      getModelStatus: async () => ({ state: speech ? 'installed' : 'missing', modelId: 'local-test-model', offline: true, engineLoaded: speech }),
      downloadModel: async () => { speech = true; },
      getSpeakerStatus: async () => ({ ready: speaker }),
      installSpeakerModels: async () => ({ ready: (speaker = true) }),
      getDecoderStatus: async () => ({ supported: true, ready: decoder }),
      installAudioDecoder: async () => ({ supported: true, ready: (decoder = true) }),
      requestMicrophonePermission: async () => 'unavailable',
      startTranscription: async () => { throw new Error('Mock bridge only'); },
    };
  });
  await page.goto('/');
  const setup = page.getByRole('button', { name: 'Set up offline transcription', exact: true });
  await expect(setup).toBeEnabled();
  await setup.click();
  await expect(page.getByText('Setup complete · Offline transcription is ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Offline transcription ready' })).toBeDisabled();
  await expect(page.getByText('X-ASR: Ready', { exact: false })).toBeVisible();
});

test('navigation collapses without losing icon-button accessibility; deletion requires confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Interview topic', { exact: true }).fill('Disposable local conversation');
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  // The expanded brand link must derive its accessible name from visible text.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Meetfolio', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New interview', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Recent interviews' }).click();
  await page.getByRole('button', { name: 'Delete interview Disposable local conversation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this interview?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Original WAV files remain');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Interview topic')).toHaveValue('Disposable local conversation');
  await page.getByRole('button', { name: 'Delete interview Disposable local conversation' }).click();
  await dialog.getByRole('button', { name: 'Delete interview', exact: true }).click();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  await page.reload();
  await expect(page.getByLabel('Interview topic')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Delete interview Disposable local conversation' })).toHaveCount(0);
});

test('live focus controls make transcript the sole panel and restore note-taking', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Interview topic', { exact: true }).fill('Live focus fixture');
  await page.getByRole('button', { name: 'Start live interview' }).last().click();
  const panels = page.getByTestId('desktop-columns');
  await expect(panels.getByRole('region', { name: 'Live transcription' })).toBeVisible();
  await expect(panels.getByRole('region', { name: 'Interview guide' })).toHaveCount(0);
  await expect(panels.getByRole('region', { name: 'Research notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Focus on transcript' }).click();
  await expect(panels.getByRole('region', { name: 'Research notes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show research notes' }).click();
  await expect(panels.getByRole('region', { name: 'Research notes' })).toBeVisible();
});

test('review page prioritizes transcript with offline Huninn and collapsible side panels', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load fictional demo', exact: true }).click();
  await page.getByRole('button', { name: 'Review & export', exact: false }).click();
  const shell = page.locator('.dt-app');
  await expect(shell).toHaveCSS('font-family', /Huninn/);
  expect(await page.evaluate(async () => {
    await document.fonts.load('16px Huninn', 'Meetfolio');
    return document.fonts.check('16px Huninn');
  })).toBe(true);

  const transcript = page.getByRole('region', { name: 'Review original text' });
  const inspector = page.getByRole('region', { name: 'Manual evidence review' });
  const exports = page.locator('.dt-review-export-menu > summary');
  await expect(transcript).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(exports).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Markdown', exact: true })).toHaveCount(0);
  const startingWidth = (await transcript.boundingBox())!.width;
  await page.getByRole('button', { name: 'Hide review panel' }).click();
  await expect(inspector).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show review panel' })).toBeVisible();
  expect((await transcript.boundingBox())!.width).toBeGreaterThan(startingWidth);
  await page.getByRole('button', { name: 'Show review panel' }).click();
  await expect(inspector).toBeVisible();

  await exports.click();
  await expect(page.getByRole('button', { name: 'Export Markdown', exact: true })).toBeVisible();
  await exports.click();
  await expect(page.getByRole('button', { name: 'Export Markdown', exact: true })).toHaveCount(0);
  const recent = page.getByRole('button', { name: 'Recent interviews' });
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await recent.click();
  await expect(recent).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /DEMO · Family caregiver interview/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('review-huninn-layout.png'), fullPage: false });
});
