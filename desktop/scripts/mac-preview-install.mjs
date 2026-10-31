/** Mount the actual DMG, copy its signed app, launch normally, then remove only our copy. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { _electron, expect } from '@playwright/test';
const {values}=parseArgs({options:{mode:{type:'string'}}});assert(process.platform==='darwin');assert(['install','uninstall'].includes(values.mode));
const root=path.resolve('work/phase5/mac-installed'), appPath=path.join(root,'MeetfolioPreview.app'), stateFile=path.join(root,'state.json');
assert(root.startsWith(path.resolve('work/phase5')+path.sep));
const profile=path.join(process.env.HOME,'Library/Application Support/Meetfolio Preview');
if(values.mode==='install'){
  await assert.rejects(fs.lstat(appPath));await assert.rejects(fs.lstat(profile),'Existing preview data must remain untouched');await fs.mkdir(root,{recursive:true});
  const version=JSON.parse(await fs.readFile('desktop/package.json','utf8')).version;
  const dmg=path.resolve(`work/phase5/packages/Meetfolio-${version}-macos-${process.arch}.dmg`), mount=path.join(root,'volume');
  execFileSync('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount],{stdio:'inherit'});
  try{execFileSync('/usr/bin/ditto',[path.join(mount,'MeetfolioPreview.app'),appPath],{stdio:'inherit'});}finally{execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'inherit'});}
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',appPath],{stdio:'inherit'});
  const signature=spawnSync('/usr/bin/codesign',['--display','--verbose=4',appPath],{encoding:'utf8'});assert.equal(signature.status,0);assert.match(signature.stderr,/Signature=adhoc/);assert.doesNotMatch(signature.stderr,/flags=.*\(.*runtime/);
  const executable=path.join(appPath,'Contents/MacOS/MeetfolioPreview');
  const arch=execFileSync('/usr/bin/lipo',['-archs',executable],{encoding:'utf8'}).trim();assert.equal(arch,process.arch==='x64'?'x86_64':'arm64');
  const info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(appPath,'Contents/Info.plist')],{encoding:'utf8'}));
  assert.equal(info.CFBundleIdentifier,'org.meetfolio.desktop.preview');assert(info.NSMicrophoneUsageDescription);assert.equal(info.LSMinimumSystemVersion,'15.0.0');
  const native=path.join(appPath,`Contents/Resources/xasr/node_modules/sherpa-onnx-darwin-${process.arch}`);
  const binaries=(await fs.readdir(native)).filter(n=>n.endsWith('.node')||n.endsWith('.dylib'));assert(binaries.some(n=>n.endsWith('.node')));assert(binaries.some(n=>n.endsWith('.dylib')));
  for(const name of binaries){const a=execFileSync('/usr/bin/lipo',['-archs',path.join(native,name)],{encoding:'utf8'});assert(a.split(/\s+/).includes(arch));}
  const zipRoot=path.join(root,'zip-copy');await fs.mkdir(zipRoot);
  execFileSync('/usr/bin/ditto',['-x','-k',path.resolve(`work/phase5/packages/Meetfolio-${version}-macos-${process.arch}.zip`),zipRoot],{stdio:'inherit'});
  const zipApp=path.join(zipRoot,'MeetfolioPreview.app');execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',zipApp],{stdio:'inherit'});
  async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
  for(const relative of ['Contents/MacOS/MeetfolioPreview','Contents/Resources/app.asar','Contents/Resources/xasr/decoder/meetfolio-audio-decoder',...binaries.map(n=>`Contents/Resources/xasr/node_modules/sherpa-onnx-darwin-${process.arch}/${n}`)])assert.equal(await hash(path.join(zipApp,relative)),await hash(path.join(appPath,relative)),`DMG/ZIP mismatch: ${relative}`);
  const gatekeeper=spawnSync('/usr/sbin/spctl',['--assess','--type','execute',appPath],{encoding:'utf8'});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.MEETFOLIO_USER_DATA;
  const app=await _electron.launch({executablePath:executable,args:[],env,timeout:60000});
  try{const page=await app.firstWindow();await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally',{timeout:30000});await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),{timeout:10000}).toBe(true);const actual=await app.evaluate(({app})=>({profile:app.getPath('userData'),version:app.getVersion(),packaged:app.isPackaged}));assert.equal(actual.profile,profile);assert.equal(actual.version,version);assert(actual.packaged);}finally{await app.close();}
  const sentinel='Phase 5 preview data retention fixture';await fs.writeFile(path.join(profile,'phase5-retention.txt'),sentinel);
  await fs.writeFile(stateFile,JSON.stringify({executable,profile,sentinel,arch,binaries,gatekeeperExit:gatekeeper.status},null,2));
  console.log('Actual DMG mount, app copy, architecture/signature checks and normal visible launch passed. Developer ID / notarization absent.');
}else{
  const s=JSON.parse(await fs.readFile(stateFile,'utf8'));assert.equal(s.profile,profile);assert.equal(path.basename(appPath),'MeetfolioPreview.app');
  await fs.rm(appPath,{recursive:true});assert.equal(await fs.readFile(path.join(profile,'phase5-retention.txt'),'utf8'),s.sentinel);
  await fs.writeFile(path.join(root,'installation-status.json'),JSON.stringify({platform:'darwin',arch:process.arch,dmgMountAndCopy:'Passed',normalVisibleLaunch:'Passed',removeTestApp:'Passed',previewUserDataRetained:true,signature:'ad-hoc; no Developer ID',notarized:false,gatekeeperRunnerAssessmentExit:s.gatekeeperExit,downloadQuarantineGatekeeperAcceptance:'Not verified',physicalMicrophone:'Not verified'},null,2));
}
