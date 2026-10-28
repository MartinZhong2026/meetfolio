import type { interviewQuestions, manualNotes, meetingParticipants, meetings, referenceDocuments, transcriptSegments } from '../db/schema.js';

export interface SummaryInput {
  meeting: typeof meetings.$inferSelect;
  participants: Array<typeof meetingParticipants.$inferSelect>;
  segments: Array<typeof transcriptSegments.$inferSelect>;
  notes: Array<typeof manualNotes.$inferSelect>;
  questions: Array<typeof interviewQuestions.$inferSelect>;
  docs: Array<typeof referenceDocuments.$inferSelect>;
}

export type RefKind = 'segment' | 'note' | 'doc';
export interface RefInfo {
  kind: RefKind;
  id: string;
  /** Segment sequence number, used for #seg-N deep links. */
  seq?: number;
  startMs?: number;
  title?: string;
}

export interface Sourced {
  text: string;
  sources: string[];
}
export interface SummaryJson {
  background: Sourced;
  themes: Array<Sourced & { title: string }>;
  participantViews: Array<Sourced & { speaker: string }>;
  quotes: Array<{ text: string; source: string; speaker: string }>;
  findings: Sourced[];
  openQuestions: Array<Sourced & { suggested: boolean }>;
  suggestedFollowups: Sourced[];
  actionItems: Sourced[];
  refs: Record<string, RefInfo>;
}

export interface SummaryStats {
  mode: 'standard' | 'quality' | 'interim';
  model: string;
  fallbackFrom?: string;
  passes: 'single' | 'map-reduce';
  chunks: number;
  segments: number;
  transcriptChars: number;
  notes: number;
  docsIncluded: number;
  truncatedDocs: Array<{ title: string; includedChars: number; totalChars: number }>;
  droppedUnsupported: number;
  droppedQuotes: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
}
