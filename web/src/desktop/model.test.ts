import { describe, expect, it } from 'vitest';
import { emptyNotebook, parseNotebook, recoverNotebook } from './model';
import { syntheticInterview } from './fixtures';
import { readNotebook, writeNotebook } from './persistence';
import { exportText } from './exports';
import { confirmedModel } from './runtime';
describe('local research persistence and recovery', () => {
  it('preserves optional file-relative WAV evidence across IndexedDB and JSON without requiring it on legacy records', async () => {
    const i = syntheticInterview();
    const audio = { recordingId: '01234567-89ab-cdef-0123-456789abcdef', startMs: 100.0625, endMs: 200.125 };
    i.segments[0].audio = audio;
    const book = { schema: 1 as const, activeId: i.id, interviews: [i] };
    expect(parseNotebook(JSON.parse(JSON.stringify(book))).interviews[0].segments[0].audio).toEqual(audio);
    await writeNotebook(book);
    expect((await readNotebook()).interviews[0].segments[0].audio).toEqual(audio);
    expect(exportText(i, true)).toContain(`WAV: ${audio.recordingId}; file time 100.0625–200.125 ms`);
    for (const invalid of [{ ...audio, recordingId: '../audio' }, { ...audio, startMs: -1 }, { ...audio, endMs: 0 }, { ...audio, startMs: NaN }]) {
      expect(() => parseNotebook({ ...book, interviews: [{ ...i, segments: [{ ...i.segments[0], audio: invalid }] }] })).toThrow();
    }
    delete i.segments[0].audio;
    expect(parseNotebook(book).interviews[0].segments[0].audio).toBeUndefined();
  });
  it('round-trips drafts, categories and corrected/original transcript without losing evidence', async () => {
    const i = syntheticInterview();
    i.segments[1].editedText = '人工校对版本';
    i.draftNote = '未完成笔记';
    i.manualDraft = '手工补记草稿';
    const book = { schema: 1 as const, activeId: i.id, interviews: [i] };
    await writeNotebook(book);
    expect(await readNotebook()).toEqual(book);
    const md = exportText(i, true);
    expect(md).toContain('DEMO / synthetic');
    expect(md).toContain('人工校对版本');
    expect(md).toContain(i.segments[1].originalText);
    expect(md).toContain(`#seg-${i.segments[1].seq}`);
    expect(md).toContain('手工补记草稿');
    expect(md).toContain('未完成笔记');
  });
  it('recovers an active recording as interrupted, never recording or falsely recovered audio', () => {
    const b = emptyNotebook();
    b.interviews[0].recording = 'recording';
    const result = recoverNotebook(b);
    expect(result.recovered).toBe(true);
    expect(result.book.interviews[0].recording).toBe('interrupted');
    expect(result.book.interviews[0].interruption).toContain(
      'Review any gaps',
    );
    b.interviews[0].recording = 'paused';
    expect(recoverNotebook(b).recovered).toBe(false);
  });
  it('preserves local text references in notebook backups without turning them into participant speech', () => {
    const b = emptyNotebook();
    b.interviews[0].referenceFiles = [{ id: 'ref-1', name: 'guide.md', kind: 'md', text: 'Research background', addedAt: '2026-10-26T00:00:00Z' }];
    expect(parseNotebook(b).interviews[0].referenceFiles).toEqual(b.interviews[0].referenceFiles);
    expect(exportText(b.interviews[0], true)).toContain('background reference, not interview speech');
    expect(exportText(b.interviews[0], true)).toContain('Research background');
    const legacy = { ...b, interviews: [{ ...b.interviews[0], referenceFiles: undefined }] };
    expect(parseNotebook(legacy).interviews[0].referenceFiles).toBeUndefined();
    const broken = { ...b, interviews: [{ ...b.interviews[0], referenceFiles: [{ id: 'ref-1', name: 'bad.pdf', kind: 'pdf', text: 'x', addedAt: 'today' }] }] };
    expect(() => parseNotebook(broken)).toThrow();
  });
  it('rejects wrong backup versions, nested corruption, duplicate evidence sequence and unsafe ids', () => {
    const i = syntheticInterview();
    const b = { schema: 1 as const, activeId: i.id, interviews: [i] };
    expect(parseNotebook(b)).toEqual(b);
    expect(() => parseNotebook({ ...b, schema: 2 })).toThrow();
    expect(() =>
      parseNotebook({
        ...b,
        interviews: [
          { ...i, notes: [{ ...i.notes[0], category: 'invented' }] },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseNotebook({
        ...b,
        interviews: [
          { ...i, segments: [i.segments[0], { ...i.segments[1], seq: 1 }] },
        ],
      }),
    ).toThrow();
    expect(() => parseNotebook({ ...b, activeId: '<script>' })).toThrow();
  });
  it('requires an offline installed model identity, not just a ready-looking state', () => {
    expect(
      confirmedModel({ state: 'installed', modelId: 'test', offline: true }),
    ).toBe(false);
    expect(
      confirmedModel({ state: 'installed', modelId: '', offline: true }),
    ).toBe(false);
    expect(
      confirmedModel({ state: 'missing', modelId: 'test', offline: true }),
    ).toBe(false);
    expect(
      confirmedModel({
        state: 'installed',
        modelId: 'test',
        offline: true,
        engineLoaded: true,
      }),
    ).toBe(true);
  });
});
