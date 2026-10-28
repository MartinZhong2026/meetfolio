import { uuid } from '../lib/format';
import type { Note, NoteCategory, Question, Segment } from '../lib/types';

export type Stage = 'prepare' | 'live' | 'review';
export type Recording =
  'idle' | 'starting' | 'recording' | 'paused' | 'interrupted' | 'ended';
export interface ReferenceFile {
  id: string;
  name: string;
  kind: 'txt' | 'md';
  text: string;
  addedAt: string;
}
export interface Interview {
  id: string;
  title: string;
  participant: string;
  createdAt: string;
  stage: Stage;
  consent: boolean;
  synthetic: boolean;
  guide: string;
  questions: Question[];
  reference: string;
  /** Parsed local text only. Optional so v0.1 backups remain readable. */
  referenceFiles?: ReferenceFile[];
  segments: Segment[];
  notes: Note[];
  draftNote: string;
  manualDraft: string;
  draftCategory: NoteCategory;
  reviewText: string;
  recording: Recording;
  elapsedMs: number;
  interruption: string | null;
}
export interface Notebook {
  schema: 1;
  activeId: string;
  interviews: Interview[];
}
export function newInterview(): Interview {
  return {
    id: uuid(),
    title: '',
    participant: '',
    createdAt: new Date().toISOString(),
    stage: 'prepare',
    consent: false,
    synthetic: false,
    guide: '',
    questions: [],
    reference: '',
    referenceFiles: [],
    segments: [],
    notes: [],
    draftNote: '',
    manualDraft: '',
    draftCategory: 'observation',
    reviewText: '',
    recording: 'idle',
    elapsedMs: 0,
    interruption: null,
  };
}
export function emptyNotebook(): Notebook {
  const first = newInterview();
  return { schema: 1, activeId: first.id, interviews: [first] };
}
export function questionsFromGuide(
  guide: string,
  previous: Question[],
): Question[] {
  return guide
    .split('\n')
    .map((s) => s.trim().replace(/^\d+[.、)）]\s*/, ''))
    .filter(Boolean)
    .map(
      (text, position) =>
        previous.find((q) => q.text === text) ?? {
          id: uuid(),
          text,
          position,
          done: false,
          isFollowup: false,
        },
    );
}
export function recoverNotebook(book: Notebook): {
  book: Notebook;
  recovered: boolean;
} {
  let recovered = false;
  return {
    book: {
      ...book,
      interviews: book.interviews.map((i) => {
        if (!['recording', 'starting'].includes(i.recording)) return i;
        recovered = true;
        return {
          ...i,
          recording: 'interrupted',
          interruption:
            'The previous session was interrupted by reload or exit. Review any gaps in recovered notes and text.',
        };
      }),
    },
    recovered,
  };
}
// Backup files are untrusted input. Bound size before parsing and validate nested fields.
export function parseNotebook(value: unknown): Notebook {
  const fail = () => {
    throw new Error('Unsupported or invalid backup. Existing notes have not been changed.');
  };
  const object = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : fail();
  const str = (v: unknown, max = 200000) =>
    typeof v === 'string' && v.length <= max ? v : fail();
  const id = (v: unknown) => {
    const s = str(v, 100);
    return /^[a-zA-Z0-9_-]+$/.test(s) ? s : fail();
  };
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : fail());
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail();
  const choice = <T extends string>(v: unknown, choices: readonly T[]): T =>
    choices.includes(v as T) ? (v as T) : fail();
  const list = <T>(v: unknown, max: number, parse: (x: unknown) => T): T[] =>
    Array.isArray(v) && v.length <= max ? v.map(parse) : fail();
  const root = object(value);
  if (root.schema !== 1) return fail();
  const categories: NoteCategory[] = [
    'general',
    'quote',
    'observation',
    'finding',
    'followup',
    'todo',
  ];
  const interviews = list(root.interviews, 100, (v): Interview => {
    const i = object(v);
    return {
      id: id(i.id),
      title: str(i.title, 500),
      participant: str(i.participant, 200),
      createdAt: str(i.createdAt, 100),
      stage: choice(i.stage, ['prepare', 'live', 'review']),
      consent: bool(i.consent),
      synthetic: bool(i.synthetic),
      guide: str(i.guide),
      reference: str(i.reference),
      ...(i.referenceFiles !== undefined ? { referenceFiles: list(i.referenceFiles, 8, (value) => {
        const f = object(value);
        return {
          id: id(f.id),
          name: str(f.name, 200),
          kind: choice(f.kind, ['txt', 'md']),
          text: str(f.text, 100000),
          addedAt: str(f.addedAt, 100),
        };
      }) } : {}),
      questions: list(i.questions, 1000, (v) => {
        const q = object(v);
        return {
          id: id(q.id),
          text: str(q.text),
          position: num(q.position),
          done: bool(q.done),
          isFollowup: bool(q.isFollowup),
        };
      }),
      segments: list(i.segments, 100000, (v) => {
        const s = object(v);
        const startMs = num(s.startMs);
        const endMs = num(s.endMs);
        if (endMs < startMs) return fail();
        return {
          id: id(s.id),
          seq: Number.isInteger(s.seq) && num(s.seq) > 0 ? num(s.seq) : fail(),
          startMs,
          endMs,
          originalText: str(s.originalText),
          editedText: s.editedText === null ? null : str(s.editedText),
          speakerLabel:
            s.speakerLabel === null ? null : str(s.speakerLabel, 200),
          isImportant: bool(s.isImportant),
          source: choice(s.source, ['demo', 'manual', 'local']),
          updatedAt: str(s.updatedAt, 100),
        };
      }),
      notes: list(i.notes, 10000, (v) => {
        const n = object(v);
        return {
          id: id(n.id),
          category: choice(n.category, categories),
          content: str(n.content),
          isImportant: bool(n.isImportant),
          timestampMs: n.timestampMs === null ? null : num(n.timestampMs),
          createdAt: str(n.createdAt, 100),
          updatedAt: str(n.updatedAt, 100),
        };
      }),
      draftNote: str(i.draftNote),
      manualDraft: str(i.manualDraft),
      draftCategory: choice(i.draftCategory, categories),
      reviewText: str(i.reviewText),
      recording: choice(i.recording, [
        'idle',
        'starting',
        'recording',
        'paused',
        'interrupted',
        'ended',
      ]),
      elapsedMs: num(i.elapsedMs),
      interruption: i.interruption === null ? null : str(i.interruption),
    };
  });
  const activeId = id(root.activeId);
  if (!interviews.length || !interviews.some((i) => i.id === activeId))
    return fail();
  for (const ids of [
    interviews.map((i) => i.id),
    ...interviews.flatMap((i) => [
      i.segments.map((s) => s.id),
      i.segments.map((s) => String(s.seq)),
      i.notes.map((n) => n.id),
      i.questions.map((q) => q.id),
    ]),
  ])
    if (new Set(ids).size !== ids.length) return fail();
  return { schema: 1, activeId, interviews };
}
