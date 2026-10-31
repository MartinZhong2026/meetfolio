import { describe, expect, it } from 'vitest';
import { newInterview } from './model';
import { appendImportedTranscript } from './importTranscript';
import type { Segment } from '../lib/types';
const segment = (id: string, recordingId: string, startMs = 0): Segment => ({ id, seq: 1, startMs, endMs: startMs + 1000, originalText: 'Public fixture', editedText: null, speakerLabel: 'Speaker 1', isImportant: false, source: 'local', updatedAt: '2026-10-31T00:00:00Z', audio: { recordingId, startMs, endMs: startMs + 1000 } });
describe('imported transcript identity and recovery', () => {
  it('keeps file times, appends interview-relative times and distinguishes clusters in different recordings', () => {
    const first = appendImportedTranscript(newInterview(), [segment('a', 'recording-a')], 2000, 'Recording.wav');
    const second = appendImportedTranscript(first, [segment('b', 'recording-b')], 3000);
    expect(second.title).toBe('Recording'); expect(second.elapsedMs).toBe(5000);
    expect(second.segments[1]).toMatchObject({ startMs: 2000, endMs: 3000, seq: 2, audio: { startMs: 0, endMs: 1000 } });
    expect(second.segments[1].speakerLabel).not.toBe(second.segments[0].speakerLabel);
  });
  it('recovers missing IDs at the existing recording offset without replacing corrected text or labels', () => {
    const existing = appendImportedTranscript({ ...newInterview(), elapsedMs: 10000 }, [segment('a', 'recording-a')], 4000);
    existing.segments[0] = { ...existing.segments[0], editedText: 'Reviewed', speakerLabel: 'Alice' };
    const recovered = appendImportedTranscript(existing, [segment('a', 'recording-a'), segment('b', 'recording-a', 2000)], 4000);
    expect(recovered.segments).toHaveLength(2); expect(recovered.elapsedMs).toBe(14000);
    expect(recovered.segments[0]).toMatchObject({ editedText: 'Reviewed', speakerLabel: 'Alice' });
    expect(recovered.segments[1]).toMatchObject({ startMs: 12000, endMs: 13000 });
    expect(appendImportedTranscript(recovered, [segment('a', 'recording-a'), segment('b', 'recording-a', 2000)], 4000).segments).toEqual(recovered.segments);
  });
});
