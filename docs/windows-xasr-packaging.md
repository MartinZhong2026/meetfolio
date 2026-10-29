# Windows X-ASR packaging contract

> Integration update: the historical PR #5 contract below is now implemented by the independent Electron integration in PR #6. A real NSIS x64 installer and its installed application passed native inference, offline file-backed capture, Unicode installation paths, restart and reinstall checks. See [current build commands, artifacts and remaining release gates](desktop-integration.md) and [actual installed Windows report](verification/desktop-v010/installed-windows.json). RunAsNode is enabled and verified in the packaged executable; the complete native tree is copied outside ASAR. Physical microphones, long interviews and public release approval remain separate gates.

This PR implements speech infrastructure and supplies checks/instructions. It does **not** build or publish an installer, choose/change the other session's desktop framework, or merge into that branch. Integrate only after the Desktop UI task has completed.

## Required resources

Pin and install dependencies on the **Windows x64 build host**, using the committed lockfile (`npm ci --include=optional`). Do not copy Linux node_modules into a Windows build and do not use `--omit=optional`. sherpa is optional for the existing cloud/web deployment, but **mandatory for a desktop distribution**. Fail packaging if `node server/scripts/check-xasr-runtime.mjs` fails on the target build host.

The official `sherpa-onnx-win-x64@1.13.8` npm archive was inspected directly. Bundle its entire directory, including:

- `sherpa-onnx.node`
- `sherpa-onnx-c-api.dll`
- `sherpa-onnx-cxx-api.dll`
- `onnxruntime.dll`
- `onnxruntime_providers_shared.dll`
- `index.js`, `package.json`, `README.md`

Bundle the complete `sherpa-onnx-node@1.13.8` JavaScript package alongside that platform directory. Both should retain their normal adjacent `node_modules` locations so upstream relative native loading works. Include the bzip2/tar JavaScript dependencies and transitive runtime packages from the lockfile; no external `tar`, Python, Git or npm executable is needed at runtime.

Include `server/dist/asr/localXasrWorker.js`, `localXasr.js`, `localXasrModel.js`, `xasrArchive.js`, `xasrManager.js`, and `types.js`, retaining their ESM relative paths and a `package.json` with `"type":"module"`. The package's manager can be imported without starting the web backend. Keep production bundlers from tree-shaking or rewriting the child entry URL or dynamic `createRequire('sherpa-onnx-node')` load. Mark native packages as external.

The child process executes with `process.execPath` and no inherited `execArgv`. With Electron, the provider sets `ELECTRON_RUN_AS_NODE=1`. This requires Electron's **RunAsNode fuse to remain enabled**. If the Desktop UI build disables that fuse, adapt the host to Electron `utilityProcess.fork` or a bundled Node helper before claiming compatibility; that adapter is not implemented here. Do not ask end users to install Node. Neither a packaged Electron fork nor a utilityProcess adapter has been validated by the local Linux checks.

Keep the native files and inference entry tree on the real filesystem, **outside ASAR**. A typical Electron packaging arrangement copies this small module/dependency subtree under `resources/xasr/` with `extraResources`, then the main process imports that unpacked tree. Alternatively unpack the entire subtree consistently with `asarUnpack`. Do not unpack only `.node` while leaving its adjacent DLLs inside ASAR. The precise electron-builder/Forge configuration belongs to the final desktop architecture; no conflicting desktop package configuration is introduced here.

## Install/data/upgrade behavior

Store the downloaded model under the desktop app's user-data directory, passed explicitly to `XAsrModelManager`. The installer ships runtime binaries and notices; the user's **Download Free Speech Model** action installs the 133.9 MB archive and loads it. The app must not auto-contact cloud ASR or request an API key. Use Electron's `net.fetch` transport adapter for OS proxy support if appropriate. End users run no development commands.

Keep model data across application upgrades, never write into Program Files or the application bundle, and close the manager on application quit. If uninstall offers to remove research data, handle that separately from model cleanup and require an explicit user choice. This PR does not add data deletion behavior.

The desktop bridge should send only copied PCM16 frames through a narrow preload API, validate sender/frame and input type/length, bind a session to its owning window, and persist final transcript events with the existing dedupe/timestamp semantics. Do not expose arbitrary child-process/filesystem operations. The existing model manager has no network listener or account requirement. Local transcript persistence and login-free navigation remain the desktop task's responsibility; no database migration is included.

## Target-machine release gates

Before publishing any installer, on a clean Windows 10/11 x64 machine without Python/Node/Docker/PostgreSQL:

1. Install and start as a standard user without registration. Validate native DLL loading, including any missing Microsoft Visual C++ runtime dependency. Inspect DLL imports with `dumpbin /dependents`; bundle a license-permitted Microsoft redistributable if required. This remains a Windows release gate.
2. Check package hashes/versions and required resource paths **in the installed application**, not just the build checkout. Validate Electron's ABI/Node-API compatibility and child startup with the chosen Electron version/fuses, Unicode/spaces in usernames, and antivirus restrictions.
3. Download, cancel, retry, resume after interruption; import the exact archive from removable media; test checksum failure, disk full/permissions and a process crash with a leftover lock. Ready must follow native recognizer and stream construction.
4. Unplug the network after installation. Use the actual microphone for Chinese/English speech, pauses, partials, final flush, continued interviews and export. Compare a separate ground-truth recording; check 60–90 minute CPU/memory use, sleep/resume and failure/gap handling.
5. Verify local persistence across restarts without login or database installation. Confirm optional paid AI remains disabled until explicitly configured by the user and recording/transcription remains free.
6. Include source licenses/notices and bundled runtime component notices. Audit the installer dependency tree, sign binaries/installer and test upgrades. Public distribution needs separate approval.

The `X-ASR native smoke` workflow runs real model import/load/sample recognition on Windows x64 and Linux. A Windows CI pass verifies native Node inference, **not** a physical microphone, packaged Electron startup, Windows installer behavior or long interviews. See the validation document for observed results rather than assuming these gates passed.

## Observed CI verification

The native smoke and interrupted-transfer/repair workflow **passed on Windows x64 and Ubuntu** for commit `0af42bc` in [run 40071826678](https://github.com/MartinZhong2003/meetfolio/actions/runs/40071826678). The Windows job checked the required DLLs, loaded the actual CPU runtime/model, recognized all four speech samples, repaired a damaged model, resumed an interrupted archive and used model paths with spaces/Chinese characters. Reports are linked in [xasr-validation.md](xasr-validation.md). This validates Node/native distribution inputs; the installed Electron application and physical hardware release gates above remain open.
