/** Controlled public-fixture benchmark. No microphone or human accuracy acceptance. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { XASR, modelFiles } from '../../server/dist/asr/localXasrModel.js';
const { values } = parseArgs({ options: { audio: { type: 'string', default: 'work/phase4/four-speakers.wav' }, 'runtime-root': { type: 'string', default: 'work/desktop-runtime/xasr' }, 'speaker-count': { type: 'string', default: '4' }, minutes: { type: 'string', default: '120' }, speech: { type: 'boolean', default: false }, diarize: { type: 'boolean', default: false }, interrupt: { type: 'boolean', default: false }, out: { type: 'string', default: 'work/phase4-1/benchmark' } } });
const minutes = Number(values.minutes); assert(minutes > 0 && minutes <= 120);
const out = path.resolve(values.out); await fs.mkdir(out, { recursive: true });
const root = await fs.mkdtemp(path.join(out, 'fixture-')); const audio = path.join(root, 'recording.wav');
const samples = Math.round(minutes * 60 * 16000), bytes = samples * 2;
const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + bytes, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(16000,24); header.writeUInt32LE(32000,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(bytes,40);
const fixture = await fs.readFile(values.audio);
// Walk RIFF chunks, including non-audio metadata; only known mono PCM16 fixtures are accepted.
assert.equal(fixture.toString('ascii',0,4),'RIFF');assert.equal(fixture.toString('ascii',8,12),'WAVE');
let dataOffset=-1, validFormat=false;
for(let offset=12;offset+8<=fixture.length;){const size=fixture.readUInt32LE(offset+4);assert(offset+8+size<=fixture.length);
  const id=fixture.toString('ascii',offset,offset+4);if(id==='fmt '){assert(size>=16);validFormat=fixture.readUInt16LE(offset+8)===1&&fixture.readUInt16LE(offset+10)===1&&fixture.readUInt32LE(offset+12)===16000&&fixture.readUInt16LE(offset+22)===16;}
  if(id==='data'){dataOffset=offset;break;}offset+=8+size+size%2;
}
assert(validFormat);
assert(dataOffset > 0); const pcm = fixture.subarray(dataOffset + 8, dataOffset + 8 + fixture.readUInt32LE(dataOffset + 4));
const file = await fs.open(audio, 'wx');
try { await file.write(header); await file.truncate(44 + bytes);
  if (values.speech) { for (let offset = 0; offset < bytes; offset += pcm.length) await file.write(pcm.subarray(0, Math.min(pcm.length, bytes-offset)), 0, Math.min(pcm.length, bytes-offset), 44+offset); }
  else await file.write(pcm.subarray(0, Math.min(bytes, pcm.length)),0,Math.min(bytes,pcm.length),44);
  await file.sync();
} finally { await file.close(); }
const runtimeRoot = path.resolve(values['runtime-root']);
const files = modelFiles(path.resolve(`work/phase3a/ci-fixture/model/${XASR.id}`));
const recordingId = '01234567-89ab-cdef-0123-456789abcdef';
const speakerRoot = path.resolve('work/phase4/models/sherpa-onnx-pyannote-segmentation-3-0');
const numSpeakers=Number(values['speaker-count']);assert(numSpeakers===-1||(Number.isInteger(numSpeakers)&&numSpeakers>=1&&numSpeakers<=12));
const options = { audio, recordingId, runtimeRoot, files: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner }, tokens: files.tokens, numSpeakers,
  ...(values.diarize ? { speakers: { segmentation: path.join(speakerRoot,'model.int8.onnx'), embedding: path.join(speakerRoot,'3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx') } } : {}) };
const metrics = []; let segments = []; let killed = false;
async function run(resume = false) {
  const child = fork(path.join(runtimeRoot,'asr/audio-import-worker.cjs'), [JSON.stringify({ ...options, resume })], { execArgv: [], windowsHide: true, stdio: ['ignore','ignore','pipe','ipc'] }); child.stderr.resume();
  child.on('message', message => {
    if (message.type === 'metrics') {
      metrics.push({ rss: message.rss, audioBufferBytes: message.audioBufferBytes, completedSamples: message.completedSamples });
      if (values.interrupt && !killed && !resume && message.completedSamples < samples) { killed = true; child.kill(); }
    }
    if (message.type === 'done') segments = message.segments;
  });
  return await new Promise((resolve,reject) => { const timer=setTimeout(()=>{child.kill();reject(new Error('Benchmark timed out'));},30*60*1000); child.once('error',reject); child.once('close',code=>{clearTimeout(timer);resolve(code);}); });
}
const started = Date.now(); const first = await run();
let before = [];
if (killed) { const c = JSON.parse(await fs.readFile(path.join(root,'import-checkpoint.json'),'utf8')); before = c.segments.map(s=>s.id); assert(c.completedSamples > 0 && c.completedSamples < samples); assert.equal(await run(true),0); assert.deepEqual(segments.slice(0,before.length).map(s=>s.id),before); }
else assert.equal(first,0);
const checkpoint = JSON.parse(await fs.readFile(path.join(root,'import-checkpoint.json'),'utf8'));
assert.equal(checkpoint.completedSamples,samples); assert(metrics.length > 0); assert(segments.length > 0);
assert(metrics.every(m => m.audioBufferBytes <= 16000 * 120 * 6));
assert(segments.every(s=>s.audio.recordingId===recordingId && s.startMs>=0 && s.endMs<=samples/16));
const report = { result:'Passed', fixture:values.speech?'continuous repeated public speech':'public speech prefix followed by digital silence', minutes,
  diarize:values.diarize, actualNativeInference:true, physicalDevice:false, accuracyBenchmark:false, elapsedSeconds:(Date.now()-started)/1000,
  maxWorkerRss:Math.max(...metrics.map(m=>m.rss)), maxAudioBufferBytes:Math.max(...metrics.map(m=>m.audioBufferBytes)), windows:metrics.length,
  rssByWindowMiB:metrics.map(m=>Math.round(m.rss/1024/1024)),
  segments:segments.length, speakers:[...new Set(segments.map(s=>s.speakerLabel).filter(Boolean))].length, resumed:killed, preservedSegmentIds:before.length };
await fs.writeFile(path.join(out,'benchmark.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
