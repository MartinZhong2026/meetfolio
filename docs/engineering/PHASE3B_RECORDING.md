# Phase 3B1 — durable local WAV capture

Baseline: Phase 3A `b433a641ee2c05c8767dcf274aa2a30a20ad08e5`, checked against origin and Draft PRs #1/#2 on 2026-10-30. PR #2 remains based on `recovery/complete-source`; this phase is an incremental branch based on PR #2. No merge or release is authorized.

## Product scope

The native desktop now saves the same 16 kHz mono PCM16 frames supplied to offline X-ASR. Each start/resume creates a separate WAV with a native-generated UUID and the notebook interview ID. Pause/finish drains capture and inference before finalizing audio. An ASR failure, microphone interruption or renderer reload finalizes the available audio as interrupted. Disk failure/backlog stops capture visibly; it never silently continues as a successful recording. The browser-only UI and fictional demo do not record audio.

Local storage & backup info lists captures for the selected interview, exports finalized WAVs using a native save dialog and explicitly recovers unfinished files after restart. “Show all local recordings” also exposes orphaned captures after a notebook restore or loss. An unreadable session remains visible and does not hide other recordings. There is no automatic deletion, retention sweep, migration of old audio or rewrite of existing recordings.

Per-segment playback is added in the incremental [Phase 3B2](PHASE3B2_PLAYBACK.md). Combined audio/notebook backup and restore, recording deletion and automatic re-transcription of recovered audio are **not implemented**. Earlier transcript/demo/manual entries have no retrospectively recoverable audio. PDF/DOCX local reference extraction, physical microphone acceptance, installation and macOS acceptance are still pending.

## Storage and failure contract

Under the Electron profile, `recordings/<recording UUID>/` contains:

- `session.json`: exclusive, versioned identity/creation metadata, synchronized before capture opens.
- `capture.part`: a fixed 44-byte PCM WAV header followed by sequential samples. Memory backlog is limited to 160,000 bytes (five seconds); classic RIFF capacity is checked before accepting more frames. Frames are copied once and short writes are retried. Every 32,000 bytes (one second of accepted audio) and on finish, the file is synchronized.
- `recording.wav`: the finalized header and PCM, published by an exclusive filesystem link so an existing WAV cannot be overwritten. Normal successful finalization removes the partial link.
- `final.json`: synchronized completion/interruption metadata. A valid WAV without this metadata is conservatively interrupted.

The filesystem must support hard links (as NTFS does). Unsupported filesystems fail visibly and retain the capture; no unsafe overwrite fallback is attempted. Files are private mode where supported; Windows confidentiality depends on the account ACL. Audio and notebooks are not encrypted.

Explicit recovery validates this exact PCM format, identity metadata, bounds and complete samples, then copies the saved samples with a repaired header in bounded 64 KiB blocks. It publishes exclusively, retains the original partial file, and always reports interrupted. Repeating recovery of an already valid WAV is idempotent. A trailing half-sample remains in the original but is excluded from the recovered WAV. Corrupt files are not silently interpreted as valid audio. Recovery may need approximately one additional file's disk space; failed staging copies are retained for diagnosis rather than deleting evidence.

Synchronization reduces loss after process termination; it does not guarantee durability across hardware/power failure, filesystem corruption or unavailable storage. The unsynchronized tail, renderer/IPC buffers and audio never delivered by the device cannot be recreated. A full disk may also prevent metadata writes. Do not describe recovered audio as complete.

## Evidence and compatibility

Optional `Segment.audio = { recordingId, startMs, endMs }` stores **file-relative sample time** independently of the existing interview display clock. Native replay reuses already recorded PCM for inference without recording it twice. Pause/resume starts a new identity. This avoids treating wall-clock elapsed time as a WAV seek offset. Existing interview timestamps and schema-1 notebook data remain readable; there is no destructive migration.

JSON/IndexedDB round trips preserve the optional identity; TXT, Markdown and DOCX include file identities/times, but **contain no audio**. JSON restore still creates copies with new interview IDs. Audio identifiers remain evidence pointers; restoring JSON on another computer does not import WAVs or make them available. In the original profile, use Show all local recordings to find the original capture. Export each WAV separately alongside the JSON; a complete relocatable backup format is future work.

The IPC accepts an interview identity, UUID recording operations and typed PCM only, never renderer-supplied source paths. Export copies on disk through a user-selected save dialog; it rejects the app's internal recording directory as a destination. Diagnostics record fixed codes, not PCM, transcript, paths or arbitrary error text.

## Verification

Use Node 22.23.4 from `.nvmrc`. Windows Node 24 compatibility checks were also used during implementation, but do not replace the Node 22 baseline.

| Check | Evidence / boundary |
| --- | --- |
| `npm run verify` | Windows Node 22 baseline passed; latest regression counts and CI are recorded in the incremental PR. |
| `npm run test:native-runtime` | Windows Node 22: Passed, 30/30; no PostgreSQL. |
| `npm run test:desktop` | Windows Chromium / Node 22: Passed, 14/14 across two desktop viewports; bridge mocks, no physical capture. Includes delayed stop, catalog recovery and export cancellation. A task-owned preview process was explicitly terminated after a restricted-session teardown left port 4175 occupied; the final full run exited successfully. |
| WAV storage tests (part of verify) | Real temporary filesystem: exact PCM/header/duration, short writes, full queue, disk error, no overwrite, corrupt entry isolation, junction rejection and a separate process killed without finish followed by recovery. |
| Recorded session tests (part of verify) | Injected ASR with real files: exactly-once WAV despite inference replay, final drain, distinct resume files, native initialization cancellation, engine/storage failure and recovery. |
| Real Electron / packaged runtime | Source smoke Passed: actual capture/inference, WAV export, restart and forced termination/recovery. Repeat on the final packaged head; see the PR's actual reports and CI. |
| Local PostgreSQL / historical Web E2E | Not run locally; existing CI provisions isolated databases. Check this head's actual GitHub Actions. |
| Physical device / power loss / long session | Not verified. |

The extended `desktop/scripts/native-smoke.mjs` uses the pinned official public model/WAV, real Electron/preload/AudioWorklet/X-ASR and a disposable profile. It checks two WAV captures, export bytes, normal restart persistence, forced termination and explicit recovery. Windows termination targets only the spawned test process tree and waits for inherited Chromium handles to close; killing only the main process and immediately relaunching can leave temporary profile locks. CI uses the same script for source and unpacked packaged runtime, plus the existing unsigned installer/static checks. Only status reports are uploaded; captured audio and notebooks stay in ignored work directories.

## Manual acceptance still required

Follow the existing [Phase 3A Windows checklist](PHASE3A_WINDOWS_ACCEPTANCE.md), adding these tests in a disposable profile with fictional speech:

1. Speak known English and Chinese sentences for 30 seconds each. Pause, resume and finish; export each WAV and listen in a local player. Check the final word, duration and the distinct capture identities on transcript entries.
2. Run ten minutes, then thirty minutes if feasible, including silence and pause/resume. Monitor CPU, memory and recording disk growth (about 1.92 MB/minute). Compare text continuity and audio; do not infer speech accuracy from a nonempty transcript.
3. Close normally and reopen; audio and confirmed text remain. On a separate fictional session terminate the test app, reopen, recover its saved audio and confirm it is labeled interrupted. Listen for the incomplete tail. Never terminate the ordinary app or use participant data.
4. Disconnect a removable microphone. Confirm an interruption, preserved audio/text and deliberate retry. Test insufficient disk space only on an explicitly isolated disposable volume, never by filling the everyday system drive.
5. Keep JSON plus each exported WAV separately. Check JSON restored copies do not claim to import audio. Installation/uninstallation, updates/data retention, actual offline networking and macOS still need their own acceptance.

Phase 3B2 adds bounded native playback with exact file-relative sample slicing. Next: a versioned combined backup/restore format with association checks and rollback.
