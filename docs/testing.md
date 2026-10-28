# Testing

No test makes a paid API call. External services are replaced by local mocks that speak the real wire protocols.

```bash
npm test            # server (84) + web (25) unit/integration tests
npm run test:e2e    # Playwright: 10 browser tests × 3 viewports (1440 / 1024 / 390) = 30
```

Prerequisites: PostgreSQL reachable at `TEST_DATABASE_URL` (default
`postgres://meetfolio:meetfolio@127.0.0.1:5432/meetfolio_test`). The server suite drops/recreates the `public` schema of that
database and applies the real migrations. The browser harness creates a throw-away `meetfolio_e2e` database (the role needs
`CREATEDB`). Browser tests use Chromium with a fake microphone device (`--use-fake-device-for-media-stream`); set
`PW_CHROMIUM` to use a specific binary.

## Server (`server/test`, vitest + real PostgreSQL)

| File | Covers |
| --- | --- |
| `auth.test.ts` | Registration (normalisation, duplicates, validation), argon2 + hashed-token storage, login (uniform error), logout, **401 on every protected route**, password reset (single use, revokes sessions, no account enumeration), password change/account deletion, CSRF Origin check, security headers, auth rate limit |
| `meetings.test.ts` | Quick create, validation, full metadata + participants, edit/rename, newest-first list, search (title/place/participant/**transcript text**, LIKE-escaping), delete cascade, end/duration, demo-mode gating, **cross-user isolation on 12 routes (404, no leakage)**, note-id hijack across meetings |
| `content.test.ts` | Notes: idempotent upsert/autosave, timestamp preservation, reload persistence, validation. Guide parsing/import/completion/follow-ups. Documents: **TXT (UTF-8 + GB18030), MD, DOCX, PDF extraction**, rejects spoofed/unsupported/oversize files, **private storage + access control**, pasted docs. Transcript corrections: original preserved, revert, only manual passages deletable |
| `pipeline.test.ts` | **Interruption recovery on a virtual clock**: provider drop after **17, 25, 60 min**; cumulative drops; **logical 90-minute session** with rotation + provider session cap + drops; rotation boundaries; hung shutdown; short outage bridged by replay; outage beyond the buffer → explicit gap; fatal provider error; browser vanishing; pause/resume; duplicate provider events; concurrent `seq` allocation; database failures (retry / permanent). Invariant checked everywhere: every spoken cell appears exactly once **or** lies inside a recorded gap, on the correct absolute timestamp |
| `adapters.test.ts` | Both DashScope adapters against local WebSocket servers speaking the documented protocols: handshake/auth, envelope shape, binary/base64 audio, interim vs final mapping, heartbeats ignored, finish semantics, fatal vs transient errors, timeouts, keep-alive pings, dead-peer detection |
| `ws.test.ts` | Real WebSocket end-to-end with the demo provider: auth + Origin rejection, interim → final → persisted, provider-drop recovery without duplicates, browser loss → `interrupted` → gap on return, **gap recovery upload (idempotent retry)**, one-session-per-user and takeover, ownership, missing-credential error, pause/refresh/resume continuity |
| `summaries.test.ts` | Request handling (202 + polling), **source grounding** (fabricated quotes and unsupported claims removed, deep links, attribution from real labels), separated prompt sections (reference text never in the transcript block), human notes verbatim, regenerate/versioning/edits, quality-model fallback, provider failure + retry, invalid JSON retry, empty meeting, not configured, daily limit, **map-reduce for long meetings without dropping segments** |
| `exports.test.ts` | Markdown / TXT / DOCX (re-parsed with mammoth): metadata, timestamped corrected transcript, notes, summary (edited preferred), gap markers, part selection, validation |

## Web unit tests (`web/src`, vitest + jsdom + fake-indexeddb)

| File | Covers |
| --- | --- |
| `audio/chunkStore.test.ts` | IndexedDB audio buffer: round-trip content, survives "reload", never bridges holes, **bounded size**, per-meeting isolation, pruning, age sweep, storage-failure handling |
| `audio/transcriber.test.ts` | Capture-first design: hello stamped at open time, queued frames, pause/resume, `stop` confirmation, fatal errors, mic denial, **heartbeat-timeout reconnect, bounded exponential backoff**, **drops at 17/25/60 min with byte-exact local-audio upload**, **logical 90-minute session: every frame delivered exactly once** (live xor gap upload), page-reload resume, offline start |
| `store/workspace.test.ts` | Note autosave (debounce, idempotent PUT, draft mirror, retry while offline, restore after crash), transcript store ordering and de-duplication |

## Browser (`web/e2e`, Playwright, 1440 / 1024 / 390 px)

The harness (`server/test/e2e-server.ts`) runs the **real application** — REST, WebSocket pipeline, adapters, summary
generator — against a local mock ASR server and a local streaming mock LLM, on a fresh database.

- `journey.spec.ts` (7 tests × 3 viewports): landing & CTAs; register/logout/login/redirects; **layout per viewport**
  (three side-by-side panels at 1440 incl. collapse, split panel at 1024, tabbed phone layout at 390; no horizontal
  scroll); **the core journey** — create, paste guide + tick questions + follow-up, upload a document and search it,
  start transcription with the fake microphone, watch interim → final text, take notes while recording, **block the network for ~9 s**
  (status 重新连接中, local buffering banner, automatic reconnect, gap marker, `补录` segments recovered from the local
  buffer), mark highlight, end, review, correct a transcription error (original preserved), generate the grounded
  summary, follow a citation to the transcript, edit/save the summary, export MD/TXT/DOCX, reload and verify persistence and
  dashboard statuses; **refresh in the middle of recording** (saved text intact, 已中断, continue, gap filled from IndexedDB);
  dashboard search/rename/export menu/delete-with-confirmation; another user's meeting is not reachable; demo mode labelling,
  simulated disconnect recovery.
- `scale.spec.ts`: **6,000-segment transcript** — load, search, scroll to end and edit a row stay responsive (≈ 2.7 s load).
- `a11y.spec.ts`: axe-core WCAG 2.1 A/AA scan of landing, login, dashboard, new meeting, workspace, review and settings
  (no serious/critical violations). Automated scanning is not a substitute for manual screen-reader testing.

## What still needs real-provider or real-hardware verification

| Not verified | Why it matters |
| --- | --- |
| Live DashScope ASR (either adapter): handshake, accepted parameters, result timing, session limits, replay-speed tolerance | Protocols were implemented from Alibaba's SDK/sample source and tested against mocks only |
| `qwen-audio-3.1-asr-flash-streaming` id/protocol | Not found in any reachable official source |
| Live Qwen text models (`qwen3.7-plus`, `qwen3.8-max`): ids, JSON-mode support, streaming usage field, output quality on real interviews | Mocked; JSON mode and ids are assumptions |
| Real 60–120-minute microphone sessions, real network loss, laptop sleep, Safari/Firefox behaviour of AudioWorklet and IndexedDB quotas | Simulations prove logic, not physics |
| Recognition accuracy for dialects/accents and domain terms | Depends on the provider |
| Mainland-China latency/accessibility from Railway regions | Network-dependent |
| S3-compatible storage adapter against a real bucket | Unit-level only (local/memory adapters tested) |
| SMTP delivery of password-reset email | Mailer is mocked |
| Manual accessibility review with a screen reader | Only automated axe checks |

Use the checklist in [asr-integration.md](asr-integration.md#live-verification-checklist) to close the first rows.
