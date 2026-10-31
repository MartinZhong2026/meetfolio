import { describe, expect, it } from 'vitest';
import { pcmFrame, validateAudioFile } from './audioDecode';
describe('audio import format and downmix', () => {
  it('accepts supported suffixes and rejects zero, oversized and unsupported files', () => {
    for (const name of ['voice.WAV', 'voice.mp3', 'voice.m4a']) expect(() => validateAudioFile({ name, size: 100 })).not.toThrow();
    for (const file of [{ name: 'voice.exe', size: 100 }, { name: 'voice.wav', size: 0 }, { name: 'voice.wav', size: 64 * 1024 * 1024 + 1 }]) expect(() => validateAudioFile(file)).toThrow();
  });
  it('downmixes stereo, clamps PCM16 extremes, handles nonfinite samples and honors slice boundaries', () => {
    const channels = [new Float32Array([0, 1, -1, 2, NaN, .5]), new Float32Array([0, 1, -1, 2, 0, -.5])];
    const buffer = { numberOfChannels: 2, getChannelData: (n: number) => channels[n] } as AudioBuffer;
    const bytes = pcmFrame(buffer, 1, 5); const view = new DataView(bytes.buffer);
    expect(Array.from({ length: 5 }, (_, n) => view.getInt16(n * 2, true))).toEqual([32767, -32768, 32767, 0, 0]);
  });
});
