import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { uuid } from '../lib/format';
import type { Bundle, Gap, Meeting, Note, NoteCategory, Participant, Question, RefDoc, Segment, Summary } from '../lib/types';
import type { ProviderState, RecState } from '../audio/transcriber';

export interface RecInfo {
  state: RecState;
  positionMs: number;
  provider: ProviderState;
  attempt: number;
  connectionFailed: boolean;
  level: number;
  persistOk: boolean;
  storageOk: boolean;
  error: { code: string; message: string; fatal: boolean } | null;
}

const initialRec: RecInfo = { state: 'idle', positionMs: 0, provider: 'idle', attempt: 0, connectionFailed: false, level: 0, persistOk: true, storageOk: true, error: null };

interface WorkspaceState {
  meetingId: string | null;
  loaded: boolean;
  meeting: Meeting | null;
  participants: Participant[];
  notes: Note[];
  documents: RefDoc[];
  questions: Question[];
  segments: Segment[];
  gaps: Gap[];
  summary: Summary | null;
  interim: { key: string; text: string; startMs: number } | null;
  rec: RecInfo;
  save: { pending: number; failed: boolean; lastSavedAt: number | null };

  init(b: Bundle): void;
  reset(): void;
  setSegments(s: Segment[]): void;
  upsertSegment(s: Segment): void;
  setInterim(i: WorkspaceState['interim']): void;
  setGaps(g: Gap[]): void;
  patchRec(p: Partial<RecInfo>): void;
  patchMeeting(m: Partial<Meeting>): void;
  setDocuments(d: RefDoc[]): void;
  setQuestions(q: Question[]): void;
  setSummary(s: Summary | null): void;
}

const bySegOrder = (a: Segment, b: Segment) => a.startMs - b.startMs || a.seq - b.seq;

export const useWorkspace = create<WorkspaceState>((set) => ({
  meetingId: null,
  loaded: false,
  meeting: null,
  participants: [],
  notes: [],
  documents: [],
  questions: [],
  segments: [],
  gaps: [],
  summary: null,
  interim: null,
  rec: initialRec,
  save: { pending: 0, failed: false, lastSavedAt: null },

  init: (b) =>
    set({
      meetingId: b.meeting.id,
      loaded: true,
      meeting: b.meeting,
      participants: b.participants,
      notes: b.notes,
      documents: b.documents,
      questions: b.questions,
      segments: [...b.segments].sort(bySegOrder),
      gaps: b.gaps,
      summary: b.summary,
      interim: null,
      rec: { ...initialRec, positionMs: b.meeting.recordedMs },
      save: { pending: 0, failed: false, lastSavedAt: null },
    }),
  reset: () => set({ meetingId: null, loaded: false, meeting: null, segments: [], notes: [], interim: null, rec: initialRec }),
  setSegments: (segments) => set({ segments: [...segments].sort(bySegOrder) }),
  upsertSegment: (s) =>
    set((st) => {
      const i = st.segments.findIndex((x) => x.id === s.id);
      if (i >= 0) {
        const next = st.segments.slice();
        next[i] = s;
        return { segments: next };
      }
      const last = st.segments[st.segments.length - 1];
      // Live segments arrive in order: append in O(1) instead of re-sorting thousands of rows.
      if (!last || bySegOrder(last, s) <= 0) return { segments: [...st.segments, s] };
      return { segments: [...st.segments, s].sort(bySegOrder) };
    }),
  setInterim: (interim) => set({ interim }),
  setGaps: (gaps) => set({ gaps }),
  patchRec: (p) => set((st) => ({ rec: { ...st.rec, ...p } })),
  patchMeeting: (m) => set((st) => ({ meeting: st.meeting ? { ...st.meeting, ...m } : st.meeting })),
  setDocuments: (documents) => set({ documents }),
  setQuestions: (questions) => set({ questions }),
  setSummary: (summary) => set({ summary }),
}));

// -------------------------------------------------------------------------------------------------------------------
// Autosave
// -------------------------------------------------------------------------------------------------------------------

/** Wraps a save request so the header can show 保存中 / 已保存 / 保存失败 honestly. Retries network failures. */
export async function tracked<T>(job: () => Promise<T>, opts: { retries?: number } = {}): Promise<T> {
  const st = useWorkspace;
  st.setState((s) => ({ save: { ...s.save, pending: s.save.pending + 1 } }));
  const retries = opts.retries ?? Infinity;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await job();
        st.setState((s) => ({ save: { pending: s.save.pending - 1, failed: s.save.pending - 1 > 0 ? s.save.failed : false, lastSavedAt: Date.now() } }));
        return res;
      } catch (e) {
        const retryable = e instanceof ApiError ? e.isNetwork || e.status >= 500 : true;
        if (!retryable || attempt >= retries) {
          st.setState((s) => ({ save: { ...s.save, pending: s.save.pending - 1, failed: true } }));
          throw e;
        }
        st.setState((s) => ({ save: { ...s.save, failed: true } }));
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1500 * 2 ** Math.min(attempt, 4))));
      }
    }
  } finally {
    /* counters are updated on each exit path above */
  }
}

// --- Notes: optimistic local edits, debounced idempotent PUT, localStorage mirror for crash safety -------------------

interface Draft {
  category: NoteCategory;
  content: string;
  isImportant: boolean;
  timestampMs: number | null;
}
const draftKey = (mid: string) => `mf:note-drafts:${mid}`;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function readDrafts(mid: string): Record<string, Draft> {
  try {
    return JSON.parse(localStorage.getItem(draftKey(mid)) ?? '{}');
  } catch {
    return {};
  }
}
function writeDrafts(mid: string, d: Record<string, Draft>) {
  try {
    if (Object.keys(d).length) localStorage.setItem(draftKey(mid), JSON.stringify(d));
    else localStorage.removeItem(draftKey(mid));
  } catch {
    /* storage unavailable: autosave to the server still works */
  }
}

async function flushNote(mid: string, id: string) {
  const note = useWorkspace.getState().notes.find((n) => n.id === id);
  if (!note) return;
  const body = { category: note.category, content: note.content, isImportant: note.isImportant, timestampMs: note.timestampMs };
  try {
    await tracked(() => api.putNote(mid, id, body));
    const d = readDrafts(mid);
    // Only clear the mirror if nothing newer was typed while the request was in flight.
    const cur = useWorkspace.getState().notes.find((n) => n.id === id);
    if (cur && cur.content === body.content && cur.category === body.category && cur.isImportant === body.isImportant) {
      delete d[id];
      writeDrafts(mid, d);
    }
  } catch {
    /* kept in the draft mirror; re-sent on next edit or reload */
  }
}

export function editNote(mid: string, id: string, patch: Partial<Pick<Note, 'category' | 'content' | 'isImportant'>>, opts: { timestampMs?: number | null; immediate?: boolean } = {}) {
  const now = new Date().toISOString();
  useWorkspace.setState((s) => {
    const exists = s.notes.some((n) => n.id === id);
    const base: Note = { id, category: 'general', content: '', isImportant: false, timestampMs: opts.timestampMs ?? null, createdAt: now, updatedAt: now };
    return { notes: exists ? s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now } : n)) : [...s.notes, { ...base, ...patch }] };
  });
  const n = useWorkspace.getState().notes.find((x) => x.id === id)!;
  const d = readDrafts(mid);
  d[id] = { category: n.category, content: n.content, isImportant: n.isImportant, timestampMs: n.timestampMs };
  writeDrafts(mid, d);
  const t = timers.get(id);
  if (t) clearTimeout(t);
  if (opts.immediate) void flushNote(mid, id);
  else
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void flushNote(mid, id);
      }, 700),
    );
}

export async function removeNote(mid: string, id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  const prev = useWorkspace.getState().notes;
  useWorkspace.setState({ notes: prev.filter((n) => n.id !== id) });
  const d = readDrafts(mid);
  delete d[id];
  writeDrafts(mid, d);
  try {
    await tracked(() => api.deleteNote(mid, id));
  } catch {
    useWorkspace.setState({ notes: prev });
    throw new Error('delete_failed');
  }
}

/** Sends any pending note edits right now (used before leaving the page). */
export async function flushAllNotes(mid: string) {
  const ids = [...timers.keys()];
  for (const id of ids) {
    clearTimeout(timers.get(id)!);
    timers.delete(id);
  }
  await Promise.all(ids.map((id) => flushNote(mid, id)));
}

/** Re-sends notes that were typed but never acknowledged by the server (crash, closed tab, offline). */
export function restoreNoteDrafts(mid: string) {
  const drafts = readDrafts(mid);
  const state = useWorkspace.getState();
  for (const [id, d] of Object.entries(drafts)) {
    const server = state.notes.find((n) => n.id === id);
    if (server && server.content === d.content && server.category === d.category && server.isImportant === d.isImportant) continue;
    if (!d.content.trim() && !server) continue;
    editNote(mid, id, { category: d.category, content: d.content, isImportant: d.isImportant }, { timestampMs: d.timestampMs, immediate: true });
  }
}

export const newId = uuid;

// --- Transcript corrections -------------------------------------------------------------------------------------------

export async function patchSegment(mid: string, id: string, patch: { editedText?: string | null; speakerLabel?: string | null; isImportant?: boolean }) {
  const prev = useWorkspace.getState().segments.find((s) => s.id === id);
  if (!prev) return;
  // Optimistic: reflect the change immediately; roll back if the server refuses.
  useWorkspace.getState().upsertSegment({
    ...prev,
    ...(patch.editedText !== undefined ? { editedText: patch.editedText === prev.originalText ? null : patch.editedText } : {}),
    ...(patch.speakerLabel !== undefined ? { speakerLabel: patch.speakerLabel || null } : {}),
    ...(patch.isImportant !== undefined ? { isImportant: patch.isImportant } : {}),
  });
  try {
    const { segment } = await tracked(() => api.patchSegment(mid, id, patch), { retries: 3 });
    useWorkspace.getState().upsertSegment(segment);
  } catch (e) {
    useWorkspace.getState().upsertSegment(prev);
    throw e;
  }
}
