import type { Interview } from './model';
import type { Segment } from '../lib/types';
/** Cluster numbers identify voices in one file, never across unrelated recordings. */
export function appendImportedTranscript(current: Interview, incoming: Segment[], durationMs: number, name?: string): Interview {
  const known = new Set(current.segments.map(s => s.id));
  const missing = incoming.filter(s => !known.has(s.id));
  if (!missing.length) return { ...current, stage: 'review' };
  const recordingId = missing[0].audio?.recordingId;
  const anchor = current.segments.find(s => s.audio?.recordingId === recordingId);
  const offset = anchor?.audio ? anchor.startMs - anchor.audio.startMs : current.elapsedMs;
  const names = new Map<string, string>();
  for (const segment of missing) {
    if (!segment.speakerLabel || names.has(segment.speakerLabel)) continue;
    const clash = current.segments.some(s => s.speakerLabel === segment.speakerLabel && s.audio?.recordingId !== recordingId);
    names.set(segment.speakerLabel, clash ? `${segment.speakerLabel} · ${recordingId?.slice(0, 8) || 'import'}` : segment.speakerLabel);
  }
  const seq = current.segments.reduce((max, s) => Math.max(max, s.seq), 0);
  return { ...current, title: current.title || name?.replace(/\.[^.]+$/, '') || 'Imported recording', stage: 'review', recording: 'ended',
    elapsedMs: Math.max(current.elapsedMs, offset + durationMs),
    segments: [...current.segments, ...missing.map((s, n) => ({ ...s, seq: seq + n + 1, startMs: s.startMs + offset, endMs: s.endMs + offset, speakerLabel: s.speakerLabel ? names.get(s.speakerLabel)! : null }))],
  };
}
