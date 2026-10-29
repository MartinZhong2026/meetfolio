# Meetfolio Desktop v0.1.0 integration

Independent integration branch: `feat/desktop-v0.1.0-integration`.

- Desktop foundation: PR #4, `e61dd2a5a977900a086e56aa3b49fcbf673d3924`.
- Native foundation: PR #5, `dbe5a5002b7a39d833d051fb3af11fe45cd3bafe`.
- PR #2 inspected at `41507584a34397766856f323876efcad1a248639`; its release audit remains relevant. PR #3 is superseded and was not copied again.
- Original branches remain unchanged; no GitHub PR is merged or release published.

The integration connects the existing desktop notebook to an Electron host with context isolation, sandboxed preload, own-frame validated IPC, verified native model management, bounded unconfirmed-audio replay, real microphone capture and ephemeral partials. The model, compiled inference process and its exact native dependencies are staged as real files outside ASAR. RunAsNode remains required by the forked engine.

Commands: `npm ci --include=optional`, `npm exec -w desktop -- install-electron` (Electron 45 explicitly installs its binary), `npm run build:electron`, `npm run electron`, `npm run package:win`. Dependencies are locked. `npm run test:native-desktop` exercises IPC policy and replay with an injected provider. Build on Windows x64 using Node.js 22.12 or newer for the desktop development tools. End users install the candidate executable and run no npm commands.

Default desktop operation needs no server, login, DB or cloud key. Model/user data use the app's writable data directory and stable `meetfolio://app` origin, outside installation binaries. Windows uses `%LOCALAPPDATA%/Meetfolio`. Optional third-party AI is informational in v0.1.0: no keys are collected and no interview text is transmitted.

## Verified packaged application checkpoint

The Linux **packaged application**, not just a dev server or Node smoke, passed real X-ASR loading and file-backed microphone capture; partial/final native results; injected native child termination and replay; pause/resume/flush; notes and original-preserving corrections; timestamp monotonicity/non-overlap; TXT/Markdown/DOCX content checks; and shutdown while actively recording/restart including an immediately typed unsaved draft and explicit interrupted state. Linux verification required `--no-sandbox` in the execution container; renderer Node isolation and sandbox preferences were checked, but this does not prove Linux OS-level sandboxing. Windows verification does not use that switch.

[Packaged Linux report](verification/desktop-v010/packaged-linux.json). Actual UI screenshots with public model speech and fictional participant metadata:

- [Preparation, 1366×768](desktop-v010-screenshots/prepare-1366.png)
- [Live interview, 1366×768](desktop-v010-screenshots/live-1366.png)
- [Live interview, 1920×1080](desktop-v010-screenshots/live-1920.png)
- [Review/export, 1920×1080](desktop-v010-screenshots/review-1920.png)

Preserved suites passed: **119 server + 29 web + 6 desktop host unit tests**, **10 desktop UI tests** including offline reload, storage failure/retry, backup restoration, evidence navigation, exports and mocked native permissions/revocation. Mock tests remain labeled; real packaged inference is separately reported. Source headlines/selectors were updated together for the requested compact wording.

## Windows candidate verification

`Windows desktop installer` CI builds a real NSIS x64 candidate, installs it into a Unicode path, and launches the installed executable. It checks locked native resources outside ASAR, actual model download/cancel/resume/import/repair, native initialization, file-backed microphone input, partial/final recognition, replay after child termination, persistence, exports and app restart. It blocks outbound network access for the installed program during transcription, then reinstalls the candidate over the same binaries and verifies retained notebook/model/drafts. Application PATH excludes Node/Python/Docker/PostgreSQL developer tools; the harness still uses Node externally to drive assertions.

The first installed-app run caught missing resource dependencies; explicit `node_modules` resource copying and `check-pack.cjs` now fail packaging if required files are absent. A subsequent Windows run exposed an overly early OS microphone-status gate; Windows/Linux now report permission only after actual `getUserMedia` success. The full installed-app and reinstall scenarios **passed** at `dcb6e9813e9aa1676501bcdc28c15f15c3a50cf2` in [Windows run 40076211817](https://github.com/MartinZhong2003/meetfolio/actions/runs/40076211817). Reports: [installed Windows application](verification/desktop-v010/installed-windows.json), [after reinstall](verification/desktop-v010/after-reinstall-windows.json). General CI (including all 33 main browser tests and 10 desktop browser tests) and Windows/Linux native smoke also passed for that source checkpoint. The additional active-recording-close assertion is tracked by subsequent Windows CI. No physical microphone or 60–90 minute interview qualification has been performed.

The [verified Windows x64 candidate artifact](https://github.com/MartinZhong2003/meetfolio/actions/runs/40076211817/artifacts/12553267996) contains `Meetfolio-0.1.0-windows-x64-setup.exe`, `installer-sha256.txt`, actual Windows screenshots, installed/reinstall reports and staged native dependency versions. GitHub authentication may be required. Artifact retention is 14 days (this checkpoint expires 2026-11-07); rebuild from the locked source when expired. Its artifact **ZIP** SHA-256 is `d5d47669d7250629eaddbba0c3050b919f208daa839e7a8b394148db52808222`; use the included checksum file for the distinct installer executable hash.

The installer is **unsigned, for review/testing**, and is uploaded only as a GitHub Actions artifact. No GitHub Release, automatic rollout, deployment or PR merge is performed. A same-version reinstall/persistence test does not establish compatibility with every future schema/version; the IndexedDB schema and stable application origin/profile are preserved in v0.1.0. No auto-updater is enabled.

## Dependency and license review

The review considered the conservative 20-package browser dependency inventory (including prebundled DOCX dependencies), staged native packages, and Electron 45.0.0. The saved npm audit snapshot found **no listed advisories for those shipped desktop component names**. The full repository still reports **18 advisories** (2 critical, 5 high, 11 moderate) in backend/development dependencies; these are not all fixed by this integration. This is an audit snapshot, not a comprehensive security certification. [Dependency review](verification/desktop-v010/dependency-review.json).

PE import tables of the exact `sherpa-onnx-win-x64@1.13.8` DLLs/addon show only the bundled sherpa/ONNX libraries and Windows system DLLs; no external MSVC redistributable import was found in these particular binaries. [Hashes/import inventory](verification/desktop-v010/windows-native-imports.json). Clean-machine physical validation remains a release gate. Existing MIT/ISC browser notices, native Apache-2.0/ONNX MIT notices, package licenses, Electron and Chromium notices accompany the candidate. JSZip is used under its MIT option; no AGPL VoxMinutes source was used.

## Optional AI and release gates

No API keys are collected and no interview content is transmitted. Qwen, DeepSeek and compatible BYOK configuration is explicitly presented as optional/future. A future implementation must use main-process OS-protected key storage (never renderer localStorage), provider/HTTPS validation, a text preview and explicit per-request consent including third-party charges. It must not gate free transcription or introduce a maintainer backend.

Before public release: validate physical Windows microphones, 60–90 minute latency/memory/accuracy and sleep/device interruption, review hardware/OS coverage, signing/SmartScreen and final bundled licenses/advisories. Interrupted native sessions replay an in-memory unconfirmed suffix capped at 60 seconds; app/OS crashes preserve confirmed text/drafts, **not** a durable raw-audio recording. PR #4's explicit missing-audio warning remains meaningful. Model repair can preserve a `.xasr-previous-*` backup after an OS kill between directory switches; automated journal replay is not supplied.

## Physical hardware acceptance (not covered by CI)

A separate [Windows physical-microphone and long-interview acceptance guide](desktop-physical-acceptance.md) and privacy-minimal PowerShell process-health sampler are available for maintainer testing. They collect no voice content and do not confer release readiness automatically. They do **not** replace the genuine installed-app CI or claim that an actual physical microphone/60-minute interview has been verified.
