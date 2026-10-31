import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicJson, cosine, readCheckpoint, IMPORT_WINDOW_SAMPLES, validImportSegments, type ImportCheckpoint } from '../src/import-checkpoint';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const id = '01234567-89ab-cdef-0123-456789abcdef';
const segment = { id, seq: 1, startMs: 1000, endMs: 2000, originalText: 'Public fixture', editedText: null, speakerLabel: 'Speaker 1', source: 'local', isImportant: false, updatedAt: '2026-10-31T00:00:00Z', audio: { recordingId: id, startMs: 1000, endMs: 2000 }, reviewReasons: ['overlap' as const] };
describe('window checkpoints and voice continuity', () => {
  it('atomically persists and validates a window checkpoint and its segment identities', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-checkpoint-')); roots.push(root);
    const file = path.join(root, 'checkpoint.json');
    const checkpoint: ImportCheckpoint = { schema: 1, samples: IMPORT_WINDOW_SAMPLES * 2, completedSamples: IMPORT_WINDOW_SAMPLES, diarize: true, numSpeakers: -1, voices: [{ label: 'Speaker 1', embedding: [.5, .25], weight: 1 }], segments: [segment] };
    await atomicJson(file, checkpoint); expect(await readCheckpoint(file, id, checkpoint.samples)).toEqual(checkpoint);
    expect(await fs.readdir(root)).toEqual(['checkpoint.json']);
    for (const invalid of [{ completedSamples: 1 }, { samples: 10 }, { voices: [{ label: 'Speaker 1', embedding: [null], weight: 1 }] }, { segments: [{ ...segment, endMs: 121000 }] }]) {
      await atomicJson(file, { ...checkpoint, ...invalid });
      await expect(readCheckpoint(file, id, checkpoint.samples)).rejects.toThrow('Invalid import checkpoint');
    }
  });
  it('rejects duplicate IDs, foreign audio, unknown review reasons and oversized checkpoints', async () => {
    expect(validImportSegments([segment], id, 3000)).toBe(true);
    expect(validImportSegments([segment, segment], id, 3000)).toBe(false);
    expect(validImportSegments([{ ...segment, reviewReasons: ['invented-confidence'] }], id, 3000)).toBe(false);
    expect(validImportSegments([segment], 'foreign', 3000)).toBe(false);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-checkpoint-')); roots.push(root);
    await expect(atomicJson(path.join(root, 'too-large.json'), 'x'.repeat(8 * 1024 * 1024))).rejects.toThrow('recovery limit');
  });
  it('matches normalized voice embeddings independently of magnitude and rejects invalid vectors', () => {
    expect(cosine([1,2], [2,4])).toBeCloseTo(1);
    expect(cosine([1,0], [0,1])).toBe(0);
    expect(cosine([0,0], [1,0])).toBe(-1);
    expect(cosine([1], [1,0])).toBe(-1);
  });
  it('retains the last durable checkpoint through transient Windows replacement locks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetfolio-checkpoint-')); roots.push(root);
    const file = path.join(root, 'checkpoint.json'); await atomicJson(file, { completed: 1 });
    const rename = fs.rename.bind(fs); let locks = 0;
    const replacement = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (locks++ < 2) {
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ completed: 1 });
        throw Object.assign(new Error('Temporary file lock'), { code: 'EPERM' });
      }
      await rename(from, to);
    });
    try { await atomicJson(file, { completed: 2 }); }
    finally { replacement.mockRestore(); }
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ completed: 2 });
    expect(await fs.readdir(root)).toEqual(['checkpoint.json']);
  });
});
