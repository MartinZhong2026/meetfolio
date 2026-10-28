/**
 * CPU inference lives in a child process so decoding never blocks the host event loop.
 * Process isolation also releases native allocations on exit and contains native aborts.
 * The desktop installer must bundle the pinned platform native dependency.
 * Receives mono 16 kHz PCM16 buffers; never sends audio to the network.
 */

import { createRequire } from 'node:module';
import type { XAsrModelFiles } from './localXasrModel.js';

const port = { postMessage: (message: object) => process.send?.(message), on: process.on.bind(process) };
const files = JSON.parse(process.argv[2]!) as XAsrModelFiles;
type Stream = { acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void };
type Recognizer = {
  createStream(): Stream;
  isReady(s: Stream): boolean;
  decode(s: Stream): void;
  getResult(s: Stream): { text: string };
  isEndpoint(s: Stream): boolean;
  reset(s: Stream): void;
};
let recognizer: Recognizer;
let stream: Stream;
let receivedSamples = 0;
let utteranceStartMs = 0;
let utteranceIndex = 0;
let lastText = '';
let ended = false;

const milliseconds = () => Math.round(receivedSamples / 16);
const postError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : 'Unknown local ASR error';
  port.postMessage({ type: 'error', message: msg.slice(0, 220) });
};
const emitFinal = () => {
  const endMs = milliseconds();
  port.postMessage({ type: 'result', kind: 'final', key: String(utteranceIndex), startMs: utteranceStartMs, endMs, text: lastText.trim() });
  utteranceIndex++;
  utteranceStartMs = endMs;
  lastText = '';
};
const decodeAvailable = () => {
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const text = recognizer.getResult(stream).text?.trim() ?? '';
  if (text !== lastText) {
    lastText = text;
    if (text) port.postMessage({ type: 'result', kind: 'interim', key: String(utteranceIndex), startMs: utteranceStartMs, endMs: null, text });
  }
  if (recognizer.isEndpoint(stream)) {
    emitFinal();
    recognizer.reset(stream);
  }
};

try {
  const load = createRequire(import.meta.url);
  const sherpa = load('sherpa-onnx-node') as { OnlineRecognizer: new (config: object) => Recognizer };
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner },
      tokens: files.tokens,
      modelType: 'zipformer2',
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 30,
  });
  stream = recognizer.createStream();
  port.postMessage({ type: 'ready' });
} catch (e) {
  postError(e);
  process.exitCode = 1;
}

port.on('message', (message: { type: 'audio' | 'finish'; pcm?: Uint8Array }) => {
  if (!recognizer || !stream || ended) return;
  try {
    if (message.type === 'audio' && message.pcm) {
      const bytes = message.pcm;
      if (bytes.byteLength % 2) throw new Error('Unaligned PCM16 audio');
      const numSamples = bytes.byteLength / 2;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 0; offset < numSamples; offset += 1600) {
        const count = Math.min(1600, numSamples - offset);
        const samples = new Float32Array(count);
        for (let i = 0; i < count; i++) samples[i] = view.getInt16((offset + i) * 2, true) / 32768;
        receivedSamples += count;
        stream.acceptWaveform({ samples, sampleRate: 16000 });
        decodeAvailable();
      }
      port.postMessage({ type: 'ack', bytes: numSamples * 2 });
    } else if (message.type === 'finish') {
      stream.acceptWaveform({ samples: new Float32Array(16000), sampleRate: 16000 });
      stream.inputFinished();
      decodeAvailable();
      // A final result confirms all original samples, not the artificial tail padding.
      if (lastText) emitFinal();
      ended = true;
      const { maxRSS, userCPUTime, systemCPUTime } = process.resourceUsage();
      port.postMessage({ type: 'metrics', metrics: { rss: process.memoryUsage().rss, maxRSS, userCPUTime, systemCPUTime } });
      port.postMessage({ type: 'finished' });
    }
  } catch (e) {
    ended = true;
    postError(e);
  }
});

// Never leave a native process behind when its desktop/server host exits.
process.on('disconnect', () => process.exit(0));
