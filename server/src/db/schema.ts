import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const MEETING_TYPES = [
  'academic_interview', // 学术访谈
  'fieldwork', // 田野调查
  'research_group', // 研究组会
  'seminar', // 专题研讨
  'user_interview', // 用户访谈
  'general', // 普通会议
  'other', // 其他
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const NOTE_CATEGORIES = [
  'quote', // 客户/受访者原话
  'observation', // 研究者观察
  'finding', // 重要发现
  'followup', // 追问问题
  'todo', // 待办事项
  'general', // 普通笔记
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

/** Opaque server-side sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('password_resets_token_unique').on(t.tokenHash), index('password_resets_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    meetingDate: timestamp('meeting_date', { withTimezone: true }).notNull().defaultNow(),
    type: text('type').$type<MeetingType>().notNull().default('general'),
    location: text('location').notNull().default(''),
    organizer: text('organizer').notNull().default(''),
    researchContext: text('research_context').notNull().default(''),
    /** Free-form topic line of the interview guide ("研究主题"). */
    guideTopic: text('guide_topic').notNull().default(''),
    /** none | in_progress | interrupted | complete */
    transcriptStatus: text('transcript_status').notNull().default('none'),
    /** none | generating | ready | failed */
    summaryStatus: text('summary_status').notNull().default('none'),
    isDemo: boolean('is_demo').notNull().default(false),
    /** Audio timeline high-water mark (ms) that has been handed to the ASR provider. */
    recordedMs: bigint('recorded_ms', { mode: 'number' }).notNull().default(0),
    /** Final duration once the meeting has ended. */
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull().default(0),
    /** Monotonic counter used to allocate transcript segment sequence numbers. */
    nextSeq: integer('next_seq').notNull().default(1),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('meetings_user_date_idx').on(t.userId, t.meetingDate.desc()), index('meetings_user_updated_idx').on(t.userId, t.updatedAt.desc())],
);

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** interviewer | interviewee | other */
    role: text('role').notNull().default('other'),
    note: text('note').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('participants_meeting_idx').on(t.meetingId, t.position)],
);

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/** One row per browser<->backend live connection (a "capture run"). */
export const transcriptionSessions = pgTable(
  'transcription_sessions',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    /** active | ended | interrupted | failed */
    status: text('status').notNull().default('active'),
    /** Timeline position (ms) of the first audio frame of this session. */
    startOffsetMs: bigint('start_offset_ms', { mode: 'number' }).notNull().default(0),
    audioMs: bigint('audio_ms', { mode: 'number' }).notNull().default(0),
    providerSessions: integer('provider_sessions').notNull().default(0),
    reconnects: integer('reconnects').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('tsessions_meeting_idx').on(t.meetingId, t.startedAt), index('tsessions_user_status_idx').on(t.userId, t.status)],
);

export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => transcriptionSessions.id, { onDelete: 'set null' }),
    /** Meeting-wide arrival order; used for stable ordering and deep links (#seg-N). */
    seq: integer('seq').notNull(),
    /** Provider-derived identity; (meetingId, dedupeKey) is unique so replays are idempotent. */
    dedupeKey: text('dedupe_key').notNull(),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    endMs: bigint('end_ms', { mode: 'number' }).notNull(),
    /** Text exactly as recognised. Never overwritten after insertion. */
    originalText: text('original_text').notNull(),
    /** User correction; null means "unchanged". */
    editedText: text('edited_text'),
    speakerLabel: text('speaker_label'),
    isImportant: boolean('is_important').notNull().default(false),
    /** live | recovery | demo | manual */
    source: text('source').notNull().default('live'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('segments_meeting_dedupe_unique').on(t.meetingId, t.dedupeKey),
    uniqueIndex('segments_meeting_seq_unique').on(t.meetingId, t.seq),
    index('segments_meeting_time_idx').on(t.meetingId, t.startMs, t.seq),
  ],
);

/** An interval of the meeting timeline for which transcript content is missing. */
export const transcriptGaps = pgTable(
  'transcript_gaps',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => transcriptionSessions.id, { onDelete: 'set null' }),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    /** Null when the duration is unknown (e.g. the page was reloaded). */
    endMs: bigint('end_ms', { mode: 'number' }),
    /** network | provider | capture_stopped | page_reload | server_restart */
    reason: text('reason').notNull(),
    /** open | recovering | recovered | partial | unrecoverable */
    status: text('status').notNull().default('open'),
    recoveredMs: bigint('recovered_ms', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('gaps_meeting_idx').on(t.meetingId, t.startMs)],
);

/** Metadata about audio ranges re-submitted for recovery. The audio itself is never stored. */
export const recoveryChunkMetadata = pgTable(
  'recovery_chunk_metadata',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    gapId: uuid('gap_id')
      .notNull()
      .references(() => transcriptGaps.id, { onDelete: 'cascade' }),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    endMs: bigint('end_ms', { mode: 'number' }).notNull(),
    bytes: integer('bytes').notNull(),
    segmentsCreated: integer('segments_created').notNull().default(0),
    /** processing | done | failed */
    status: text('status').notNull().default('processing'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('recovery_gap_idx').on(t.gapId)],
);

// ---------------------------------------------------------------------------
// Human content
// ---------------------------------------------------------------------------

export const manualNotes = pgTable(
  'manual_notes',
  {
    // Client-generated UUID so autosave can be an idempotent upsert.
    id: uuid('id').primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    category: text('category').$type<NoteCategory>().notNull().default('general'),
    content: text('content').notNull().default(''),
    isImportant: boolean('is_important').notNull().default(false),
    /** Meeting timeline position when the note was started (ms). */
    timestampMs: bigint('timestamp_ms', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('notes_meeting_idx').on(t.meetingId, t.createdAt)],
);

export const referenceDocuments = pgTable(
  'reference_documents',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    /** upload | pasted */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    filename: text('filename'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    storageKey: text('storage_key'),
    extractedText: text('extracted_text').notNull().default(''),
    /** ok | empty | failed */
    extractionStatus: text('extraction_status').notNull().default('ok'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('docs_meeting_idx').on(t.meetingId, t.createdAt)],
);

export const interviewQuestions = pgTable(
  'interview_questions',
  {
    id: uuid('id').primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** Marks questions added during the interview. */
    isFollowup: boolean('is_followup').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('questions_meeting_idx').on(t.meetingId, t.position)],
);

// ---------------------------------------------------------------------------
// AI summaries & usage
// ---------------------------------------------------------------------------

export const meetingSummaries = pgTable(
  'meeting_summaries',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** generating | ready | failed */
    status: text('status').notNull().default('generating'),
    /** standard | quality | interim */
    mode: text('mode').notNull().default('standard'),
    model: text('model').notNull(),
    /** Structured, source-attributed output as returned (and verified) by the pipeline. */
    generatedJson: jsonb('generated_json'),
    generatedMd: text('generated_md').notNull().default(''),
    /** User-edited markdown; null while untouched. */
    editedMd: text('edited_md'),
    stats: jsonb('stats'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('summaries_meeting_version_unique').on(t.meetingId, t.version)],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    /** asr_seconds | ai_summary | provider_error | connection_failure | gap_recovery */
    kind: text('kind').notNull(),
    quantity: integer('quantity').notNull().default(1),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('usage_user_kind_idx').on(t.userId, t.kind, t.createdAt)],
);
