# Phase 5 — desktop preview distribution

Baseline is Phase 4.1 / Draft PR #6 at `9f08dc9cf1b36c1ecd38488159e4fe256e7b9c40`. Version is **0.2.0-preview.1**, an incremental reconstruction preview, not the original v0.6.0 release. Existing branches/PRs are preserved; no automatic merge or public release is authorized.

## Build and identity

Windows x64 uses NSIS. macOS arm64 and x64 build natively on `macos-15` and `macos-15-intel`; each job asserts the actual Node/OS architecture before building. No Rosetta or Windows cross compilation substitutes for Mac testing. Native Sherpa 1.13.8 packages are staged for that exact host architecture. `afterPack` checks the module and adjacent DLL/dylib files outside ASAR. The native macOS decoder is compiled with Swift/Xcode on the same Runner. macOS minimum declared version is 15; older versions are outside this preview's acceptance.

The app is **Meetfolio Preview**, executable **MeetfolioPreview**, bundle/AppUserModel ID `org.meetfolio.desktop.preview`. Preview user data is separate from the original Meetfolio directory on every platform. This intentionally does not migrate old audio ownership or implement full backup. `--verification` retains its existing private-profile override and does not participate in ordinary startup.

Build commands after the exact Node version in `.nvmrc` and `npm ci --include=optional`:

```text
npm run verify
npm run test:native-runtime
npm run package:win
npm run package:mac
```

Run the platform package command on that actual platform/architecture. Output is under ignored `work/phase5/packages`; verified distributable copies and SHA-256 lists are under `work/phase5/downloads/<platform>-<arch>`. `preview-artifacts.mjs` accepts only the expected version/platform filenames after prior workflow checks pass. No models, recordings, notebooks, diagnostic profiles or historical compiled references enter downloadable artifacts.

## Audio compatibility

Windows preserves the optional pinned Gyan FFmpeg download/offline ZIP mechanism and GPL notices. FFmpeg remains absent from installers. macOS does not execute or download the Windows binary: `desktop/native/AudioDecoder.swift` uses AVAudioFile/AVAudioConverter to stream mono PCM16/16 kHz from local WAV/MP3/M4A files. Its fixed CLI rejects unsupported inputs, non-regular files, excessive input size/duration and conversion errors. The host retains disk backpressure, decoded-sample limits, immutable WAV ownership, two-minute inference checkpoints and all existing editing/export behavior. No HTTP audio source is accepted by this helper.

The macOS helper's architecture/version and local code signature are verified before use. This is integrity checking of a bundled preview binary, not proof of publisher identity. macOS system codec behavior is verified with generated 44.1/48 kHz stereo tones and actual public speech. A test-only `ffmpeg` on the Runner encodes public compressed fixtures; it is neither bundled nor required by macOS users.

## Signing and system protection

Windows binaries are explicitly unsigned. Mac apps use ad-hoc signatures and a JIT-only entitlement, without adding a disable-library-validation or unsigned-executable-memory exception. This **ad-hoc preview does not enable Hardened Runtime**: the pinned packager warns that combining ad-hoc identity with hardening requires relaxing library validation. We do not add that exception or pretend this is production hardening. Future Developer ID builds must sign all nested code with the same team, enable hardened runtime and pass notarization. All nested native binaries and bundle signatures must verify in the Mac install check. No Apple Developer ID or notarization is claimed; no credentials are installed or requested by this workflow. DMG signing is absent. See the [Chinese installation/acceptance guide](PHASE5_INSTALL.zh-CN.md).

Do not disable Gatekeeper, quarantine, SIP, antivirus, UAC or other system/organization protections to make these tests pass. Runner startup without browser quarantine is not downloaded-app Gatekeeper acceptance. Developer ID signing/notarization is a separate credentialed release step; this phase ships only review candidates and records the limitation.

## Verification and distribution gates

The existing five CI jobs remain. Two native Mac jobs are added to the same PR workflow, with independent matrix failure reporting. Triggers remain unrestricted `pull_request` and main-only `push`, so one feature milestone push followed by one Draft PR creation should cause one workflow with seven jobs. No release publishing workflow or write-token permissions are added.

- Windows: actual per-user NSIS installation into a new task directory, normal visible startup in a fresh Preview profile, installed model download/hash/native loading, actual offline import/diarization/edit/playback/export/resume, real uninstall and retained-data sentinel. An existing Preview installation/profile blocks this fresh-install test rather than being overwritten. The original Meetfolio executable name/profile/registration is distinct. Interactive wizard/UAC acceptance and physical devices remain manual.
- macOS: native build, actual DMG mount/read-only copy via `ditto`, nested code signature and Mach-O architecture verification, normal visible launch, actual packaged model download/load, isolated sandbox/preload startup, exact playback guards, source two-hour and copied-App short checkpoint restart, native WAV/MP3/M4A bilingual speech/voice/edit/export flows, and removal of only the test App copy with profile retention. File import tests do not bypass TCC or claim real microphone access.
- Public/generated fixtures only. No WER/CER/DER or physical audio acceptance is inferred. All previous limits on forced word alignment, overlaps, 120-minute dense real interviews and JSON excluding WAVs remain.

Only a platform job that completes its verification prepares/uploads its download directory. Platform failures remain failures; another successful platform can still be delivered with an explicit partial result. Status-only artifacts remain separate. Native installer archives and checksums have 30-day Actions retention and normally require GitHub login.

The final Draft Release is prepared from verified downloadable artifacts for an exact head SHA, with binary checksums, version, installation guide and build manifest. It stays **draft** and **prerelease**, without public publication, auto-merge or deployment. Draft assets are visible only to authorized repository users; Actions links are the immediate review downloads. Final architecture/platform test results, SHA, workflow/artifact links and release-operation counts belong in the Draft PR delivery record. Do not infer test success merely from the presence of an EXE/DMG/ZIP.
