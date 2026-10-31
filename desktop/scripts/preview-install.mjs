/** Real per-user NSIS install / normal visible launch / uninstall. Never targets a pre-existing preview. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
const run=promisify(execFile);
const {values}=parseArgs({options:{mode:{type:'string'},installer:{type:'string'},root:{type:'string',default:'work/phase5/installed-check'}}});
assert(process.platform==='win32'&&process.arch==='x64');assert(['install','uninstall'].includes(values.mode));
const root=path.resolve(values.root), workspace=path.resolve('work/phase5');assert(root.startsWith(workspace+path.sep));
const target=path.join(root,'application'), state=path.join(root,'installed-state.json');
const profile=path.join(process.env.LOCALAPPDATA,'Meetfolio Preview');
async function previewRegistration(){const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -like 'Meetfolio Preview*' }).Count"],{windowsHide:true});return Number(stdout.trim());}
if(values.mode==='install'){
  assert(values.installer);assert.equal(await previewRegistration(),0,'A preview is already installed; do not overwrite it');
  await assert.rejects(fs.lstat(target));await assert.rejects(fs.lstat(profile),'An existing preview profile must remain untouched');await fs.mkdir(root,{recursive:true});
  await run(path.resolve(values.installer),['/S','/currentuser',`/D=${target}`],{windowsHide:true,timeout:180000});
  const executable=path.join(target,'MeetfolioPreview.exe');await fs.stat(executable);assert.equal(await previewRegistration(),1);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.MEETFOLIO_USER_DATA;
  const app=await _electron.launch({executablePath:executable,args:[],env,timeout:60000});
  try{
    const page=await app.firstWindow();await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally',{timeout:30000});
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),{timeout:10000}).toBe(true);
    const info=await app.evaluate(({app,BrowserWindow})=>({profile:app.getPath('userData'),visible:BrowserWindow.getAllWindows()[0].isVisible(),packaged:app.isPackaged,version:app.getVersion()}));
    assert.equal(path.resolve(info.profile),path.resolve(profile));assert(info.visible&&info.packaged);assert.equal(info.version,'0.2.0-preview.1');
  }finally{await app.close();}
  const sentinel='Phase 5 uninstall retention fixture; no interview data.';await fs.writeFile(path.join(profile,'phase5-retention.txt'),sentinel);
  const uninstaller=(await fs.readdir(target)).filter(n=>/^Uninstall .*\.exe$/.test(n));assert.equal(uninstaller.length,1);
  const signatures=JSON.parse((await run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('desktop/scripts/preview-signatures.ps1'),'-Installer',path.resolve(values.installer),'-Executable',executable,'-Uninstaller',path.join(target,uninstaller[0])],{windowsHide:true})).stdout);
  await fs.writeFile(state,JSON.stringify({executable,target,profile,uninstaller:path.join(target,uninstaller[0]),sentinel,signatures,install:'Passed',normalVisibleLaunch:'Passed',version:'0.2.0-preview.1'},null,2));
  console.log('Real per-user NSIS installation and normal visible preview startup passed; original Meetfolio identity/profile untouched');
}else{
  const s=JSON.parse(await fs.readFile(state,'utf8'));assert.equal(s.target,target);assert.equal(s.profile,profile);assert(s.uninstaller.startsWith(target+path.sep));
  await run(s.uninstaller,['/S'],{windowsHide:true,timeout:180000});
  await expect.poll(async()=>fs.access(s.executable).then(()=>true,()=>false),{timeout:30000}).toBe(false);
  assert.equal(await previewRegistration(),0);assert.equal(await fs.readFile(path.join(profile,'phase5-retention.txt'),'utf8'),s.sentinel);
  await fs.writeFile(path.join(root,'installation-status.json'),JSON.stringify({platform:'win32',arch:'x64',installer:'Passed',normalVisibleLaunch:'Passed',uninstall:'Passed',previewUserDataRetained:true,originalMeetfolioProfileTouched:false,physicalMicrophone:'Not verified',signed:false,signatures:s.signatures},null,2));
  console.log('Real NSIS uninstall passed; preview user data retained, original Meetfolio profile untouched');
}
