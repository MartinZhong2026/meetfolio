# Claude Code handoff: local X-ASR infrastructure

## Checkpoint identity and boundaries

- Repository: `MartinZhong2003/meetfolio`.
- Branch: `feat/xasr-auto-install-native`, based directly on `main` at `edd9ed0c2a141541c1f0d07788dbf595b95eb95d`.
- Implementation checkpoint commit: `b7fb506c760620e6aad6c11e6cd05b59f5f50ac7`.
- Draft PR: https://github.com/MartinZhong2003/meetfolio/pull/5.
- The handoff metadata/evidence is committed after the implementation checkpoint; obtain the final checkout SHA with `git rev-parse HEAD` or the PR head. A file cannot contain its own final commit hash. The final chat/PR description records that head.
- **Historical checkpoint:** this document preserves the initial handoff. The user subsequently authorized resumed development; recovery/repair improvements and new verification are recorded in `docs/xasr-validation.md`. No merge, deployment, public installer, paid service, visibility change or edit to another session's branch.
- Existing Desktop UI Draft PR **#4**: https://github.com/MartinZhong2003/meetfolio/pull/4 (`feat/desktop-interface`, inspected head `e61dd2a5a977900a086e56aa3b49fcbf673d3924`). It remains separate. Do not coordinate integration until its task is complete and integration is authorized.
- Experimental PR **#3**: https://github.com/MartinZhong2003/meetfolio/pull/3. Selected provider/streaming logic was reviewed/reused and substantially revised. PR #3 was **not merged**, and its readiness badge/UI changes were not copied.

## Objective and architecture

A non-technical Windows researcher should eventually install Meetfolio, use the login-free desktop notebook, click **Download Free Speech Model**, see **X-ASR Ready only after actual initialization**, and transcribe interviews offline for free. No user-installed Node/Python/Docker/PostgreSQL or paid ASR key should be required. Optional paid AI summaries remain separate.

This branch supplies a standalone Node/desktop-main-process **model manager + native inference provider**. The manager does not start a web server, import a database or require login. It downloads/verifies/extracts the model, keeps a native recognizer loaded, implements the existing `AsrProvider` contract and owns truthful readiness. A child process loads sherpa-onnx and performs CPU inference. Existing web microphone/AudioWorklet → WebSocket → pipeline compatibility is wired and verified. The existing server application retains its account/PostgreSQL architecture; this branch does not migrate it.

PR #4 separately supplies the login-free local research UI and IndexedDB persistence, but no native runtime. **The secure native host bridge between the two branches is not implemented.** No React component/layout was changed here.

## Implemented files and functionality

| File | Implemented behavior |
| --- | --- |
| `server/src/asr/localXasrModel.ts` | Exact official artifact/version/bytes/SHA-256, exact model filenames, platform application-data defaults, regular-file completeness checks |
| `server/src/asr/xasrManager.ts` | `XAsrModelManager`; all seven states, status events/byte progress, cancellable/resumable pinned download, manual archive import, full integrity checks, install lock, staging/atomic rename, real native initialize/warm connection reuse, recording exclusivity, cleanup |
| `server/src/asr/xasrArchive.ts` | Streamed bzip2/tar extraction; traversal/absolute/Windows alias/device/link/special-file/duplicate rejection; entry/size limits |
| `server/src/asr/localXasr.ts` | Existing `AsrProvider` adapter; child process IPC, actual readiness acknowledgement, startup/flush timeout, 30-second queue cap, PCM alignment errors, failure propagation, native diagnostics |
| `server/src/asr/localXasrWorker.ts` | Actual CPU `OnlineRecognizer`, Zipformer2 transducer, 16 kHz PCM16-to-float, 100 ms decode increments, interim/final keys/timestamps, endpoints, final flush, CPU/RSS metrics, exit on host disconnect |
| `server/src/asr/factory.ts` | Explicit `local-xasr` selection with no paid or synthetic fallback |
| `server/src/config.ts` | Local provider/model directory config; pinned local model identity and no cloud ASR URL for local mode |
| `server/src/routes/meetings.ts` | Additive `localAsr` status in `/api/config`; existing interface shape preserved |
| `server/src/index.ts` | Native manager disposal during normal shutdown |
| `.env.example`, `.gitignore` | Developer configuration and scratch/model artifact exclusion |
| `server/package.json`, `package-lock.json` | Native runtime and extraction dependencies/locked platform packages |
| `server/src/scripts/xasr.ts` | Developer/CI status, download, import and initialize CLI; no end-user npm requirement implied |
| `server/scripts/check-xasr-runtime.mjs` | Target-platform package version/native library presence/load checks; desktop packaging gate |
| `server/scripts/verify-xasr.mjs` | Real archive/import/load, four speech WAVs, interim/final/timestamp/flush checks, host responsiveness, native bad-model containment/repair, metrics |
| `server/scripts/verify-xasr-browser.mjs` | Real native browser recording/persistence/review compatibility with file-backed microphone |
| `server/test/xasr.test.ts` | 11 manager/config/download/recovery tests, injected runtime/transport doubles |
| `server/test/xasr-archive.test.ts`, `xasr-archive-fixtures.json` | 13 actual archive parser/path rejection cases, tiny synthetic fixtures |
| `.github/workflows/xasr-native.yml` | Real-model smoke on Ubuntu/Windows x64 Node 22, uploaded JSON evidence; no installer publication |
| `docs/local-xasr.md` | API contract, state semantics, paths, safety/recovery, developer reproduction |
| `docs/windows-xasr-packaging.md` | Real Windows npm binary inventory, required resource placement, Electron constraints and target-machine gates |
| `docs/third-party/*` | X-ASR/sherpa Apache licenses, ONNX MIT license/full third-party notices, redistribution inventory/limitations |
| `docs/xasr-validation.md`, `docs/xasr-native-linux.json`, `docs/xasr-browser-linux.json`, `docs/verification/local-asr/*` | Saved evidence, exact verification distinctions and limitations |

## Download/install details and exact versions

Model: **X-ASR 480 ms, Chinese/English punctuation, INT8, 2026-06-05**. Encoder/joiner are INT8; `decoder.onnx` is the package's FP32 decoder. Required files: `encoder.int8.onnx`, `decoder.onnx`, `joiner.int8.onnx`, `tokens.txt`.

Official URL:

https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2

Size: **133,895,136 bytes**. SHA-256: **fa5f63d618e5a01526e275a358bb7772e403f84808a4769fba52cffd8160bf74**. GitHub release asset digest and actual downloaded archive matched. Original model: https://github.com/Gilgamesh-J/X-ASR (Apache-2.0). No weights/private audio are committed.

Native packages: **`sherpa-onnx-node@1.13.8`**, target-platform **`sherpa-onnx-linux-x64@1.13.8` / `sherpa-onnx-win-x64@1.13.8`**, exact resolutions/integrity in the lockfile. Runtime wrapper is an optional server dependency, mandatory for desktop packaging. Linux bundled ONNX Runtime version string: **1.28.2**. Extraction: **`tar-stream@3.1.7`**, **`unbzip2-stream@1.4.3`**; heartbeat locks **`proper-lockfile@4.1.2`**, types **`@types/proper-lockfile@4.1.4`**; extraction types **`@types/tar-stream@3.1.5`**, **`@types/unbzip2-stream@1.4.3`**. Preserve the full committed lockfile.

Download streams to a private `.part`, resumes with strict Range verification, safely restarts if the server ignores Range, verifies size/hash before extraction, uses bounded safe staging extraction and atomic rename, then loads the native recognizer. A `.xasr-install-lock` prevents concurrent installers. Cancellation retains partial bytes; hash failure discards damaged bytes. Manual import copies and verifies the exact same archive. No arbitrary URL/general-model imports are exposed.

Default Windows path: `%LOCALAPPDATA%/Meetfolio/models/<model-id>`. Desktop should pass `path.join(app.getPath('userData'), 'models')` explicitly. Models stay outside the app bundle. Extracted archive is about 163 MiB; allow room for archive/import copy/staging as well.

## Native inference/readiness

States: `not-installed`, `downloading`, `download-failed`, `installed`, `loading`, `ready`, `error`. File checks only produce Installed. Ready follows **real native recognizer and stream construction**; the process remains loaded and is reused by the next recording. Clean stop returns to Installed. Errors/invalid model cannot produce Ready.

Child-process isolation replaced PR #3's worker thread after repeated-load observations showed native memory accumulation. Child exit releases native allocations and contains native aborts. IPC is advanced serialization; window hiding is enabled on Windows; child execution uses no inherited `execArgv`. Electron gets `ELECTRON_RUN_AS_NODE=1`, requiring its RunAsNode fuse. Source `tsx` development resolves the already compiled child under `server/dist`; production uses adjacent compiled JS.

Audio is 16 kHz mono little-endian PCM16 (existing `MicCapture` sends 100 ms / 3,200-byte frames). The child converts locally, decodes in 100 ms blocks, emits native interim/final results with stable session keys and millisecond timestamps, detects endpoints and adds tail silence only for flush (not interview timestamps). Finish resolves true only after native acknowledgement. No synthetic text, cloud fallback, AGPL VoxMinutes code, diarization or implemented hotword biasing.

## Configuration/build/reproduction commands

Developer prerequisites are not end-user requirements. Use Node 22+ and the committed lockfile:

```bash
npm ci --include=optional
npm run typecheck
npm run build
npm test
node server/scripts/check-xasr-runtime.mjs
node server/dist/scripts/xasr.js status
node server/dist/scripts/xasr.js download
node server/dist/scripts/xasr.js import /path/to/pinned-model.tar.bz2
node server/dist/scripts/xasr.js initialize
node server/scripts/verify-xasr.mjs /path/to/pinned-model.tar.bz2 /path/to/disposable-root report.json
PW_CHROMIUM=/usr/bin/chromium npm run test:e2e
PW_CHROMIUM=/usr/bin/chromium node server/scripts/verify-xasr-browser.mjs http://127.0.0.1:8876 /path/to/installed/test_wavs/0.wav
```

Use `X_ASR_DATA_ROOT` for the CLI's disposable model root. Existing web integration: `ASR_PROVIDER=local-xasr`, optional `X_ASR_MODEL_DIR`; paid keys are unnecessary. Build the server before source-mode native use. `npm test`/browser integration need an isolated test PostgreSQL (`TEST_DATABASE_URL`/`E2E_DATABASE_URL`); the standalone manager/native smoke needs no DB. Browser-native script requires a running isolated local test app/database with `DEMO_MODE=false`, local provider and no paid key; it creates a fictional test account/interview in that test app.

The checkpoint's test DB used loopback port 55433 and disposable database names. Never use real research data for schema-reset tests. The native OS-offline reproduction command and Node container details are in `docs/xasr-validation.md`. Node 24 automatic download used `NODE_USE_ENV_PROXY=1` for the environment proxy; an Electron host can inject `net.fetch` for OS proxy support.

## Verification and preserved evidence

- Automatic official download/install/native initialization: passed Linux x64.
- Manual verified import: passed.
- Real native speech recognition: all **four official bundled speech WAVs** passed, including partials, final keys, timestamp bounds and flush.
- **OS-offline proof:** Node **v22.23.4** Docker container with **`--network none`**, real model, no DB/login/remote service; all four samples passed. Saved report: `docs/xasr-native-linux.json`.
- Bad native model → Error with host alive; replace/repair model → Loading → Ready: passed with actual native runtime.
- Native child RSS approximately **336–338 MiB**, host approximately **58–60 MiB** across successive short sessions in final OS-offline report; child CPU **7.7–12.1 s**; wall times **8.5–10.9 s**, including replay/startup as documented. These are short samples under shared CPU, not real-time hardware guarantees or a long-session benchmark.
- Chromium file-backed microphone through the unchanged recording pipeline, real native model, persistence and review: passed (`docs/xasr-browser-linux.json`). **No physical microphone or Windows test occurred.**
- TypeScript checks/builds: passed. Initial checkpoint: server **117/117**, web unit **25/25**; browser regressions **30/30**, desktop/tablet/mobile. See committed text evidence.
- Unit manager tests inject fake native providers/transports; archive fixtures are synthetic. Existing long-session/provider/LLM tests use mocks/virtual time. The native scripts use actual model weights and real public sample audio. Fragment assertions are not WER/CER accuracy evaluation.
- Resumed code commit `0af42bc` passed actual Windows x64 and Ubuntu native smoke/repair CI, and final local tests reached **119 server + 25 web**. Windows reports and current CI links are in `docs/xasr-validation.md`. Remote CI status must be read from the Draft PR. The Windows workflow's existence does not mean it passed. The later user request authorized resumed testing; final results are recorded in the validation document.

## Known bugs, risks and incomplete functionality

1. **No PR #4 bridge or complete Windows installer.** Login-free UI/persistence is separate; existing web-server compatibility still uses accounts/PostgreSQL. Do not market this checkpoint as the finished desktop product.
2. **No actual Windows hardware/packaged Electron verification**, no physical microphone, no signing/upgrade clean-machine tests, no 60–90 minute physical recording/accuracy benchmark.
3. Install locks now use a 10-second heartbeat and are automatically reclaimed after 30 seconds without updates. A legacy nonempty lock from the experimental checkpoint still requires closed-application cleanup. Abandoned staging/import data can also remain after an OS kill.
4. Explicit `repair()` and `importArchive(file, { repair: true })` now replace damaged model directories using verified staging and a rollback backup. UI binding remains future integration work. Abrupt termination between directory switches can leave a `.xasr-previous-*` backup that needs closed-application recovery.
5. Manual import only accepts the exact pinned archive; other models/variants are rejected. No model upgrade/removal UI.
6. One recording per manager. 30-second unacknowledged-audio cap explicitly fails on overload. Low-end CPU suitability/continuous memory use remains unqualified.
7. Readiness proves initialization, not accuracy. Sample recognition has errors; transcript review remains necessary. Hotword/context hints are not applied; speaker attribution is not automatic.
8. Native IPC/process packaging must match Electron's actual runtime/fuse behavior. Windows native dependency optional-install failures must fail packaging. Source-mode developers must build the native child first.
9. Archive extraction uses JavaScript bzip2/tar in the host process; UI renderer is separate, but main-process responsiveness during large extraction still merits profiling/isolation in the final desktop host.
10. No automatic local text-data migration/encryption/sync, paid AI setup, final installer-level transitive license/audit or remediation of pre-existing dependency advisories. Those concerns are not silently completed here.
11. Downloader evidence includes a historical transient Error on deliberate disposal before a status-polish fix. Final behavior/report reflect intentional disposal as Installed. Two verification harness races were corrected (initial existing Installed state; waiting for review data); evidence is explained in the validation document.

## Windows distribution requirements

See `docs/windows-xasr-packaging.md`. The inspected official win-x64 npm archive includes `sherpa-onnx.node`, `sherpa-onnx-c-api.dll`, `sherpa-onnx-cxx-api.dll`, `onnxruntime.dll`, `onnxruntime_providers_shared.dll`, plus package JS/metadata. Ship the **entire** platform directory adjacent to `sherpa-onnx-node`, extraction dependencies and compiled ESM inference files, outside ASAR (or unpack the complete coherent subtree). Run the target-platform runtime check before packaging. Do not omit optional deps or copy Linux binaries into Windows.

Bundle Electron/Node runtime so researchers install no development tools. Current fork supports Electron RunAsNode; if the UI host disables that fuse, adapt to `utilityProcess.fork` or a bundled helper. Check DLL/VC++ runtime requirements and exact installed-app loading on clean Windows. Include Apache/MIT/transitive notices from `docs/third-party` and installed packages. Model remains in user-data storage across upgrades. No public installer distribution is authorized by this checkpoint.

## Integration plan with Desktop UI Draft PR #4

**Documentation only; no integration/merge was performed.** Inspect the final PR #4 head after that task finishes. Its current `web/src/desktop/runtime.ts` declares optional `window.meetfolioDesktop` version 1:

- `getModelStatus(): Promise<ModelStatus>`; UI states are only `missing | downloading | installed`, with `modelId`, `offline: true`, optional `engineLoaded`, and byte progress.
- `downloadModel?(onProgress)`.
- `requestMicrophonePermission(): granted | denied | unavailable`.
- `startTranscription({onSegment, onInterruption}) → { stop(): Promise<void> }`.
- Ready requires `state === 'installed' && offline === true && engineLoaded === true`.

A future trusted preload/main bridge should adapt manager `ready` to UI `installed + engineLoaded:true`; plain installed/loading must have `engineLoaded:false`. Never map file presence to loaded. Preserve all manager error/cancel states in host errors/UI handling (PR #4's three-state type may need an agreed extension). `downloadModel` invokes manager download and forwards real progress; completion must re-query actual readiness.

PR #4 expects the **host to own capture/permission**, unlike its old browser/cloud route. Build a secure capture bridge using the existing PCM resampling logic or a native capture component; validate the IPC sender/session and transfer bounded PCM frames. Only forward **final** native results to PR #4's current `onSegment` persistence API, constructing its existing `Segment` shape and stable per-session IDs; define a separate partial-display extension if desired. Its renderer already namespaces IDs and offsets session-relative timestamps, so do not offset twice. Make stop idempotent, release capture, flush confirmed text and surface failures via `onInterruption`.

Keep PR #4's IndexedDB notebook, original-text preservation, exports, consent checks, writer lock and three-column workspace. Do not route this notebook through mandatory Fastify/auth/PostgreSQL. Bind native file picker for import; never accept renderer-controlled filesystem/download/child-process arguments. Re-run both branches' combined checks only in a separately authorized integration branch, without altering either original branch.

## Concrete next tasks for Claude Code

1. Fetch this branch and PR #4; read this handoff and validation matrix, confirm final remote heads/CI and that the UI task is complete. Preserve both original branches and do not merge without authorization.
2. In a new integration branch, choose/confirm the desktop host and implement the secure version-1 runtime adapter described above; integrate manager progress/errors, real permission/capture, PCM streaming, final segments and idempotent flush/stop.
3. Package the pinned runtime/unpacked resource tree, enforce target-native package checks, validate Electron child-process/fuse/DLL behavior and no developer prerequisites on clean Windows x64.
4. Add recoverable, user-facing stale-lock/model-repair/import flows without deleting research data; profile archive extraction and isolate it if needed.
5. Run actual Windows microphone/offline acceptance and long interviews with independent ground truth; record CPU/memory, latency, gaps, sleep/restart and accuracy honestly. Keep mock tests separately labeled.
6. Complete final license/dependency/signing/upgrade review before proposing a separately approved installer release. Keep optional AI distinct from free recording/transcription.

No API keys, personal recordings, model weights, node_modules, build outputs, database contents or temporary work directories belong in this handoff commit. Re-download the pinned official archive using the URL/hash above.
