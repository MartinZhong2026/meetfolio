# Phase 4.1 — product readiness and long audio

Baseline: `feat/phase4-audio-research-workspace`, Draft PR #5, `744adf9c00690fd973c0735915632c251810e0e2`. That commit remains the functional and visual rollback reference. Phase 4.1 is isolated in `feat/phase4-1-product-readiness`, stacked on Phase 4. This remains an unsigned reconstruction/review build, not a release or an accepted v0.6.0 replacement.

## Native long-audio path

On Windows x64, **Import audio → Download local decoder** explicitly installs a checksum-pinned optional FFmpeg executable (~110 MiB). **Import decoder ZIP** supports offline setup from the exact upstream ZIP. The UI states its GPL license; it is absent from the installer. See [decoder provenance and license](../third-party/ffmpeg-notices.md). X-ASR and optional speaker models keep their existing verified lifecycle.

With the decoder ready, **Choose recording** uses a native file picker. The main process retains the path and exposes a one-use opaque capability to the sandboxed renderer. It checks the regular-file type, supported extension, 2 GiB input limit, metadata duration up to 120 minutes, and available space for a normalized WAV plus a small reserve. Duration metadata is only a preflight: actual decoded sample count independently enforces the limit. Inputs with unknown duration are rejected with a PCM WAV fallback. WAV/MP3/M4A codecs run in a hidden child without shell expansion or HTTP protocols. Fixed demuxers, bounded allocations and two decode threads reduce the attack surface; this child is not an OS sandbox against every possible codec vulnerability.

PCM16 mono/16 kHz data streams through one-second disk writes with backpressure. No complete decoded audio buffer crosses IPC or occupies browser memory. The existing writer synchronizes at least each second and finalizes the WAV before inference. A 120-minute normalized recording is 230,400,000 PCM bytes (~219.7 MiB), regardless of compressed input size. The original is read-only and is not retained as an original compressed copy: keep it separately. Setup/model caches also require disk space beyond the WAV reserve. A disk-space preflight cannot guarantee that space stays available; write errors still stop processing and retain saved data.

The original drag/drop/browser path remains available for small files, with its **64 MiB / 20 minute / mono-stereo** guard. On Windows with native setup, use **Choose recording** for long files. Other platforms have not acquired native long-file support in this milestone. Native decoding/normalization interrupted before finalization uses the existing partial-WAV recovery, then re-import of exported audio; it cannot resume from a compressed-file byte offset.

## Bounded inference and recovery

The idle live-recognition model is released before file inference and reloaded afterward, avoiding two simultaneous model instances. The inference worker reuses a 120-second PCM buffer and Float32 array: **11,520,000 bytes** together. Neural runtime, features, embeddings, transcript objects and decoder memory are additional; this figure is not a whole-process memory cap. The worker uses two inference threads and a below-normal scheduler hint on Windows. Parent disconnect terminates it; a ten-minute no-progress watchdog retains the WAV/checkpoint rather than retrying indefinitely.

Each completed two-minute window atomically saves `import-checkpoint.json`, including stable segment IDs, original inferred text, sample progress, settings and voice centroids. Atomic replacement retries transient Windows sharing violations for a bounded 1.55 seconds, retaining the previous checkpoint until success. Unfinished `.part` files remain harmless recovery evidence. Files are bounded to 8 MiB, 10,000 segments and 12 voice centroids and validated before use. File ownership remains tied to the interview's native recording metadata.

**Import audio → Continue unfinished work** shows progress and supports **Resume** and **Review confirmed text**. Resume reads the owned saved WAV, so it does not require the original selected file. At worst the unfinished inference window is recomputed. Existing notebook edits, importance markers, speaker corrections and cleared review flags remain authoritative when native results are merged by stable ID. Completed sidecars remain recoverable through Local storage. Nothing rewrites historical audio or migrates database schemas.

Voice numbers are local estimates. Per-window diarization uses the existing Pyannote/ERes2Net models; a longest-turn embedding is compared with prior voice centroids (cosine threshold 0.55) to maintain labels across windows. Expected speaker count limits total labels on long files; per-window clustering still auto-detects who is present. Short samples, acoustically similar voices, changing microphones and overlaps can still split or merge labels. This heuristic is not calibrated diarization confidence or identity recognition.

## Review experience and reliability boundaries

Review renders at most 100 transcript rows per page, with deferred text search, speaker/marked filters, cross-page evidence navigation and persistent manual edits. A 6,000-segment browser fixture exercises paging and source focus. The **Needs review** queue highlights detected overlap, turns shorter than one second and turns at two-minute boundaries; **Mark reviewed** records the user's decision without changing original text or audio. Flags are deterministic listening prompts, not statistical confidence. They are included in text/document exports and optional JSON fields, preserving old schema-1 notebooks.

Timestamps remain sample-bounded turn/endpoint ranges, not forced-aligned words. Hard window boundaries and the recognizer's 25-second utterance endpoint can cut a phrase or word; generated English continuous-speech testing reproduced that limitation. Overlapping speech is not separated into independent clean audio tracks. A missing flag does not mean a sentence is correct. Keep manual text and speaker correction available and listen to the source before citing it. This milestone retains the neutral paper/green workspace, compact controls and independent research inspector instead of introducing a new navigation system.

## Performance evidence

Local Windows / Node 22.23.4 worker benchmarks use repeated or padded **public fixtures**, not private interviews. These measurements include checkpoint I/O and an abrupt inference-worker interruption/resume, but exclude native normalization and physical devices. Load, CPU, storage and audio density affect results.

| Controlled fixture | Processing | Peak observed worker RSS | Reused audio buffers | Resume |
| --- | --- | --- | --- | --- |
| 60 minutes continuous repeated public speech, ASR only | 217.78 s | 324.2 MiB | 10.99 MiB | 14 segment IDs preserved; 30 windows |
| 60 minutes continuous repeated public four-speaker speech, diarization + ASR | 1,292.95 s | 873.8 MiB | 10.99 MiB | 21 segment IDs preserved; 30 windows |
| 120 minutes: public ~57 s speech prefix, remaining digital silence; diarization enabled | 17.82 s | 544.8 MiB | 10.99 MiB | 10 segment IDs preserved; 60 windows |

The sparse result is a duration, memory and recovery stress test; it does **not** predict two hours of continuous multi-party speech. Digital-zero windows skip inference; low-volume speech does not use that shortcut. Whole-app/model/decoder RSS, Windows sleep/resume and a 120-minute dense real interview still need target-device acceptance. No CER/WER/DER accuracy number is claimed. Public Chinese four-speaker and mixed Chinese/English examples exercise plumbing; they do not represent accents, code-switching, noise or overlap in real interviews.

The dense diarization run occurred alongside builds/browser/native regression on this machine. Its per-window RSS fluctuated from ~589 to 874 MiB and ended at ~709 MiB, rather than growing with the entire recording length. It produced 650 segments and four estimated labels under a four-voice cap; these counts are not a diarization accuracy score. A six-minute multi-window run also resumed successfully (65 segments). A one-minute repeated Windows Zira TTS English fixture produced English text using the native model; it is synthetic speech, not listening acceptance. The two-hour actual Electron flow also passed native WAV normalization, restart/resume, correction retention, playback/export and native public mixed-speech MP3/M4A processing with zero counted HTTP/WebSocket requests.

Reproduce after `npm run build:electron` and the existing public fixture preparation:

```powershell
node desktop/scripts/import-benchmark.mjs --minutes 60 --speech --interrupt --out work/phase4-1/benchmark-60-speech
node desktop/scripts/import-benchmark.mjs --minutes 60 --speech --diarize --interrupt --out work/phase4-1/benchmark-60-voices
node desktop/scripts/import-benchmark.mjs --minutes 120 --diarize --interrupt --out work/phase4-1/benchmark-120-sparse
node desktop/scripts/prepare-readiness-fixture.mjs
$decoder = Get-Content -Raw work/phase4-1/ci-decoder/fixture.json | ConvertFrom-Json
$fixture = Get-Content -Raw work/phase4/ci-fixture/fixture.json | ConvertFrom-Json
node desktop/scripts/readiness-smoke.mjs --decoder $decoder.archive --audio $fixture.audio --speakers $fixture.speakers
```

The actual Electron readiness script imports the pinned ZIP, normalizes a generated two-hour WAV, cancels at a checkpoint, reviews/corrects confirmed text, closes/relaunches, removes access to the original source, resumes, verifies IDs/corrections, plays audio and exports TXT. It also creates public mixed-speech MP3/M4A fixtures and exercises native decoding/inference. Only native dialog responses are supplied by automation; preload, storage, decoder, models, inference and media playback are real. Electron HTTP/WebSocket requests are blocked after launch and counted. UI screenshots use the built desktop UI in Chromium because verification-mode Electron windows are hidden; screenshots do not prove native behavior.

## Dependency and backup audit

The full baseline audit had 22 moderate advisories; the updated full audit has **17 moderate, zero high/critical**. Scoped overrides update the deprecated Drizzle loader's nested esbuild to 0.28.2 and Fastify Static's glob to 14.0.2. The root lockfile records exact resolved versions; Vite's esbuild stays compatible. The production static-serving path, Drizzle migration generation in an isolated CLI copy, builds and installer assembly must be verified. Do not run automatic `npm audit fix --force`: its suggested old electron-builder/Fastify/Drizzle versions would remove current behavior and are not safe resolutions.

Remaining moderate advisories primarily involve electron-builder's old EJS/file-list/minimatch chain and historical React Router 6. The desktop has no React Router and uses neither an esbuild dev server nor EJS with untrusted templates. The historical web app does use Router 6, so an independent Router 7 migration and redirect regression remain warranted; absence of SSR does not dispose of every redirect advisory. Audit counts are dependency advisory groups, not independent exploit counts. Keep the existing `npm audit --audit-level=high` CI gate, including development dependencies. No checks are suppressed.

Full server regression exposed an existing asynchronous completion race: summary detail could report `failed` while the dashboard still reported `generating`. Final detail/dashboard updates now commit together in a transaction, including retention of a previous usable summary. The final historical server suite passed **127 tests twice** afterward. This fixes state consistency only; it does not add cloud AI to the desktop, call a real provider or change the database schema. Migration SQL generation was checked in an isolated copied CLI because the existing workspace Drizzle Kit command cannot resolve the server's nested `drizzle-orm`; the normal CLI hoisting issue remains separate technical debt. No migration was applied to application data.

Local checks include clean `npm ci --include=optional`, `npm run verify`, 64 Desktop unit tests, 47 Web unit tests, 32 native lifecycle tests, 24 desktop browser tests (including axe), 33 historical web browser tests, dependency audit, unsigned NSIS/static package checks and actual unpacked-EXE import/capture/recovery/playback. A focused four-case UI rerun passed after the final progress reset. Native process release failure now rejects file-import preparation rather than hiding a cleanup timeout. Initial checks found and fixed the label-wrapped picker accessible-name issue, transient Windows checkpoint replacement handling, ASAR collection of already-bundled ZIP-reader modules, and a fresh-install Electron binary preparation gap. Native smoke assertions wait for real asynchronous exports and the documented bounded metadata probe; hidden verification-window screenshots are kept separate from functional checks.

JSON backups still omit WAVs, decoder/models and native checkpoints. Restored interview copies intentionally do not inherit original audio capabilities. Files are local and unencrypted. The UI already warns and exports individual WAVs; combined encrypted/versioned backup, validation of restored audio associations and automated backup scheduling remain a separate stage. Before real use, export both JSON and every WAV and keep the original recordings. Copying an actively written profile is not a consistent backup. No user data or production database was accessed for these tests.

## Required human acceptance

1. On a spare/test Windows profile, build the unsigned installer, record its hash, install and launch it. Confirm existing data is untouched; do not uninstall or test data deletion against a valuable profile. Packaging/static review is not installation acceptance.
2. Install/import X-ASR, speaker models and the exact decoder ZIP once. Disconnect the OS network, then import a consented WAV, MP3 and M4A. Verify every setup status remains ready and no paid/cloud service is required.
3. Use a representative 60–120-minute interview: Chinese, English, code-switching, rapid turn changes and deliberate overlap. Note CPU/RAM, total time, disk consumption and UI responsiveness. Listen to a manually transcribed subset and record omissions, timestamp drift and speaker errors; do not infer accuracy from synthetic fixtures.
4. Cancel during decoding and during inference separately. For inference, review a completed window, edit text/speaker labels, close/restart and Resume. Confirm edits persist and the unfinished tail is not presented as complete. Test OS sleep/resume and power interruption only on disposable copies.
5. Connect real microphone/headphones; record, pause/resume, unplug/reconnect, stop, play several segments and switch interviews. Automated file-backed capture and tones cannot establish physical-device behavior.
6. Export TXT/Markdown/DOCX, JSON and WAVs. Open documents in the target reader and listen to WAVs. Restore JSON into a disposable profile, confirm the explicit audio limitation, and retain originals until a combined-backup feature is accepted.

CI retains all five jobs and existing PR/main-only push triggers. Windows adds source two-hour readiness and packaged short readiness with public/generated data; artifacts remain status JSON only. No merge, production deployment, account security change, schema migration, installation or release occurs in this milestone. Exact local counts, commit SHA and real CI result belong in the final PR report.
