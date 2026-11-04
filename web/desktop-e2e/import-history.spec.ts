import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('new audio import uses a separate interview; existing history stays discoverable', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Interview topic', { exact: true }).fill('Earlier transcript');
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  await page.getByRole('button', { name: 'Import audio', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import audio recording' })).toBeVisible();
  await expect(page.getByText('New research interview', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Automatically separate speakers' })).not.toBeChecked();
  await page.getByRole('button', { name: 'My interviews', exact: true }).click();
  const history = page.getByRole('region', { name: 'Saved interviews' });
  await expect(history.getByText('Earlier transcript')).toBeVisible();
  await expect(history.getByText('Untitled interview')).toBeVisible();
  await history.locator('.dt-library-row').filter({ hasText: 'Earlier transcript' }).getByRole('button', { name: 'Open interview' }).click();
  await expect(page.getByLabel('Interview topic')).toHaveValue('Earlier transcript');
});

test('legacy merged recordings export independently using their original WAV times and text', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  await page.evaluate(async ({ idA, idB }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('meetfolio-desktop-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const book = await new Promise<any>((resolve, reject) => {
      const request = db.transaction('notebook', 'readonly').objectStore('notebook').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const interview = book.interviews.find((item: any) => item.id === book.activeId);
    interview.title = 'Legacy combined interview';
    interview.stage = 'review';
    const base = {
      originalText: '', editedText: null, speakerLabel: 'Speaker 1', isImportant: false,
      source: 'local', updatedAt: new Date().toISOString(),
    };
    interview.segments = [
      { ...base, id: 'source-one', seq: 1, originalText: 'Only in first WAV',
        startMs: 70000, endMs: 71500, audio: { recordingId: idA, startMs: 2000, endMs: 3500 } },
      { ...base, id: 'source-two', seq: 2, originalText: 'Only in second WAV',
        startMs: 150000, endMs: 152000, audio: { recordingId: idB, startMs: 1000, endMs: 3000 } },
    ];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notebook', 'readwrite');
      tx.objectStore('notebook').put(book, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { idA, idB });
  await page.reload();
  const recordings = page.getByRole('region', { name: 'Export individual recordings' });
  await expect(recordings.getByRole('button', { name: 'Export recording 1 as MD' })).toBeVisible();
  await expect(recordings.getByRole('button', { name: 'Export recording 2 as MD' })).toBeVisible();
  const download = page.waitForEvent('download');
  await recordings.getByRole('button', { name: 'Export recording 2 as MD' }).click();
  const file = await download;
  const text = await fs.readFile((await file.path())!, 'utf8');
  expect(file.suggestedFilename()).toContain(idB);
  expect(text).toContain('Only in second WAV');
  expect(text).toContain('[00:00:01]');
  expect(text).not.toContain('Only in first WAV');
  expect(text).not.toContain(idA);
});
