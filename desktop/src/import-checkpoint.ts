import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Segment } from '../../web/src/lib/types';
export const IMPORT_WINDOW_SAMPLES = 16000 * 120;
export const IMPORT_MAX_SAMPLES = 16000 * 120 * 60;
export type ReviewReason = 'overlap' | 'window-boundary' | 'short-turn';
export interface Voice { label: string; embedding: number[]; weight: number }
export interface ImportCheckpoint {
  schema: 1; samples: number; completedSamples: number; diarize: boolean; numSpeakers: number;
  voices: Voice[]; segments: Segment[];
  name?: string;
}
export async function atomicJson(file: string, value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Import text exceeds recovery limit; audio retained');
  const temporary = file + '.' + randomUUID() + '.part';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await renameWithRetry(temporary, file);
}
export async function renameWithRetry(source: string, destination: string) {
  // Windows scanners/readers may briefly hold files without delete sharing.
  // Keep the previous checkpoint intact and retry replacement for a bounded interval.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(source, destination); break; }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
export function validImportSegments(value: unknown, recordingId: string, durationMs: number): value is Segment[] {
  if (!Array.isArray(value) || value.length > 10000) return false;
  const ids = new Set<string>();
  return value.every(s => {
    if (!s || typeof s.id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s.id) || ids.has(s.id)) return false;
    ids.add(s.id);
    return Number.isInteger(s.seq) && s.seq > 0 && typeof s.originalText === 'string' && s.originalText.length <= 200000 &&
      s.editedText === null && s.source === 'local' && s.isImportant === false && typeof s.updatedAt === 'string' && Number.isFinite(Date.parse(s.updatedAt)) &&
      (s.speakerLabel === null || (typeof s.speakerLabel === 'string' && /^Speaker \d{1,3}$/.test(s.speakerLabel))) &&
      Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.startMs >= 0 && s.endMs > s.startMs && s.endMs <= durationMs &&
      s.audio?.recordingId === recordingId && s.audio.startMs === s.startMs && s.audio.endMs === s.endMs &&
      (s.reviewReasons === undefined || (Array.isArray(s.reviewReasons) && s.reviewReasons.length <= 3 && s.reviewReasons.every((r: unknown) => ['overlap', 'window-boundary', 'short-turn'].includes(r as string))));
  });
}
export async function readCheckpoint(file: string, recordingId: string, samples: number): Promise<ImportCheckpoint> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Invalid import checkpoint');
  const c = JSON.parse(await fs.readFile(file, 'utf8')) as ImportCheckpoint;
  if (c.schema !== 1 || (c.name !== undefined && (typeof c.name !== 'string' || c.name.length > 200)) || c.samples !== samples || !Number.isInteger(c.completedSamples) || c.completedSamples < 0 || c.completedSamples > samples ||
      (c.completedSamples !== samples && c.completedSamples % IMPORT_WINDOW_SAMPLES !== 0) || typeof c.diarize !== 'boolean' ||
      !Number.isInteger(c.numSpeakers) || (c.numSpeakers !== -1 && (c.numSpeakers < 1 || c.numSpeakers > 12)) ||
      !Array.isArray(c.voices) || c.voices.length > 12 || !c.voices.every(v => /^Speaker \d{1,2}$/.test(v.label) && Number.isInteger(v.weight) && v.weight > 0 &&
        Array.isArray(v.embedding) && v.embedding.length > 0 && v.embedding.length <= 512 && v.embedding.every(n => Number.isFinite(n) && Math.abs(n) <= 10)) ||
      !validImportSegments(c.segments, recordingId, c.completedSamples / 16)) throw new Error('Invalid import checkpoint');
  return c;
}
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}
