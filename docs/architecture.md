# Architecture

## Overview

One TypeScript monorepo, one deployable service.

```
┌────────────────────────── Browser (React + Vite) ──────────────────────────┐
│ Workspace UI ── Zustand store ── Transcriber controller                     │
│                                   │  ▲                                       │
│  Microphone → AudioWorklet (16 kHz PCM16, 100 ms frames)                     │
│                 ├─► IndexedDB ring buffer (bounded, per meeting)  ──┐ gap    │
│                 └─► WebSocket /ws/transcribe (binary PCM + JSON)    │ upload │
└─────────────────────────────────┬───────────────────────────────────┼────────┘
                                  ▼                                   ▼
┌────────────────────────── Fastify server (Node 22) ────────────────────────┐
│ REST /api/*  (auth, meetings, notes, docs, summaries, export, gaps)         │
│ WS  /ws/transcribe → TranscriptionPipeline ─► AsrProvider adapter ─► DashScope│
│                          │ persist finals (idempotent)                       │
│ AI summary: evidence builder → Qwen chat (streamed) → verifier → renderer    │
│ Storage port: local (dev) | S3-compatible (prod)                             │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
                        PostgreSQL 16 (Drizzle)
```

Everything runs in a single Node process: HTTP API, WebSocket relay, static web app. There is no Redis, queue,
vector database or second service. State that must survive a restart lives in PostgreSQL; live-session state
(open sockets, provider connections) is intentionally process-local — see *Scaling*.

## Key decisions (and deviations from the brief)

| Decision | Why |
| --- | --- |
| **Fastify + `ws` + Drizzle + PostgreSQL** | Small, fast, typed, easy to operate on Railway. |
| **Own session auth instead of an auth library** | Email/password with argon2id and opaque, hashed, server-side sessions is ~200 lines, has no extra moving parts and gives exact control over cookies, Origin checks and revocation. Implemented to the standard recommendations (hashed tokens at rest, `HttpOnly; SameSite=Lax; Secure`, constant-time-ish login, password-reset tokens single-use and hashed). A library such as Better Auth is a reasonable swap if OAuth/SSO is added later. |
| **Primary ASR: `qwen-audio-3.0-asr-flash-streaming`** (not 3.1) | It is the model documented in Alibaba's official sample repository. The `…3.1…streaming` id from the brief could not be confirmed in any official source reachable during development; model id and protocol are configuration (`ASR_MODEL`, `ASR_PROVIDER`). A second adapter implements `qwen3-asr-flash-realtime`. |
| **Text models: `qwen3.7-plus` / `qwen3.8-max`** | `qwen3.7-plus` is corroborated; `qwen3.8-max` could not be confirmed as a generally available id, so quality mode falls back to the standard model (recorded in the summary stats and shown to the user) when the provider reports it unavailable. |
| **Gap recovery re-streams buffered audio through the same streaming ASR** | Avoids a second protocol and a public audio URL (Alibaba's file-transcription APIs take URLs). Audio is processed in memory and never persisted. |
| **Client is the source of truth for audio** | Browsers cannot record while closed/asleep, but while the page is open capture is independent of the network, so the browser buffers locally and re-submits missing intervals. |
| **Summaries run in-process, polled by the UI** | Simple and reliable for a small team; stale `generating` rows are failed on boot. |

## Live transcription flow

1. Browser opens the WebSocket, sends `hello {meetingId, audioStartMs}`. `audioStartMs` is the timeline position of the
   *first frame it will send* — stamped when the socket opens, never earlier.
2. Server authenticates (cookie), checks ownership, Origin, one-live-session-per-user, daily allowance, creates a
   `transcription_sessions` row, compares `audioStartMs` with the meeting's saved high-water mark (`recorded_ms`) and
   records a **gap** if audio is missing (e.g. the connection was down while the microphone kept recording).
3. `TranscriptionPipeline` connects to the provider and streams frames. Every frame is retained until the provider
   *finalises* the audio it covers; if the provider connection drops, unconfirmed audio is replayed to a fresh
   connection (bounded backoff, paced at `ASR_RECOVERY_SPEED`× real time).
4. Provider results become `interim` (UI only) and `final` messages. Finals are written with a deterministic dedupe key
   in a transaction that also allocates the meeting-wide sequence number, then sent to the browser — **nothing is shown
   as saved before it is saved**.
5. Provider sessions are proactively rotated every `ASR_SESSION_ROTATE_MINUTES` at a sentence boundary so a provider
   time limit never becomes an interruption.
6. `ack {receivedMs, confirmedMs}` once per second doubles as the application-level heartbeat; `confirmedMs` lets the
   browser prune its local audio buffer.
7. On `stop`, the provider is finished (flushing the last sentence), everything is persisted, then the REST
   `/end` marks the meeting complete.

Full failure-mode analysis: [asr-integration.md](asr-integration.md).

## AI summary pipeline

1. **Evidence** — transcript segments get ids `T<seq>`, human notes `N<n>`, reference documents `D<n>` (bounded budget,
   truncation reported). Research context and guide are passed as labelled metadata.
2. **Prompt** — system rules state the three-way distinction (spoken / researcher-noted / AI-inferred) and that
   reference material is *not* speech.
3. **Generate** — streamed chat completion with JSON output; one corrective retry on invalid JSON; automatic fallback if
   the quality model id is unavailable. Meetings over `SUMMARY_SINGLE_PASS_CHAR_LIMIT` use chunked extraction followed by
   hierarchical merge — no segment is dropped.
4. **Verify (code, not trust)** — citations must reference real evidence ids; participant claims and quotes need
   transcript support; quotes must occur *verbatim* in the cited segment; speaker attribution is taken from the segment's
   label, not from the model. Removed items are counted and shown to the user.
5. **Render** — Markdown with `[hh:mm:ss](#seg-N)` links. Human notes are reproduced verbatim by the server (never by the
   model) and labelled; AI inference and suggestions are labelled as such.

## Security model

- Auth: argon2id; random 256-bit session tokens stored hashed (SHA-256), `last_seen_at` tracked, all other sessions revoked on password change/reset.
- Authorization: every query is scoped by `user_id`; foreign ids return 404 (no existence oracle). Tested route-by-route.
- CSRF / cross-site WebSocket hijacking: `SameSite=Lax` cookie plus mandatory `Origin` allow-list on state-changing
  requests and WebSocket upgrades.
- Input validation with Zod everywhere; uploads validated by extension *and* magic bytes, size-limited, stored privately
  and only served through an owner-checked route with `attachment` + `nosniff`.
- Rate limits (global and stricter on auth), per-user single live session, daily ASR and summary allowances.
- Logs contain ids, counts and error codes only; transcript/notes text is never logged and logger redaction is a second
  line of defence. Query strings (reset tokens) are stripped from request logs.
- Security headers: CSP (`default-src 'self'`), HSTS (production), `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`.

## Scaling and known architectural limits

- Live-session state is process-local. Run **one instance** (sufficient for a research group). Horizontal scaling would
  need sticky routing per meeting or moving the registry to shared state; all durable data is already in PostgreSQL.
- On deploy/SIGTERM the server stops live pipelines gracefully (flush + persist, 8 s budget). Browsers then reconnect
  automatically and the interval in between becomes a recoverable gap.
