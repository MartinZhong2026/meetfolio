import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const puts: Array<{ id: string; body: Record<string, unknown> }> = [];
let failNext = 0;
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
    get isNetwork() {
      return this.status === 0;
    }
  },
  api: {
    putNote: vi.fn(async (_m: string, id: string, body: Record<string, unknown>) => {
      if (failNext > 0) {
        failNext--;
        const { ApiError } = await import('../lib/api');
        throw new ApiError(0, 'network', 'offline');
      }
      puts.push({ id, body });
      return { note: { id, ...body } };
    }),
    deleteNote: vi.fn(async () => ({ ok: true })),
    patchSegment: vi.fn(async (_m: string, id: string, patch: Record<string, unknown>) => ({ segment: { id, ...patch } })),
  },
}));

import { editNote, restoreNoteDrafts, useWorkspace } from './workspace';

const MID = 'meeting-1';
const bundle = (notes: unknown[] = []) =>
  ({
    meeting: { id: MID, title: 't', recordedMs: 0, transcriptStatus: 'none' },
    participants: [],
    notes,
    documents: [],
    questions: [],
    segments: [],
    gaps: [],
    summary: null,
  }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  puts.length = 0;
  failNext = 0;
  localStorage.clear();
  useWorkspace.getState().init(bundle());
});
afterEach(() => vi.useRealTimers());

describe('note autosave', () => {
  it('coalesces rapid typing into one idempotent PUT and clears the local draft once acknowledged', async () => {
    const id = crypto.randomUUID();
    for (const text of ['受', '受访', '受访者提到']) {
      editNote(MID, id, { content: text, category: 'quote' }, { timestampMs: 62_000 });
      vi.advanceTimersByTime(200);
    }
    expect(puts).toHaveLength(0); // still inside the debounce window
    expect(JSON.parse(localStorage.getItem(`mf:note-drafts:${MID}`)!)[id].content).toBe('受访者提到'); // mirrored immediately
    await vi.advanceTimersByTimeAsync(800);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toMatchObject({ content: '受访者提到', category: 'quote', timestampMs: 62_000 });
    expect(localStorage.getItem(`mf:note-drafts:${MID}`)).toBeNull();
    expect(useWorkspace.getState().save.pending).toBe(0);
    expect(useWorkspace.getState().save.lastSavedAt).not.toBeNull();
  });

  it('keeps the draft and retries when the network is down, reporting the failure state meanwhile', async () => {
    const id = crypto.randomUUID();
    failNext = 2;
    editNote(MID, id, { content: '现场观察：犹豫' }, { immediate: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(useWorkspace.getState().save.failed).toBe(true);
    expect(localStorage.getItem(`mf:note-drafts:${MID}`)).toContain('现场观察：犹豫');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(puts.at(-1)!.body.content).toBe('现场观察：犹豫');
    expect(useWorkspace.getState().save.failed).toBe(false);
    expect(localStorage.getItem(`mf:note-drafts:${MID}`)).toBeNull();
  });

  it('after a crash/reload, unsent drafts are restored and sent, while acknowledged notes are not re-sent', async () => {
    const lost = crypto.randomUUID();
    const saved = crypto.randomUUID();
    localStorage.setItem(
      `mf:note-drafts:${MID}`,
      JSON.stringify({
        [lost]: { category: 'followup', content: '后续追问：培训项目是否有明确的考核制度？', isImportant: false, timestampMs: 1000 },
        [saved]: { category: 'general', content: '已保存', isImportant: false, timestampMs: null },
      }),
    );
    useWorkspace.getState().init(bundle([{ id: saved, category: 'general', content: '已保存', isImportant: false, timestampMs: null, createdAt: '', updatedAt: '' }]));
    restoreNoteDrafts(MID);
    await vi.advanceTimersByTimeAsync(50);
    expect(puts.map((p) => p.id)).toEqual([lost]);
    expect(useWorkspace.getState().notes.find((n) => n.id === lost)?.content).toContain('考核制度');
  });

  it('empty abandoned drafts are not sent', async () => {
    localStorage.setItem(`mf:note-drafts:${MID}`, JSON.stringify({ [crypto.randomUUID()]: { category: 'general', content: '  ', isImportant: false, timestampMs: null } }));
    restoreNoteDrafts(MID);
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts).toHaveLength(0);
  });
});

describe('transcript store', () => {
  const seg = (seq: number, startMs: number) => ({ id: `s${seq}`, seq, startMs, endMs: startMs + 1000, originalText: `t${seq}`, editedText: null, speakerLabel: null, isImportant: false, source: 'live', updatedAt: '' });

  it('appends in order in O(1), replaces by id (no duplicates), and places late recovered segments by time', () => {
    const st = useWorkspace.getState();
    st.upsertSegment(seg(1, 0) as never);
    st.upsertSegment(seg(2, 5000) as never);
    st.upsertSegment(seg(2, 5000) as never); // duplicate delivery of the same final
    expect(useWorkspace.getState().segments.map((s) => s.id)).toEqual(['s1', 's2']);
    st.upsertSegment(seg(3, 2000) as never); // recovered later, belongs in the middle
    expect(useWorkspace.getState().segments.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
  });
});
