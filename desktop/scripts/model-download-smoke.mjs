/** Real packaged model download into a fresh private test profile; no user interviews. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
const {values}=parseArgs({options:{executable:{type:'string'},out:{type:'string',default:'work/phase5/model-download'}}});assert(values.executable);
const out=path.resolve(values.out);await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'profile-'));
const env={...process.env,MEETFOLIO_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:path.resolve(values.executable),args:['--verification'],env,timeout:60000});
try{const page=await app.firstWindow();await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally',{timeout:30000});
  assert.equal((await page.evaluate(()=>window.meetfolioDesktop.getModelStatus())).state,'missing');
  await page.evaluate(()=>window.meetfolioDesktop.downloadModel(()=>{}));
  const status=await page.evaluate(()=>window.meetfolioDesktop.getModelStatus());assert(status.offline&&status.engineLoaded&&status.state==='installed');
  await fs.writeFile(path.join(out,'download-status.json'),JSON.stringify({platform:process.platform,arch:process.arch,packagedModelDownload:'Passed',checksumAndNativeLoad:'Passed',privateProfile:true},null,2));
  console.log('Actual packaged model download, checksum validation and native initialization passed');
}finally{await app.close();}
