export interface User {
  id: string;
  email: string;
  name: string;
}

export type MeetingType = 'academic_interview' | 'fieldwork' | 'research_group' | 'seminar' | 'user_interview' | 'general' | 'other';
export type NoteCategory = 'quote' | 'observation' | 'finding' | 'followup' | 'todo' | 'general';

export interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  type: MeetingType;
  location: string;
  organizer: string;
  researchContext: string;
  guideTopic: string;
  transcriptStatus: 'none' | 'in_progress' | 'interrupted' | 'complete';
  summaryStatus: 'none' | 'generating' | 'ready' | 'failed';
  isDemo: boolean;
  recordedMs: number;
  durationMs: number;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id?: string;
  name: string;
  role: 'interviewer' | 'interviewee' | 'other';
  note?: string;
}

export interface Segment {
  id: string;
  seq: number;
  startMs: number;
  endMs: number;
  originalText: string;
  editedText: string | null;
  speakerLabel: string | null;
  isImportant: boolean;
  source: 'live' | 'recovery' | 'demo' | 'manual' | string;
  updatedAt: string;
  /** Optional desktop WAV identity and sample-derived times within that capture file. */
  audio?: { recordingId: string; startMs: number; endMs: number };
}

export interface Gap {
  id: string;
  startMs: number;
  endMs: number | null;
  reason: 'network' | 'provider' | 'capture_stopped' | 'page_reload' | 'server_restart' | string;
  status: 'open' | 'recovering' | 'recovered' | 'partial' | 'unrecoverable';
  recoveredMs: number;
  createdAt: string;
}

export interface Note {
  id: string;
  category: NoteCategory;
  content: string;
  isImportant: boolean;
  timestampMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Question {
  id: string;
  position: number;
  text: string;
  done: boolean;
  isFollowup: boolean;
}

export interface RefDoc {
  id: string;
  kind: 'upload' | 'pasted';
  title: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number;
  textLength: number;
  extractionStatus: 'ok' | 'empty' | 'failed' | 'truncated';
  createdAt: string;
}

export interface RefInfo {
  kind: 'segment' | 'note' | 'doc';
  id: string;
  seq?: number;
  startMs?: number;
  title?: string;
}

export interface Summary {
  id: string;
  version: number;
  status: 'generating' | 'ready' | 'failed';
  mode: 'standard' | 'quality' | 'interim';
  model: string;
  generatedJson: { refs: Record<string, RefInfo> } | null;
  generatedMd: string;
  editedMd: string | null;
  stats: {
    passes?: string;
    chunks?: number;
    droppedQuotes?: number;
    droppedUnsupported?: number;
    fallbackFrom?: string;
    truncatedDocs?: Array<{ title: string; includedChars: number; totalChars: number }>;
    segments?: number;
  } | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Bundle {
  meeting: Meeting;
  participants: Participant[];
  notes: Note[];
  documents: RefDoc[];
  questions: Question[];
  segments: Segment[];
  gaps: Gap[];
  summary: Summary | null;
}

export interface AppConfig {
  demoEnabled: boolean;
  asrConfigured: boolean;
  aiConfigured: boolean;
  asrProvider: string;
  maxUploadMb: number;
  storageDriver: string;
}

export interface Usage {
  last30Days: { asrMinutes: number; aiSummaries: number; providerErrors: number; connectionFailures: number };
  today: { asrMinutes: number; asrMinutesLimit: number; aiSummaries: number; aiSummariesLimit: number };
}
