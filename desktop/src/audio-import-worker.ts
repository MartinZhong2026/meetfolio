/** Isolated offline inference; audio memory is bounded to a two-minute window. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { atomicJson, cosine, IMPORT_WINDOW_SAMPLES, readCheckpoint, type ImportCheckpoint, type ReviewReason } from './import-checkpoint';
const options = JSON.parse(process.argv[2]);
process.on('disconnect', () => process.exit(0));
void (async () => {
  let fd: number | undefined;
  let phase = 'loading models';
  try {
    try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Optional scheduler hint. */ }
    const sherpa = createRequire(path.join(options.runtimeRoot, 'package.json'))('sherpa-onnx-node');
    fd = fs.openSync(options.audio, 'r');
    const total = (fs.fstatSync(fd).size - 44) / 2;
    const checkpointFile = path.join(path.dirname(options.audio), 'import-checkpoint.json');
    let state: ImportCheckpoint = { schema: 1, samples: total, completedSamples: 0, diarize: !!options.speakers, numSpeakers: options.numSpeakers, voices: [], segments: [], ...(options.name ? { name: options.name } : {}) };
    if (options.resume) { phase = 'reading checkpoint'; state = await readCheckpoint(checkpointFile, options.recordingId, total); }
    if (state.diarize !== !!options.speakers || state.numSpeakers !== options.numSpeakers) throw new Error('Checkpoint settings mismatch');
    if (!options.resume) { phase = 'saving checkpoint'; await atomicJson(checkpointFile, state); }
    phase = 'loading models';
    const recognizer = new sherpa.OnlineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { transducer: options.files, tokens: options.tokens, modelType: 'zipformer2', numThreads: 2, provider: 'cpu', debug: 0 },
      enableEndpoint: true, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 25 });
    const diarizer = options.speakers ? new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: options.speakers.segmentation }, numThreads: 2, provider: 'cpu', debug: 0 },
      embedding: { model: options.speakers.embedding, numThreads: 2, provider: 'cpu', debug: 0 },
      clustering: { numClusters: total <= IMPORT_WINDOW_SAMPLES ? options.numSpeakers : -1, threshold: 0.9 }, minDurationOn: 0.3, minDurationOff: 0.5,
    }) : null;
    const extractor = options.speakers ? new sherpa.SpeakerEmbeddingExtractor({ model: options.speakers.embedding, numThreads: 2, provider: 'cpu', debug: 0 }) : null;
    const pcm = Buffer.alloc(Math.min(total, IMPORT_WINDOW_SAMPLES) * 2), float = new Float32Array(Math.min(total, IMPORT_WINDOW_SAMPLES));
    const report = (phase: string, sample: number) => process.send?.({ type: 'progress', phase, percent: Math.min(100, Math.round(sample / total * 100)), completedMs: state.completedSamples / 16, totalMs: total / 16 });
    for (let base = state.completedSamples; base < total; base += IMPORT_WINDOW_SAMPLES) {
      phase = 'reading saved audio';
      const count = Math.min(IMPORT_WINDOW_SAMPLES, total - base); let read = 0;
      while (read < count * 2) { const n = fs.readSync(fd, pcm, read, count * 2 - read, 44 + base * 2 + read); if (!n) throw new Error('Truncated audio'); read += n; }
      for (let n = 0; n < count; n++) float[n] = pcm.readInt16LE(n * 2) / 32768;
      const samples = float.subarray(0, count);
      report(diarizer ? 'Separating speakers' : 'Transcribing on this device', base);
      const silent = !samples.some(sample => sample !== 0);
      phase = 'separating speakers';
      const turns: { start: number; end: number; speaker: number }[] = silent ? [] : diarizer ? diarizer.process(samples).sort((a: any, b: any) => a.start - b.start) : [{ start: 0, end: count / 16000, speaker: -1 }];
      const labels = new Map<number, string>();
      for (const speaker of new Set(turns.filter(t => t.speaker >= 0).map(t => t.speaker))) {
        const longest = turns.filter(t => t.speaker === speaker).sort((a,b) => (b.end-b.start)-(a.end-a.start))[0];
        const stream = extractor.createStream();
        stream.acceptWaveform({ samples: samples.subarray(Math.round(longest.start * 16000), Math.min(count, Math.round(Math.min(longest.end, longest.start + 16) * 16000))), sampleRate: 16000 }); stream.inputFinished();
        if (!extractor.isReady(stream)) { labels.set(speaker, ''); continue; }
        const embedding = Array.from(extractor.compute(stream, false)) as number[];
        const ranked = state.voices.map(v => ({ v, score: cosine(v.embedding, embedding) })).sort((a,b) => b.score-a.score);
        let voice = ranked[0]?.score >= 0.55 ? ranked[0].v : undefined;
        if (!voice && state.voices.length >= (options.numSpeakers > 0 ? options.numSpeakers : 12)) voice = ranked[0]?.v;
        if (!voice) { voice = { label: `Speaker ${state.voices.length + 1}`, embedding, weight: 1 }; state.voices.push(voice); }
        else { voice.embedding = voice.embedding.map((n,i) => (n * voice!.weight + embedding[i]) / (voice!.weight + 1)); voice.weight++; }
        labels.set(speaker, voice.label);
      }
      for (const turn of turns) {
        phase = 'transcribing audio';
        const start = Math.max(0, Math.round(turn.start * 16000)), end = Math.min(count, Math.round(turn.end * 16000)); if (end <= start) continue;
        const reasons: ReviewReason[] = [];
        if (turns.some(t => t !== turn && t.speaker !== turn.speaker && Math.min(t.end, turn.end) - Math.max(t.start, turn.start) > 0.15)) reasons.push('overlap');
        if ((base > 0 && start < 16000) || (base + count < total && count - end < 16000)) reasons.push('window-boundary');
        if (end - start < 16000) reasons.push('short-turn');
        const stream = recognizer.createStream(); let segmentStart = start;
        const emit = (position: number) => {
          const text = recognizer.getResult(stream).text?.trim();
          if (text && position > segmentStart) {
            const startMs = (base + segmentStart) / 16, endMs = (base + position) / 16;
            state.segments.push({ id: randomUUID(), seq: state.segments.length + 1, originalText: text, editedText: null, speakerLabel: labels.get(turn.speaker) || null,
              startMs, endMs, isImportant: false, source: 'local', updatedAt: new Date().toISOString(), audio: { recordingId: options.recordingId, startMs, endMs }, ...(reasons.length ? { reviewReasons: reasons } : {}) });
          }
          segmentStart = position;
        };
        for (let offset = start; offset < end; offset += 1600) {
          const position = Math.min(end, offset + 1600); stream.acceptWaveform({ samples: samples.subarray(offset, position), sampleRate: 16000 });
          while (recognizer.isReady(stream)) recognizer.decode(stream);
          if (recognizer.isEndpoint(stream)) { emit(position); recognizer.reset(stream); }
          if ((offset - start) % 16000 === 0) report('Transcribing on this device', base + position);
        }
        stream.acceptWaveform({ samples: new Float32Array(16000), sampleRate: 16000 }); stream.inputFinished();
        while (recognizer.isReady(stream)) recognizer.decode(stream);
        emit(end); if (state.segments.length > 10000) throw new Error('Too many segments');
      }
      phase = 'saving checkpoint';
      state.completedSamples = base + count; await atomicJson(checkpointFile, state); report('Checkpoint saved', state.completedSamples);
      process.send?.({ type: 'metrics', rss: process.memoryUsage().rss, audioBufferBytes: pcm.length + float.byteLength, completedSamples: state.completedSamples });
    }
    process.send?.({ type: 'done', segments: state.segments }, () => process.exit(0));
  } catch { process.send?.({ type: 'failed', phase }, () => process.exit(1)); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
})();
