# Automatic X-ASR installation and native transcription

This branch supplies reusable **local speech infrastructure**, based on selected code from experimental PR #3. It does not merge PR #3 or the Desktop UI branch. No workspace layout or React component is changed.

The native model manager and provider run without registration, API keys, PostgreSQL, Python, Docker, a web server or a remote inference service. The **existing web application still has its existing authentication and PostgreSQL requirements**. A complete login-free desktop application, local transcript persistence and a clickable model button depend on the separate Desktop UI integration; they are not claimed as complete here.

## Model and runtime

- Model: official X-ASR 480 ms streaming Zipformer2 transducer, bilingual Chinese/English, punctuation, INT8 encoder/joiner with the package's FP32 decoder.
- Source: [k2-fsa/sherpa-onnx official ASR model release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models), originating in [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR).
- Artifact: `sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2`.
- Size: **133,895,136 bytes** (127.69 MiB).
- SHA-256: **fa5f63d618e5a01526e275a358bb7772e403f84808a4769fba52cffd8160bf74**. Pinned from GitHub's release asset `digest`, independently matched against the downloaded bytes on 2026-10-24.
- Native runtime: `sherpa-onnx-node@1.13.8`; platform packages pinned by `package-lock.json`. Real compatibility verified with Linux x64 CPU inference. Windows verification is separately recorded in the validation document/CI.

No model archive, audio samples or native binaries are committed. The downloader fetches only this hardcoded artifact. Manual import accepts the **same exact archive** and verifies the same size and hash; it is not a general-purpose model importer.

## Desktop integration contract

`server/src/asr/xasrManager.ts` exports `XAsrModelManager`, which also implements the existing `AsrProvider` interface. It does not start Fastify or import the database. The desktop main process owns one manager for its lifetime:

```ts
const model = new XAsrModelManager({
  root: path.join(app.getPath('userData'), 'models'),
  // Electron net.fetch may be passed here to honor OS proxy settings.
  fetch: net.fetch,
});
model.on('status', status => sendToTrustedRenderer('xasr:status', status));
await model.download(); // also validates, installs and initializes
// Alternatively: await model.importArchive(pathFromNativeFilePicker);
```

Bind narrow IPC methods for `getStatus`, `download`, `cancel`, `importArchive`, `repair` and `initialize`. The renderer must not supply arbitrary URLs, filesystem destinations, provider implementations or fetch functions. Resolve the import path using the **native file picker** in the trusted main process. Validate IPC sender/frame, allow only the app's own content, keep Node integration disabled and context isolation enabled. Disable repeated install actions while the returned promise is pending. Throttle progress rendering if needed.

Display `downloadedBytes`, `totalBytes`, and their ratio. The UI can label the action **Download Free Speech Model**. Cancellation rejects the operation promise and retains the partial file; Retry calls `download()` again. Handle rejected promises, including cancellation, without claiming success. Import/extraction can take time after bytes reach 100%; wait for Installed → Loading → Ready.

### State meaning

| State | Meaning |
| --- | --- |
| `not-installed` | Required files absent; no loaded recognizer |
| `downloading` | Download, verification or extraction in progress; bytes can already be 100% |
| `download-failed` | Download/integrity/extraction failed; Retry is available |
| `installed` | Required regular files exist; native engine has not loaded, or its session has ended |
| `loading` | Native inference process is constructing a recognizer and stream |
| `ready` | Native process confirmed successful recognizer **and stream** creation; it remains loaded |
| `error` | Import or native load/session failed; detail describes failure |

A fresh process reports Installed for existing files, never Ready. `initialize()` really loads the model. The loaded connection is reused for the next recording, avoiding a second native model copy. Clean session completion returns to Installed; initialize again for the next recording. A failed initialization may be retried after repair. `dispose()` cancels work and closes the native process. No file-only readiness badge or synthetic transcription is used.

### Recording

```ts
const connection = await model.connect(
  { sampleRate: 16000, languageHints: ['zh', 'en'], terms: [] },
  { onResult: showAndPersistActualResult, onClosed: handleSessionClosure },
  abortSignal,
);
// Feed little-endian mono PCM16. Existing MicCapture emits 100 ms / 3,200-byte frames.
connection.sendAudio(pcmBuffer);
const flushed = await connection.finish(8000);
// Report a gap/error if false; never report an incomplete transcript as successfully flushed.
```

Reuse `web/src/audio/capture.ts` and `/pcm-worklet.js` for genuine `getUserMedia` input/resampling. The native provider converts PCM16 to float locally, emits interim/final results with stable per-session keys and millisecond timestamps, performs endpoint detection and flushes with tail padding excluded from timestamps. Long input packets are decoded in 100 ms increments. Existing pipeline replay, deduplication and storage contracts are preserved. Speaker attribution and hotword biasing are not implemented by this adapter; `terms`/context do not alter decoding.

Inference runs in a **child process**. Unlike PR #3's worker thread, this contains native exits/aborts and releases native model allocations when the process exits. IPC audio backlog is capped at 30 seconds. Overload, invalid PCM, load failure, process exit and flush timeout fail explicitly so the existing pipeline can record/recover gaps. There is one local recognizer session per manager; concurrent recording attempts are rejected. Tail padding is used only for flushing, never recorded as additional interview time.

## Installation safety and recovery

Installation defaults to `%LOCALAPPDATA%/Meetfolio/models` on Windows, `~/Library/Application Support/Meetfolio/models` on macOS and `$XDG_DATA_HOME/Meetfolio/models` (or `~/.local/share/Meetfolio/models`) on Linux. The desktop host should pass its actual application-data path explicitly. Model files are outside the read-only application bundle.

The downloader streams to a private `.part` file. Range responses must describe the exact expected offset and total; HTTP 200 on retry truncates/restarts safely. The full archive size and SHA-256 must match before extraction. Interrupted body writes retain completed bytes; a checksum mismatch discards the damaged partial so the next retry starts cleanly. Never extract an incomplete archive.

Extraction uses streaming bzip2/tar parsers, bounded entry counts and uncompressed size, and a fresh staging directory. It rejects absolute/traversal paths, backslashes, Windows drives/device names/trailing-space aliases, duplicate entries, links, devices and special files. It preserves ordinary source/readme/sample files without executing them. The required exact filenames are checked before atomic directory rename. Failure/cancellation before promotion removes staging content and preserves an existing model. Explicit `repair()` re-downloads the pinned archive; `importArchive(file, { repair: true })` repairs from the same verified local archive. Existing model files are moved to a temporary sibling backup only after extraction/validation. A failed promotion restores that backup. Native finish waits for child exit before model files are replaced, including on Windows.

A cross-process `proper-lockfile@4.1.2` lock prevents competing writers. It updates a heartbeat every 10 seconds; after a process dies, retry can reclaim the lock once 30 seconds have elapsed without a heartbeat. An active/compromised lock prevents installation or cancels the current operation. A legacy nonempty `.xasr-install-lock` left by the initial experimental checkpoint may require manual removal **with all instances closed**. Never delete a live installer's lock.

Abandoned `.xasr-stage-*`, `*.import`, or `.xasr-previous-*` backup directories can remain after an OS kill. If a kill happens between the two repair renames, the previous model is preserved in the backup; restore it with all instances closed or run repair again. Automated repair-journal replay is not implemented. Repair touches only the configured model directory, never notebook/interview data. Retain `.part` files to resume interrupted downloads.

Runtime/model validation does not promise interview accuracy. Model corruption after installation is caught when native loading fails, but successful construction alone is not an accuracy benchmark. Missing native dependencies produce Error; the package build check must prevent shipping a desktop installer without them.

## Developer tools and tests

These are developer/CI commands; end users will use the desktop controls and bundled runtime:

```bash
npm ci --include=optional
npm run build -w server
node server/scripts/check-xasr-runtime.mjs
# Optional X_ASR_DATA_ROOT selects a disposable application-data root.
node server/dist/scripts/xasr.js download
node server/dist/scripts/xasr.js repair
node server/dist/scripts/xasr.js import /path/to/the/pinned/archive.tar.bz2
node server/scripts/verify-xasr.mjs /path/to/archive.tar.bz2 /path/to/empty-test-root report.json
```

The normal web/server compatibility bridge selects `ASR_PROVIDER=local-xasr` and optional `X_ASR_MODEL_DIR`. This selection never falls back to paid ASR or synthetic results. `/api/config` includes the manager's `localAsr` state; existing cloud configuration defaults are unchanged. Installation is not exposed through a public HTTP endpoint. Build the server before starting a local provider in the `tsx` development host, because its native child executes the compiled `.js` entry point (production runs compiled files directly).

Tests distinguish injected native/transport doubles from real model verification. See [validation evidence and blockers](xasr-validation.md), [Windows packaging](windows-xasr-packaging.md), and [third-party notices](third-party/xasr-notices.md).
