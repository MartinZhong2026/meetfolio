CREATE TABLE "interview_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"is_followup" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"is_important" boolean DEFAULT false NOT NULL,
	"timestamp_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'other' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"mode" text DEFAULT 'standard' NOT NULL,
	"model" text NOT NULL,
	"generated_json" jsonb,
	"generated_md" text DEFAULT '' NOT NULL,
	"edited_md" text,
	"stats" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"meeting_date" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"organizer" text DEFAULT '' NOT NULL,
	"research_context" text DEFAULT '' NOT NULL,
	"guide_topic" text DEFAULT '' NOT NULL,
	"transcript_status" text DEFAULT 'none' NOT NULL,
	"summary_status" text DEFAULT 'none' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"recorded_ms" bigint DEFAULT 0 NOT NULL,
	"duration_ms" bigint DEFAULT 0 NOT NULL,
	"next_seq" integer DEFAULT 1 NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_chunk_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"gap_id" uuid NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"bytes" integer NOT NULL,
	"segments_created" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reference_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"filename" text,
	"mime_type" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"extracted_text" text DEFAULT '' NOT NULL,
	"extraction_status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"session_id" uuid,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"recovered_ms" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"session_id" uuid,
	"seq" integer NOT NULL,
	"dedupe_key" text NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"original_text" text NOT NULL,
	"edited_text" text,
	"speaker_label" text,
	"is_important" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_offset_ms" bigint DEFAULT 0 NOT NULL,
	"audio_ms" bigint DEFAULT 0 NOT NULL,
	"provider_sessions" integer DEFAULT 0 NOT NULL,
	"reconnects" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"meeting_id" uuid,
	"kind" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_notes" ADD CONSTRAINT "manual_notes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_chunk_metadata" ADD CONSTRAINT "recovery_chunk_metadata_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_chunk_metadata" ADD CONSTRAINT "recovery_chunk_metadata_gap_id_transcript_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."transcript_gaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_documents" ADD CONSTRAINT "reference_documents_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_gaps" ADD CONSTRAINT "transcript_gaps_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_gaps" ADD CONSTRAINT "transcript_gaps_session_id_transcription_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."transcription_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_transcription_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."transcription_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_sessions" ADD CONSTRAINT "transcription_sessions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_sessions" ADD CONSTRAINT "transcription_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_meeting_idx" ON "interview_questions" USING btree ("meeting_id","position");--> statement-breakpoint
CREATE INDEX "notes_meeting_idx" ON "manual_notes" USING btree ("meeting_id","created_at");--> statement-breakpoint
CREATE INDEX "participants_meeting_idx" ON "meeting_participants" USING btree ("meeting_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "summaries_meeting_version_unique" ON "meeting_summaries" USING btree ("meeting_id","version");--> statement-breakpoint
CREATE INDEX "meetings_user_date_idx" ON "meetings" USING btree ("user_id","meeting_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meetings_user_updated_idx" ON "meetings" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_unique" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_gap_idx" ON "recovery_chunk_metadata" USING btree ("gap_id");--> statement-breakpoint
CREATE INDEX "docs_meeting_idx" ON "reference_documents" USING btree ("meeting_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "gaps_meeting_idx" ON "transcript_gaps" USING btree ("meeting_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_meeting_dedupe_unique" ON "transcript_segments" USING btree ("meeting_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_meeting_seq_unique" ON "transcript_segments" USING btree ("meeting_id","seq");--> statement-breakpoint
CREATE INDEX "segments_meeting_time_idx" ON "transcript_segments" USING btree ("meeting_id","start_ms","seq");--> statement-breakpoint
CREATE INDEX "tsessions_meeting_idx" ON "transcription_sessions" USING btree ("meeting_id","started_at");--> statement-breakpoint
CREATE INDEX "tsessions_user_status_idx" ON "transcription_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "usage_user_kind_idx" ON "usage_events" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");