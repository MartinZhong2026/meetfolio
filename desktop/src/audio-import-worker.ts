/** Isolated offline inference. Receives only host-owned paths; no network API. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const options = JSON.parse(process.argv[2]);
const requireNative = createRequire(path.join(options.runtimeRoot, 'package.json'));
process.on('disconnect', () => process.exit(0));
try {
  const sherpa = requireNative('sherpa-onnx-node');
  const bytes = fs.readFileSync(options.audio);
  const samples = new Float32Array((bytes.length - 44) / 2);
  for (let n = 0; n < samples.length; n++) samples[n] = bytes.readInt16LE(44 + n * 2) / 32768;
  let turns = [{ start: 0, end: samples.length / 16000, speaker: -1 }];
  if (options.speakers) {
    process.send?.({ type: 'progress', phase: 'Separating speakers', percent: 5 });
    const diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: options.speakers.segmentation }, numThreads: 2, provider: 'cpu', debug: 0 },
      embedding: { model: options.speakers.embedding, numThreads: 2, provider: 'cpu', debug: 0 },
      // Sherpa's documented ERes2Net example uses 0.9 for unknown speaker counts.
      clustering: { numClusters: options.numSpeakers, threshold: 0.9 }, minDurationOn: 0.3, minDurationOff: 0.5,
    });
    if (diarizer.sampleRate !== 16000) throw new Error('Unsupported model rate');
    turns = diarizer.process(samples).sort((a: any, b: any) => a.start - b.start);
  }
  const recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: options.files, tokens: options.tokens, modelType: 'zipformer2', numThreads: 2, provider: 'cpu', debug: 0 },
    enableEndpoint: true, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 25,
  });
  const segments: any[] = [];
  const speakerLabels = new Map<number, number>();
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    const start = Math.max(0, Math.round(turn.start * 16000));
    const end = Math.min(samples.length, Math.round(turn.end * 16000));
    if (end <= start) continue;
    const stream = recognizer.createStream();
    let segmentStart = start;
    const emit = (position: number) => {
      const text = recognizer.getResult(stream).text?.trim();
      if (turn.speaker >= 0 && !speakerLabels.has(turn.speaker)) speakerLabels.set(turn.speaker, speakerLabels.size + 1);
      if (text && position > segmentStart) segments.push({ originalText: text, startMs: segmentStart / 16, endMs: position / 16, speakerLabel: turn.speaker < 0 ? null : `Speaker ${speakerLabels.get(turn.speaker)}` });
      segmentStart = position;
    };
    for (let offset = start; offset < end; offset += 1600) {
      const position = Math.min(end, offset + 1600);
      stream.acceptWaveform({ samples: samples.subarray(offset, position), sampleRate: 16000 });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      if (recognizer.isEndpoint(stream)) { emit(position); recognizer.reset(stream); }
      if ((offset - start) % 16000 === 0) process.send?.({ type: 'progress', phase: 'Transcribing on this device', percent: Math.min(99, 10 + Math.round(position / samples.length * 89)) });
    }
    stream.acceptWaveform({ samples: new Float32Array(16000), sampleRate: 16000 }); stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    emit(end);
    if (segments.length > 10000) throw new Error('Too many segments');
  }
  process.send?.({ type: 'done', segments }, () => process.exit(0));
} catch { process.send?.({ type: 'failed' }, () => process.exit(1)); }
