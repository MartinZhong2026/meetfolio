import { api, ApiError } from '../lib/api';
import type { Gap } from '../lib/types';
import { MeetingAudioBuffer } from './chunkStore';

export type RecoveryOutcome = 'uploaded' | 'no_local_audio' | 'busy' | 'failed';

/**
 * Hands the audio this browser still holds for a transcript gap back to the server for re-transcription.
 * Works from any page (live workspace or review): the audio lives in IndexedDB keyed by meeting id.
 */
export async function recoverGapFromLocalAudio(meetingId: string, gap: Gap, fallbackEndMs?: number): Promise<RecoveryOutcome> {
  const buffer = new MeetingAudioBuffer(meetingId);
  try {
    const hi = gap.endMs ?? fallbackEndMs ?? (await buffer.latestEnd()) ?? gap.startMs;
    const data = await buffer.read(gap.startMs, hi);
    if (!data) return 'no_local_audio';
    await api.uploadGapAudio(meetingId, gap.id, data.fromMs, data.pcm);
    return 'uploaded';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return 'busy';
    return 'failed';
  }
}

export async function localAudioCoverage(meetingId: string, gap: Gap): Promise<number> {
  const buffer = new MeetingAudioBuffer(meetingId);
  try {
    const hi = gap.endMs ?? (await buffer.latestEnd()) ?? gap.startMs;
    return (await buffer.read(gap.startMs, hi))?.coveredMs ?? 0;
  } catch {
    return 0;
  }
}
