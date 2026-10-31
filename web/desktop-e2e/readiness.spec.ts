import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('native long-file picker has an accessible button, protects navigation and exposes resumable work (mock bridge)', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.meetfolioDesktop = {
      version: 1,
      getModelStatus: async () => ({ state: 'installed', offline: true, modelId: 'fictional-ui-fixture', engineLoaded: true }),
      requestMicrophonePermission: async () => 'unavailable', startTranscription: async () => { throw new Error('UI fixture only'); },
      getDecoderStatus: async () => ({ ready: true, supported: true }), getSpeakerStatus: async () => ({ ready: true }),
      beginAudioImport: async () => 'unused-ui-fixture',
      selectAudioFile: () => new Promise(resolve => { (window as any).__resolvePicker = () => resolve({ token: 'fixture-capability', name: 'Fictional interview · 90 minutes.m4a', bytes: 80 * 1024 * 1024, durationMs: 90 * 60000 }); }),
      listImportTasks: async () => [{ recordingId: '01234567-89ab-cdef-0123-456789abcdef', name: 'Fictional interrupted interview.wav', durationMs: 90 * 60000, completedMs: 42 * 60000, segmentCount: 57, complete: false }],
    };
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Import audio', exact: true }).click();
  const importer = page.getByRole('region', { name: 'Import audio recording' });
  await importer.getByRole('button', { name: 'Choose recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New interview', exact: true })).toBeDisabled();
  await expect(importer.getByRole('button', { name: 'Close audio import' })).toBeDisabled();
  await page.evaluate(() => (window as any).__resolvePicker());
  await expect(importer.getByText('Fictional interview · 90 minutes.m4a', { exact: true })).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Transcribe recording', exact: true })).toBeDisabled();
  await expect(importer.getByRole('button', { name: 'Resume 01234567', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'New interview', exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('long-audio-import.png'), fullPage: false });
});
test('long transcript pages, deferred search, evidence navigation and review queue preserve edits', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Load fictional demo', exact: true }).click();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => { const r=indexedDB.open('meetfolio-desktop-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
    const book = await new Promise<any>((resolve,reject) => { const r=db.transaction('notebook').objectStore('notebook').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
    const i = book.interviews.find((x: any) => x.id === book.activeId); const seed = i.segments[0];
    i.title='Long conversation · fictional review fixture';i.stage='review';
    i.segments=Array.from({length:6000},(_,n)=>({...seed,id:`long-${n}`,seq:n+1,startMs:n*1000,endMs:n*1000+900,originalText:`Long fixture ${n} · synthetic source`,isImportant:n===2500,reviewReasons:n%500===0?['overlap']:[]}));
    await new Promise<void>((resolve,reject)=>{const t=db.transaction('notebook','readwrite');t.objectStore('notebook').put(book,'current');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});db.close();
  });
  await page.reload();const sources=page.getByRole('region',{name:'Review original text'});
  await expect(sources.locator('.dt-segment')).toHaveCount(100);
  await page.getByRole('button',{name:'Next 100',exact:true}).click();
  await expect(sources.locator('.dt-segment').first()).toHaveAttribute('id','review-seg-101');
  await page.getByRole('searchbox',{name:'Search transcript',exact:true}).fill('Long fixture 5999');
  await expect(sources.locator('.dt-segment')).toHaveCount(1);
  await page.getByRole('button',{name:'Source 00:41:40 ↗',exact:true}).click();
  await expect(page.locator('#review-seg-2501')).toBeFocused();
  await page.getByRole('button',{name:'Needs review',exact:true}).click();
  await expect(sources.locator('.dt-segment')).toHaveCount(12);
  await sources.getByRole('button',{name:'Mark reviewed',exact:true}).first().click();
  await expect(sources.locator('.dt-segment')).toHaveCount(11);
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');await page.reload();
  await page.getByRole('button',{name:'Needs review',exact:true}).click();
  await expect(sources.locator('.dt-segment')).toHaveCount(11);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath('readiness-review.png'),fullPage:false});
});
