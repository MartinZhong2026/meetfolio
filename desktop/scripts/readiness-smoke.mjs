/** Real native file picker capability, FFmpeg streaming, checkpoints and correction preservation. */
import { _electron, expect } from '@playwright/test';
import electron from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { XASR } from '../../server/dist/asr/localXasrModel.js';
const { values } = parseArgs({ options: { executable:{type:'string'}, decoder:{type:'string',default:'work/phase4-1/decoder9.zip'},
  audio:{type:'string',default:'work/phase4/four-speakers.wav'}, speakers:{type:'string',default:'work/phase4/models/sherpa-onnx-pyannote-segmentation-3-0'},
  minutes:{type:'string',default:'120'}, out:{type:'string',default:'work/phase4-1/readiness-smoke'} } });
const out=path.resolve(values.out);await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'profile-'));
await fs.cp(path.resolve(`work/phase3a/ci-fixture/model/${XASR.id}`),path.join(profile,'models',XASR.id),{recursive:true});
const minutes=Number(values.minutes);assert(minutes>=4&&minutes<=120);
const source=path.join(out,'generated-long-public-fixture.wav');
const original=await fs.readFile(path.resolve(values.audio));const data=original.indexOf(Buffer.from('data'));assert(data>0);
const pcm=original.subarray(data+8,data+8+original.readUInt32LE(data+4));const size=minutes*60*32000;
const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(size+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(size,40);
const handle=await fs.open(source,'w');try{await handle.write(header);await handle.truncate(size+44);await handle.write(pcm,0,Math.min(size,pcm.length),44);await handle.sync();}finally{await handle.close();}
const report={actualElectron:true,mockBridge:false,publicOrGeneratedAudioOnly:true,physicalDevice:false,minutes,stages:[],networkRequests:0};let app;
async function launch(){
  const env={...process.env,MEETFOLIO_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:values.executable?path.resolve(values.executable):electron,args:[...(values.executable?[]:['desktop']),'--verification'],env,timeout:60000});
  const page=await app.firstWindow();await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally',{timeout:30000});
  await app.evaluate(({session})=>{globalThis.__readinessNetwork=0;session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>{globalThis.__readinessNetwork++;callback({cancel:true});});});
  return page;
}
async function dialogFile(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve(file));}
try{
  let page=await launch();await page.getByRole('button',{name:'Import audio',exact:true}).click();
  let importer=page.getByRole('region',{name:'Import audio recording'});
  await dialogFile(values.decoder);await importer.getByRole('button',{name:'Import decoder ZIP',exact:true}).click();
  await expect(importer.getByText('Local decoder ready · up to 120 minutes / 2 GiB',{exact:true})).toBeVisible({timeout:60000});
  assert((await page.evaluate(()=>window.meetfolioDesktop.getDecoderStatus())).ready);
  await dialogFile(values.speakers);await importer.getByRole('button',{name:'Import model folder',exact:true}).click();
  await expect(importer.getByText('Speaker models ready for offline use.',{exact:true})).toBeVisible({timeout:30000});
  report.stages.push('pinned upstream decoder archive/executable verification and offline speaker model import');
  await dialogFile(source);await importer.getByRole('button',{name:'Choose recording',exact:true}).click();
  const duration=[Math.floor(minutes/60),minutes%60,0].map(n=>String(n).padStart(2,'0')).join(':');
  // Native preflight has a 20-second probe bound plus executable verification.
  await expect(importer.getByText(duration,{exact:false})).toBeVisible({timeout:30000});
  await importer.getByRole('checkbox',{name:'I have permission to process this recording locally.'}).check();
  await page.evaluate(()=>{let paused=false;window.__readinessPauseError=null;window.meetfolioDesktop.subscribeImportProgress(e=>{if(!paused&&e.phase==='Checkpoint saved'&&e.percent<100){paused=true;void window.meetfolioDesktop.cancelAudioImport(e.id).catch(error=>{window.__readinessPauseError=String(error);});}});});
  const started=Date.now();await importer.getByRole('button',{name:'Transcribe recording',exact:true}).click();
  await expect(importer.getByRole('button',{name:/^Resume /})).toBeVisible({timeout:180000});
  assert.equal(await page.evaluate(()=>window.__readinessPauseError),null);
  const tasks=await page.evaluate(async()=>{const r=await window.meetfolioDesktop.listRecordings();return window.meetfolioDesktop.listImportTasks({interviewId:r[0].interviewId});});
  assert.equal(tasks.length,1);assert(tasks[0].completedMs>0&&tasks[0].completedMs<minutes*60000);assert(tasks[0].segmentCount>0);
  report.checkpointMs=tasks[0].completedMs;report.recordingId=tasks[0].recordingId;
  const firstIds=JSON.parse(await fs.readFile(path.join(profile,'recordings',tasks[0].recordingId,'import-checkpoint.json'),'utf8')).segments.map(s=>s.id);
  report.stages.push('actual native decode of long WAV with bounded PCM writes, model release, native inference and paused checkpoint');
  await importer.getByRole('button',{name:'Review confirmed text',exact:true}).click();
  await expect(page.getByRole('region',{name:'Review original text'})).toBeVisible();
  await page.getByRole('button',{name:'Edit segment 1',exact:true}).click();await page.getByRole('textbox',{name:'Edit segment 1',exact:true}).fill('Reviewed public fixture text — preserve across resume.');await page.getByRole('button',{name:'Save edit',exact:true}).click();
  await page.locator('.dt-speaker-name').first().click();await page.getByLabel('Speaker for segment 1',{exact:true}).fill('Reviewed voice');await page.getByRole('button',{name:'Save speaker',exact:true}).click();
  await expect(page.getByTestId('desktop-save-status')).toHaveText('Saved locally');report.networkRequests+=await app.evaluate(()=>globalThis.__readinessNetwork);
  await app.close();app=null;
  // Resume must use the owned saved WAV, without requiring the original source file.
  await fs.rename(source,source+'.source-retained');
  page=await launch();await page.getByRole('button',{name:'Import audio',exact:true}).click();importer=page.getByRole('region',{name:'Import audio recording'});
  await expect(importer.getByRole('button',{name:/^Resume /})).toBeVisible({timeout:30000});
  await importer.getByRole('button',{name:/^Resume /}).click();
  await expect(page.getByRole('region',{name:'Review original text'})).toBeVisible({timeout:180000});
  await expect(page.getByRole('button',{name:'Play audio for segment 1',exact:true})).toContainText('preserve across resume');
  await expect(page.locator('.dt-speaker-name').first()).toHaveText('Reviewed voice');
  const final=JSON.parse(await fs.readFile(path.join(profile,'recordings',tasks[0].recordingId,'import-transcript.json'),'utf8'));
  assert.deepEqual(final.segments.slice(0,firstIds.length).map(s=>s.id),firstIds);
  const records=await page.evaluate(()=>window.meetfolioDesktop.listRecordings());assert.equal(records.length,1);assert.equal(records[0].durationMs,minutes*60000);assert.equal(records[0].bytes,size);
  await page.getByRole('button',{name:'Play audio for segment 1',exact:true}).click();const player=page.getByRole('region',{name:'Segment audio playback'});await expect(player.getByRole('button',{name:'Pause audio'})).toBeVisible();await player.getByRole('button',{name:'Stop audio'}).click();
  await page.getByRole('button',{name:'Export TXT',exact:true}).click({trial:true});
  const exported=path.join(out,'public-fixture-export.txt');await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},exported);
  await page.getByRole('button',{name:'Export TXT',exact:true}).click();
  await expect.poll(async()=>fs.readFile(exported,'utf8').catch(()=>''),{timeout:10000}).toContain('preserve across resume');
  report.stages.push('restart, original-source independence, resume, stable segment IDs, corrected text/voice retention, actual playback and native export');
  // Exercise the native codec route too; only the OS picker is stubbed, not decoding/inference.
  const decoder=await fs.readdir(path.join(profile,'decoders'));const executable=path.join(profile,'decoders',decoder.find(n=>n==='ffmpeg-9.0.2-gyan-win64'),'ffmpeg.exe');
  const mixed=path.resolve(`work/phase3a/ci-fixture/model/${XASR.id}/test_wavs/0.wav`);
  report.nativeFormats=[];
  for(const format of ['mp3','m4a']){
    const encoded=path.join(out,`public-mixed-fixture.${format}`);
    await promisify(execFile)(executable,['-nostdin','-hide_banner','-loglevel','error','-y','-i',mixed,'-threads','2','-c:a',format==='mp3'?'libmp3lame':'aac',encoded],{windowsHide:true});
    await page.getByRole('button',{name:'Import audio',exact:true}).click();importer=page.getByRole('region',{name:'Import audio recording'});
    await dialogFile(encoded);await importer.getByRole('button',{name:'Choose recording',exact:true}).click();
    await importer.getByRole('checkbox',{name:'Automatically separate speakers'}).uncheck();
    await importer.getByRole('checkbox',{name:'I have permission to process this recording locally.'}).check();
    await importer.getByRole('button',{name:'Transcribe recording',exact:true}).click();
    await expect(page.getByRole('region',{name:'Review original text'})).toBeVisible({timeout:90000});
    const items=await page.evaluate(()=>window.meetfolioDesktop.listRecordings());const added=items.find(r=>!records.some(old=>old.id===r.id)&&!report.nativeFormats.some(old=>old.recordingId===r.id));
    assert(added);const text=JSON.parse(await fs.readFile(path.join(profile,'recordings',added.id,'import-transcript.json'),'utf8')).segments.map(s=>s.originalText).join(' ');
    assert(/[\u3400-\u9fff]/.test(text)&&/[A-Za-z]{3}/.test(text),'Public mixed fixture must produce Chinese and English tokens; this is not an accuracy score');
    report.nativeFormats.push({format,recordingId:added.id,durationMs:added.durationMs,chineseAndEnglishTokens:true});records.push(added);
  }
  report.stages.push('actual native MP3 and M4A decoding with public mixed Chinese/English speech');
  report.networkRequests+=await app.evaluate(()=>globalThis.__readinessNetwork);assert.equal(report.networkRequests,0);report.elapsedSeconds=(Date.now()-started)/1000;report.result='Passed';
}catch(error){report.result='Failed';report.error=String(error);throw error;}finally{if(app)await app.close();await fs.writeFile(path.join(out,'readiness-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
