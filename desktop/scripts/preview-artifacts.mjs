/** Produce an allowlisted download directory and SHA-256 list after all platform checks pass. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve('work/phase5/packages'), out=path.resolve(`work/phase5/downloads/${process.platform}-${process.arch}`);
execFileSync('git',['diff','--quiet','HEAD','--']); // Never label an uncommitted source build with a commit SHA.
const installation=JSON.parse(await fs.readFile(process.platform==='win32'?'work/phase5/installed-check/installation-status.json':'work/phase5/mac-installed/installation-status.json','utf8'));
const readiness=JSON.parse(await fs.readFile(process.platform==='win32'?'work/phase5/installed-readiness/readiness-smoke.json':'work/phase5/mac-packaged/readiness-smoke.json','utf8'));
const download=JSON.parse(await fs.readFile('work/phase5/model-download/download-status.json','utf8'));
assert.equal(readiness.result,'Passed');assert.equal(readiness.networkRequests,0);assert.equal(download.packagedModelDownload,'Passed');assert.equal(download.arch,process.arch);
assert.equal(installation.normalVisibleLaunch,'Passed');assert.equal(process.platform==='win32'?installation.uninstall:installation.removeTestApp,'Passed');
await fs.mkdir(out,{recursive:true});
const version=JSON.parse(await fs.readFile('desktop/package.json','utf8')).version;
const names=process.platform==='win32'?[`Meetfolio-${version}-windows-x64-setup.exe`]:[`Meetfolio-${version}-macos-${process.arch}.dmg`,`Meetfolio-${version}-macos-${process.arch}.zip`];
const artifacts=[];
for(const name of names){const file=path.join(root,name);assert((await fs.stat(file)).size>1024*1024);const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);const sha256=h.digest('hex');await fs.copyFile(file,path.join(out,name));artifacts.push({name,bytes:(await fs.stat(file)).size,sha256});}
const checkout=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const event=process.env.GITHUB_EVENT_PATH?JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8')):null;
const head=event?.pull_request?.head?.sha || checkout;assert(/^[a-f0-9]{40}$/.test(head));
await fs.writeFile(path.join(out,'SHA256SUMS.txt'),artifacts.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
await fs.writeFile(path.join(out,'BUILD.json'),JSON.stringify({version,head,checkout,platform:process.platform,arch:process.arch,artifacts,developerIdSigned:false,notarized:false,hardenedRuntime:false,signature:process.platform==='darwin'?'ad-hoc only; not Developer ID':'unsigned',installation:process.platform==='win32'?'real NSIS install/normal launch/uninstall checked':'DMG mount/app copy/launch checked',physicalDevices:'Not verified'},null,2));
await fs.copyFile('docs/engineering/PHASE5_INSTALL.zh-CN.md',path.join(out,'INSTALL.zh-CN.md'));
console.log(JSON.stringify({head,version,artifacts}));
