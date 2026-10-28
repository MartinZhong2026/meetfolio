# Database

PostgreSQL 16, accessed through Drizzle ORM. The schema lives in `server/src/db/schema.ts`; SQL migrations are generated
into `server/drizzle/` (`npm run db:generate`) and applied automatically on server start (`RUN_MIGRATIONS=false` to
disable) or with `npm run db:migrate`. Tests build their database from these same migration files.

## Entities

```
users ─┬─< sessions                      (hashed opaque tokens)
       ├─< password_resets                (hashed single-use tokens)
       ├─< usage_events                   (asr_seconds, ai_summary, provider_error, connection_failure, gap_recovery)
       └─< meetings ─┬─< meeting_participants
                     ├─< transcription_sessions      one per live connection ("capture run")
                     ├─< transcript_segments         ★ the durable transcript
                     ├─< transcript_gaps             intervals with missing content
                     │      └─< recovery_chunk_metadata   audio re-submitted for a gap (metadata only)
                     ├─< manual_notes                human notes
                     ├─< reference_documents         uploaded / pasted background (extracted text in DB, file in object store)
                     ├─< interview_questions         guide items & follow-ups
                     └─< meeting_summaries           append-only versions
```

All child tables reference their parent with `ON DELETE CASCADE`, so deleting a meeting or an account removes everything
(stored files are deleted explicitly by prefix `u/<user>/m/<meeting>/`).

## Transcript segments

| Column | Notes |
| --- | --- |
| `seq` | Meeting-wide arrival number, allocated inside the insert transaction from `meetings.next_seq` (row-locked), unique per meeting. Used for stable ordering and deep links (`#seg-<seq>`). |
| `dedupe_key` | Deterministic: `<sessionId>:<providerConnection>:<providerSentenceKey>` (live) or `rec:<gapId>:<chunkId>:<n>` (recovery). **Unique per meeting** → a repeated provider message or retried write cannot create a second row. |
| `start_ms`, `end_ms` | Position on the meeting's *audio timeline* (milliseconds of recorded audio; paused time is not counted). |
| `original_text` | Exactly what the recogniser returned. Never updated. |
| `edited_text` | Researcher's correction; `NULL` = unchanged (typing the original back clears it). |
| `speaker_label` | Manual only — the streaming models do not reliably identify speakers, so none is invented. Leaves room for a future offline diarisation pass. |
| `source` | `live`, `recovery`, `demo`, `manual` — shown in the UI so provenance is never hidden. |

Indexes: `(meeting_id, dedupe_key)` unique, `(meeting_id, seq)` unique, `(meeting_id, start_ms, seq)` for ordered reads.

### Idempotent final writes

`saveFinal` runs in one transaction: look up `(meeting_id, dedupe_key)`; if present return it; otherwise bump
`meetings.next_seq`, `INSERT … ON CONFLICT DO NOTHING`, and re-select on conflict. Concurrent writers get distinct
`seq`s (tested with 25 parallel writes) and identical keys collapse to one row (tested).

## Gaps

`transcript_gaps(start_ms, end_ms NULL, reason, status)`

- `reason`: `network`, `provider`, `capture_stopped`, `page_reload` (unknown length → `end_ms` NULL), `server_restart`
- `status`: `open` → `recovering` → `recovered` | `partial` | `unrecoverable`

A gap is created *whenever the server cannot prove it has the transcript for an interval* — it is the mechanism that
makes data loss visible instead of silent. `recovery_chunk_metadata` records each upload attempt (range, bytes,
segments created, status, error code). The audio itself is never stored.

`meetings.recorded_ms` is the audio-timeline high-water mark that has been handed to the provider (or covered by a gap);
a returning browser's `audioStartMs` is compared with it.

## Notes, questions, documents

`manual_notes` and `interview_questions` use **client-generated UUID primary keys** and are written with
`PUT … ON CONFLICT (id) DO UPDATE … WHERE meeting_id = :meeting`. Autosave is therefore idempotent, safe to retry, and a
client cannot take over a row id that belongs to another meeting.

`reference_documents.extracted_text` holds the searchable text; `storage_key` points at the private original.
`extraction_status`: `ok`, `empty` (e.g. scanned PDF), `failed`, `truncated` (> 1 M characters).

## Summaries

`meeting_summaries(meeting_id, version)` is unique and append-only: *regenerate* creates version *n+1* and keeps the
old one (including the researcher's edits to it). `generated_json` holds the verified structured result and an id →
evidence map; `generated_md` the rendered report; `edited_md` the researcher's edited text (generated text stays intact).
`stats` records model, passes, chunks, filtered quotes/claims, truncated documents and any model fallback.

## Retention and deletion

Users can delete a meeting (cascade + stored files) or their whole account. Expired sessions are purged periodically.
`usage_events` are kept for monitoring and removed with the user. Raw audio is never persisted server-side.
