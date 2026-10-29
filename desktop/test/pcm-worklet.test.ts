import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

describe('PCM worklet sample-rate conversion (synthetic samples)', () => {
  it.each([16000, 44100, 48000])('emits bounded mono PCM16 frames at 16 kHz from %i Hz', rate => {
    const messages: { pcm?: ArrayBuffer; rms?: number; flushed?: boolean }[] = [];
    let Processor: any;
    vm.runInNewContext(fs.readFileSync(new URL('../../web/public/pcm-worklet.js', import.meta.url), 'utf8'), {
      sampleRate: rate,
      AudioWorkletProcessor: class { port = { postMessage: (message: object) => messages.push(message), onmessage: null }; },
      registerProcessor: (_name: string, value: unknown) => { Processor = value; },
    });
    const processor = new Processor();
    for (let offset = 0; offset < rate; offset += 128) {
      const block = Float32Array.from({ length: Math.min(128, rate - offset) }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * (offset + i) / rate));
      expect(processor.process([[block]])).toBe(true);
      expect(processor.pendingLen).toBeLessThanOrEqual(2);
    }
    processor.port.onmessage({ data: { type: 'flush' } });
    const frames = messages.filter(message => message.pcm);
    const total = frames.reduce((sum, frame) => sum + frame.pcm!.byteLength / 2, 0);
    expect(Math.abs(total - 16000)).toBeLessThanOrEqual(2);
    for (const frame of frames) {
      expect(frame.pcm!.byteLength).toBeLessThanOrEqual(3200);
      expect(frame.pcm!.byteLength % 2).toBe(0); expect(Number.isFinite(frame.rms)).toBe(true);
    }
    expect(messages.at(-1)?.flushed).toBe(true);
    expect(processor.process([[new Float32Array(128)]])).toBe(false);
  });
});
