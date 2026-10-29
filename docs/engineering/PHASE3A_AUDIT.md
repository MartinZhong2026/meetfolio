# Phase 3A native runtime audit

Baseline: `72aee93f866d8efbd300e9248e0119fc2d1c789d`, 2026-10-29. This is the recovered v0.1 source baseline, not the official v0.6.0 source.

| Area | Evidence and classification |
| --- | --- |
| Main / preload / renderer | A: editable TypeScript. Main owns model processes and native file pickers; sandboxed preload owns capture and exposes a typed API; renderer owns notebook and interview UI. `contextIsolation`, `sandbox`, `webSecurity` are enabled, Node integration disabled. IPC checks main frame, sender and app origin; navigation/new windows are restricted. |
| Model lifecycle | A/B: pinned official GitHub archive, size and SHA-256 verification, bounded extraction, exclusive cache lock, staging/rollback, import/repair, and real engine initialization. Model files remain outside ASAR. Device validation is still required. |
| Inference | A/B: pinned `sherpa-onnx-node@1.13.8` and platform N-API binaries; a child process runs CPU inference, emits partial/final timestamps and caps queued audio at 30 seconds. Host replay is bounded at 60 seconds. No cloud fallback. |
| Capture | A/B: actual getUserMedia, AudioWorklet conversion to 16 kHz mono PCM16 and 100 ms frames. Permission failure and track-ended callbacks exist. Physical microphone evidence is absent for this phase. Device selection is missing. |
| Packaging | A/B: esbuild main/preload, runtime staging outside ASAR, NSIS per-user packaging and static resource checks. Electron executable was absent locally after dependency installation; platform Sherpa DLLs are present. No historical executable should be used to fill this gap. |
| Historical v0.5.1 | C: compiled evidence only; redistribution and license completeness require human review. It is not a trusted executable source and is excluded from the package recipe. |
| WAV / playback / desktop PDF | D: persistently recorded WAV and time-linked playback are not implemented in this tree and are outside Phase 3A. |

## Confirmed repair targets before editing

1. Main and preload have asynchronous start races before their active-session references are assigned.
2. Capture setup failures after opening getUserMedia can leave tracks/context alive; repeated start/stop needs explicit ownership and cleanup.
3. Worker startup/finish timeouts and queue-size limits exist, but a stalled worker can retain a small backlog indefinitely; IPC acknowledgement and child termination need bounded watchdogs.
4. Recovery can discard a still-live connection without closing it; repeated final events and start calls require explicit handling.
5. Diagnostics are mostly raw error strings/stderr, with no bounded, privacy-minimal structured host log. This must not record audio, transcript, arbitrary renderer data or filesystem paths by default.

## Verification boundaries

Injected unit tests and browser bridge tests are automation evidence only. A real Electron launch, actual native module import and file-backed test-audio inference can be checked separately in disposable profiles; none proves physical microphone acceptance. Windows 10/30-minute device checks remain `Not verified` until a person records actual results. See the Phase 3A acceptance checklist.

The six moderate dependency findings at the baseline affect React Router and Drizzle Kit's old esbuild dependency chain. The native desktop does not start the historical server, Drizzle tooling, or a public dev server. Keep test servers loopback-only; do not force upgrades or treat these findings as resolved. No release approval is implied.

## Implemented repairs and local evidence

- Added explicit start ownership in main and preload; capture now cleans up failed/pending initialization, cancels late streams, and stops native inference even if worklet cleanup fails.
- Fixed a sample-position carry bug that caused drift in 44.1/48 kHz resampling; synthetic 16/44.1/48 kHz frame-count tests now pass. Capture prefers Chromium's 16 kHz resampler. This is not a speech-accuracy benchmark or a certification of the fallback interpolation filter.
- Added a 15-second unacknowledged-audio watchdog, bounded child termination wait, fixed native error codes, closing old replay connections, duplicate-final/start protection, and finite timestamp checks.
- Installed caches now carry per-file digests created only after the pinned archive is verified. Loading checks those digests. Legacy caches without that metadata require explicit official import/repair; they are preserved and are not silently accepted as verified.
- Added private, fixed-code diagnostics with two 128 KiB files and at most 64 queued writes; no transcript/audio/error-string payloads. The metadata detects accidental cache damage, not malicious changes by the same Windows account.
- Windows Node 22 loaded `sherpa-onnx-node@1.13.8` and its DLLs. Real Electron 45 started with actual preload, sandbox/context isolation, secure protocol and no renderer Node access in an isolated profile. Four public mixed Chinese/English WAV samples passed native inference fragment/timestamp/partial checks, including corrupt-model failure and recovery. Electron file-backed capture produced rendered segments and survived pause/normal restart with its cache. This is not a physical microphone test, a 30-second monolingual test, or long-session acceptance.
- An unsigned NSIS review installer built successfully and its staged resources/ASAR passed static checks. The installer was not installed; no historical executable or model cache is included in its payload.
- The unpacked packaged Windows EXE also passed the actual Electron fixture workflow: native resource import, second-instance exit, file-backed capture/inference, pause/resume/final stop and restart cache/notebook persistence. Electron HTTP/WebSocket requests were blocked and no such network request was observed. This is not an OS-wide offline test. Generated reports remain in ignored `work/phase3a/`.

Generated evidence, model and public test audio stay under ignored `work/phase3a/`; they are not source files or a release. Repeat the native/packaging checks after further changes, and use the exact PR head's CI before declaring code/CI acceptance.

Security reference: [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security); model source: [official Sherpa ASR releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models).
