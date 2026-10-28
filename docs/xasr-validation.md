# X-ASR validation checkpoint — 2026-10-24

The initial checkpoint was preserved and pushed before the user authorized resumed development. Subsequent verified recovery work is recorded below. No product completion, merge, deployment or installer publication is claimed.

## Observed working

- Official model fetched by the automatic downloader: **133,895,136 bytes**, SHA-256 `fa5f63d618e5a01526e275a358bb7772e403f84808a4769fba52cffd8160bf74`. Verified, extracted, atomically installed, and initialized with `sherpa-onnx-node@1.13.8` on Linux x64. [Downloader output](verification/local-asr/automatic-download.txt).
- Manual import of that exact archive passed verification, extraction, installation and real native loading.
- **All four bundled real speech samples** produced nonempty Chinese/English native transcripts and partial results, unique final keys, bounded timestamps and acknowledged flushes.
- The same sample suite passed in **Node v22.23.4 in a Docker container with `--network none`**, a read-only application tree and writable disposable model directory. No DB, account, API key or web server was used in this test. [Full report](xasr-native-linux.json).
- Invalid native model → Error, host survives; replace invalid files with the verified model → Loading → Ready. Recorded in `failureRecoveryStates` in the report.
- Existing browser recording path passed with Chromium's **file-backed microphone** and the real local model: `getUserMedia → AudioWorklet → PCM16 → WebSocket → native CPU inference → persisted transcript → review`. Demo and paid APIs were disabled. The existing web app's registration/PostgreSQL were used only for this compatibility check, not by the standalone native manager. [Browser report](xasr-browser-linux.json).
- Existing browser regressions: **30/30**, desktop/tablet/mobile. [Output](verification/local-asr/browser-regressions.txt).
- Final TypeScript checks and web/server builds: passed. [Typecheck](verification/local-asr/typecheck.txt), [build](verification/local-asr/build.txt).
- Initial checkpoint server suite: **117/117**; final resumed suite: **119/119** (95 existing + 24 X-ASR tests), with **25/25 web tests**. [Initial output](verification/local-asr/unit-tests.txt), [final resumed output](verification/local-asr/resumed-unit-tests.txt).

The first full server run had 113 passes; four additional Windows path-alias cases brought the final total to 117. Early manual native checks used Node v24.19.0; the OS-isolated report deliberately uses Node 22.

The downloader log predates the disposal-status polish: it shows Ready followed by a transient Error during deliberate close, then Installed. The final manager treats deliberate disposal as Installed. The final native report records the corrected lifecycle. Two test-harness assertions were also corrected during verification: retained existing installation state was included in the initial state list, and browser review assertions now wait for asynchronous transcript loading. No application code was changed to weaken those assertions.

## Measured limits

In the final network-disabled sample run, child RSS was approximately **336–338 MiB**, and host RSS **58–60 MiB** across successive sessions. Child CPU totals were approximately **7.7–12.1 seconds** per test process. Wall times **8.5–10.9 seconds** include input replay and, after the first sample, native process/model startup. The CPU was shared with other verification. These numbers show short-sample behavior, not a sustained real-time or low-end hardware guarantee. Host timer callbacks continued during inference.

A preliminary worker-thread experiment showed native allocations accumulating between loads. The preserved implementation uses a child process to contain native failure and release those allocations on exit. No 60–90 minute physical interview was run.

## Mocked versus real

| Verification | What is real | What is simulated/injected |
| --- | --- | --- |
| `server/test/xasr.test.ts` | Manager state machine, filesystem, size/hash checks, range/cancel handling | Native provider and download responses are test doubles; tiny fixture files are not ONNX |
| `server/test/xasr-archive.test.ts` | Actual bzip2/tar parsing and rejection behavior | Small synthetic safe/malicious archives |
| Existing pipeline/browser regression suites | App, DB, recovery/persistence/UI behavior | DashScope/LLM providers and virtual long-duration scenarios |
| `server/scripts/verify-xasr.mjs` | Official model archive, real native CPU inference, real speech WAVs, load/error/repair/flush | Network transport disabled in manager; outer Docker network also disabled for the saved report; short reference-fragment checks only |
| `server/scripts/verify-xasr-browser.mjs` | Existing browser capture/resampling, local app/database, native model and saved text | Chromium file-backed microphone replaces physical hardware; no synthetic transcription |

Reference-fragment assertions (`Monday`, `always`, `frequently`, `时态`) are smoke checks, **not** independent WER/CER accuracy benchmarks. Sample transcripts can contain recognition errors and require human review. No private interview recording was used.

## Reproduce the OS-isolated verification

After `npm ci --include=optional` and `npm run build -w server`, obtain the exact archive from the official URL in [local-xasr.md](local-xasr.md), then mount the checkout read-only and a disposable writable model root into Node 22:

```bash
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --user 1000:1000 \
  --mount type=bind,src=/absolute/checkout,dst=/app,readonly \
  --mount type=bind,src=/absolute/disposable-model-root,dst=/models \
  -w /app node:22-bookworm-slim \
  node server/scripts/verify-xasr.mjs /app/work/xasr.tar.bz2 /models/install /models/report.json
```

Adjust the UID/GID for the writable host directory. Docker was a **verification tool only**; it is not an end-user application dependency. The script can also run directly with Node. For a direct download behind an environment proxy, the checkpoint used Node 24's `NODE_USE_ENV_PROXY=1`; normal desktop hosts should supply their supported proxy-aware transport, such as Electron `net.fetch`.

## Unverified / incomplete

- Desktop UI PR #4 is not integrated. No Electron/Tauri host/preload, physical capture bridge or desktop installer is supplied here.
- No physical Windows microphone, packaged DLL loading, Electron child-process/fuse behavior, Windows installer/upgrade/signing or clean-machine prerequisite test occurred in this environment.
- Windows x64 and Ubuntu real native smoke/recovery passed for code commit `0af42bc` in [run 40071826678](https://github.com/MartinZhong2003/meetfolio/actions/runs/40071826678). This does not verify a packaged desktop installer or physical microphone.
- No long physical session, independent accuracy benchmark, minimum-hardware qualification or final installer dependency/license audit.
- Heartbeat locks now reclaim stale locks after 30 seconds. A legacy nonempty lock from the initial checkpoint may need closed-application cleanup; model-removal UI is not implemented.
- Explicit download/import repair now replaces corrupted model directories safely; default Retry does not silently replace an existing target. Manual import supports only the exact pinned archive. A process kill between repair renames may leave a backup requiring closed-application recovery.
- Existing web backend still needs its account/database. The standalone manager does not; login-free local persistence is supplied separately by PR #4 and still needs a native bridge.

See [Claude handoff](CLAUDE_HANDOFF_LOCAL_ASR.md) and [Windows packaging requirements](windows-xasr-packaging.md).

## Resumed recovery milestone

- `proper-lockfile@4.1.2` provides a 10-second heartbeat, 30-second stale-lock recovery and cancellation on loss of exclusivity. Explicit repair stages verified bytes, backs up an existing model directory, rolls back a failed promotion and cleans successful backups. Native finish waits for child process exit before releasing model file handles; repeated finish remains successful.
- Focused tests: **24/24** (11 manager/config/download/recovery + 13 archive cases). [Output](verification/local-asr/recovery-unit.txt).
- Real pinned archive and native recovery passed in Node 22 with `--network none`: injected transfer failed after roughly 2 MiB, retained **1,900,544 bytes**, resumed with `Range: bytes=1900544-`, verified/extracted/loaded, recognized real sample 0, detected deliberately damaged ONNX, repaired via verified archive import, then recognized the sample again with correct final timestamps. Paths included spaces and Chinese characters. Only the HTTP response/failure was injected; archive bytes and CPU inference were real. [Report](verification/local-asr/native-recovery-linux.json).
- Checkpoint commit `b7fb506` also passed real native smoke on **Windows x64 and Ubuntu** in [GitHub Actions run 40071377832](https://github.com/MartinZhong2003/meetfolio/actions/runs/40071377832). This is native Node/DLL verification, not a Windows installer or physical microphone test.
- The checkpoint's general CI encountered a timeout in the existing mocked AI-summary regeneration test (`summaries.test.ts:169`), while the local full suite passed. Its route updates the summary and meeting state in separate operations; CI status on the final head must be checked separately. No ASR assertion failed in that run.

## Final native verification on Windows and Linux

Code milestone **`0af42bccb9ba0dd80fe39538321050a81636e6b6`** passed the complete native workflow on Windows x64 and Ubuntu. Windows verified the pinned native package and required DLL inventory, actual model load, all four public speech samples, native error/repair, interrupted-body resume, stale heartbeat lock recovery, damaged model replacement, idempotent finish and a model path containing spaces and Chinese characters. The model was downloaded from the official release; no paid provider was used.

Preserved Windows reports were extracted from the GitHub job's JSON stdout, with their exact source/job/commit recorded:

- [Real Windows native smoke](verification/local-asr/native-smoke-windows.json)
- [Real Windows native repair/recovery](verification/local-asr/native-recovery-windows.json)

Final local typecheck, build and full tests also passed after the recovery changes: **119 server + 25 web**. [Typecheck](verification/local-asr/resumed-typecheck.txt), [build](verification/local-asr/resumed-build.txt), [tests](verification/local-asr/resumed-unit-tests.txt). Existing 30-test browser regressions and the native file-backed microphone result remain preserved above. The general CI server suite passed on the resumed code head; the earlier summary-test timeout did not recur in that run.

These checks do not constitute a Windows installer, Electron/ASAR/fuse validation, physical microphone test or long-interview accuracy qualification. PR #4's native preload/capture adapter remains a subsequent integration step; its branch and UI were not modified.
