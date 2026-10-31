/** Actual system codec conversion of generated 44.1/48 kHz stereo tones, without physical audio. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
assert(process.platform==='darwin');const root=path.resolve('work/phase5/system-codec');await fs.mkdir(root,{recursive:true});
const helper=path.resolve('work/desktop-runtime/xasr/decoder/meetfolio-audio-decoder');
for(const rate of [44100,48000]){
  const n=rate*2, b=Buffer.alloc(44+n*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);
  for(let i=0;i<n;i++)for(let c=0;c<2;c++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/rate)*8000),44+i*4+c*2);
  const file=path.join(root,`stereo-${rate}.wav`);await fs.writeFile(file,b);
  assert.equal(Number(execFileSync(helper,['--probe',file],{encoding:'utf8'}).trim()),2000);
  const pcm=execFileSync(helper,['--decode',file],{maxBuffer:128000});assert(Math.abs(pcm.length-64000)<=64,`Unexpected resampling duration: ${pcm.length}`);assert(pcm.some(x=>x!==0));
}
const invalid=path.join(root,'invalid.m4a');await fs.writeFile(invalid,'invalid media');
const failure=spawnSync(helper,['--decode',invalid],{encoding:'utf8'});assert.equal(failure.status,1);assert(!failure.stderr.includes(invalid));
console.log('Actual AVFoundation 44.1/48 kHz stereo → 16 kHz mono PCM passed');
