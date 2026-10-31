# Phase 4 — offline audio import and research workspace

This remains a reconstruction, not an accepted v0.6.0 release. Baseline: `de53a8923f1576f1aecb67b576854406c7ff6f31`, branch `feat/phase3b2-segment-playback`, Draft PR #4. That branch and its existing commits remain unchanged and provide the visual/functional rollback reference. Work is isolated in `feat/phase4-audio-research-workspace`, stacked on the baseline.

## Implemented workflow

Choose **Import audio** or **Import recording**, select/drop a WAV, MP3 or M4A, confirm processing permission, and transcribe locally. The installed native application is required. The browser preview accurately disables native actions.

- File limit: 64 MiB, 20 minutes, mono/stereo. Chromium first checks media metadata, then WebAudio decodes/resamples to 16 kHz; frames are downmixed and converted to PCM16. Codec availability can vary by platform; a PCM WAV is the fallback for unsupported/corrupt files. The full decoder buffer lives in renderer memory: these limits are a product guard, not a hard sandbox against malicious codec inputs.
- Frames cross an allowlisted, trusted-main-frame IPC contract in at most one-second packets. Each write is acknowledged before another is sent, preserving the existing bounded live-capture queue. Host also enforces duration, packet size, interview identity and consent.
- A new immutable local WAV is finalized before inference. The original selected file is read-only and is not copied as a compressed original; retain it separately. Imported WAVs use the existing recording catalog, ownership checks, export and segment playback capabilities.
- An isolated child runs the existing pinned X-ASR recognizer and optional speaker diarization. No HTTP server, cloud provider, database or paid API participates. Cancellation, window lifecycle changes and shutdown terminate inference and retain any saved audio. The child exits if its host disconnects.
- Speaker diarization runs first, then ASR on each speaker turn. Endpoint segments are linked to exact sample ranges in the normalized WAV. These are **turn/endpoint timestamps, not forced-aligned word timestamps**; short turns, speech boundaries, music, noise and overlaps require listening and review.
- Both automatic speaker-count detection and a specified count (1–12) are supported. Automatic clustering uses the documented ERes2Net example threshold of 0.9; the initial generic 0.5 setting over-separated the public fixture into seven voices and was corrected. This is not evidence of general diarization accuracy. `Speaker N` denotes a cluster within one recording; it does not identify a person. Repeated imports into an interview receive separate voice labels so unrelated cluster numbers are not treated as the same person.
- Completed import transcripts are also persisted in a bounded native sidecar. **Local storage & backup info → Recover import text** adds missing segment IDs without replacing existing text or speaker corrections. Failed/cancelled imports retain their saved WAV; export and re-import it to retry recognition. Interrupted partial files use the existing explicit audio-recovery controls.

## Workspace changes

The left rail now exposes recording import directly alongside interviews and research references. Preparation includes a source choice and retains interview details, consent and the interview guide. The live guide/transcript/notes columns remain available.

Review is a transcript-centered desk with a fixed playback area and export controls, independently scrolling transcript and research inspector, full-text search, speaker filtering and important-segment filtering. A source citation clears filters and focuses its transcript entry. The inspector contains speaker management, evidence excerpts and manual research notes. Rename a speaker throughout the interview, or correct one turn by selecting its speaker name. Text edits retain originals and audio identities. Existing TXT/Markdown/DOCX and JSON exports include corrected speaker labels; document/JSON exports do not contain audio.

The visual system uses neutral paper-like surfaces, restrained green accents, compact navigation, consistent controls, visible focus and readable contrast. Desktop and narrow layouts retain the same source and editing flows. UI copy no longer reports already-restored recording/playback as missing.

## Engine decision and model provenance

Reuse `sherpa-onnx-node@1.13.8` and the existing checksum-verified bilingual X-ASR model to preserve Windows packaging and the live-recognition pipeline. No production dependency or lockfile change is needed.

For speaker separation, use the official [Sherpa diarization API](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/javascript.html) and [model documentation](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html): Pyannote segmentation 3.0 INT8 plus 3D-Speaker ERes2Net embeddings. The user explicitly downloads them once (~45 MB) or imports a folder containing `model.int8.onnx` and `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`. Both paths copy verified weights into the local profile; hashes are rechecked before inference. No automatic model download occurs on app startup. No weights are committed or bundled in the installer.

| Asset | SHA-256 |
| --- | --- |
| Official segmentation tar.bz2 | `24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488` |
| Segmentation `model.int8.onnx` | `d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d` |
| 3D-Speaker embedding ONNX | `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b` |

The downloaded segmentation archive includes the MIT license, Copyright (c) 2022 CNRS; a copy is preserved in `docs/third-party/pyannote-segmentation-LICENSE`. [3D-Speaker](https://github.com/modelscope/3D-Speaker) is Apache-2.0. See `docs/third-party/speaker-models-notices.md`. Model redistribution remains separate from this development PR; do not infer product release approval from these tests.

Alternatives considered: [SenseVoice](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html) provides an additional multilingual offline ASR path but still needs separate diarization and a new model lifecycle. [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and [faster-whisper](https://github.com/SYSTRAN/faster-whisper) are mature offline alternatives; adopting either would add a second runtime/packaging path and still require evaluated speaker separation. This milestone reuses the installed runtime. No claim of superior WER/CER or diarization error rate is made without a labeled, consented Chinese/English/mixed interview corpus and target hardware benchmark.

## Validation and scope of evidence

Run Node `22.23.4`, `npm run verify`, `npm run test:native-runtime`, `npm run test:desktop` and `npm audit --audit-level=high`. Database and historical browser suites use the exact disposable-database guards in `CODEX_WORKFLOW.md`.

Actual Electron import validation:

```powershell
npm run build:electron
node desktop/scripts/prepare-native-fixture.mjs
node desktop/scripts/prepare-import-fixture.mjs
$fixture = Get-Content -Raw work/phase4/ci-fixture/fixture.json | ConvertFrom-Json
node desktop/scripts/import-smoke.mjs --audio $fixture.audio --speakers $fixture.speakers
```

The fixture is a checksum-verified public ~57-second Chinese four-speaker WAV from Sherpa. The native smoke checks decoding, speaker-model verification/invalid-cache preservation, four voice clusters (specified count or `--automatic`), native ASR, linked playback, edits, reload, sidecar recovery and cancellation with Electron HTTP/WebSocket requests blocked. `--mp3` / `--m4a` can additionally validate local codec fixtures. Supplying a native dialog response in tests does not mock the bridge, model loading, inference, storage or playback. The fixture reports processing time and real-time factor for this machine; they are not general performance guarantees.

Local Windows / Node 22.23.4 results: `npm run verify` passed; final follow-up Desktop unit tests **54/54**, Web unit tests **47/47**, native-runtime tests **30/30**, Desktop browser **18/18**, isolated PostgreSQL 16 Server **125/125 twice**, historical Web E2E **33/33**. `npm audit --audit-level=high` passed with **22 moderate** findings; no dependency changes or forced audit fixes were made. The source native capture/forced-exit recovery and generated-tone playback regressions passed. Actual WAV/MP3/M4A import and four-speaker inference passed for source and unpacked EXE, including automatic count, edits, reload, cancellation, invalid-cache preservation and text recovery with zero Electron network requests. Automatic-mode processing of the 56.86-second fixture varied from 14.83 seconds (RTF 0.26) to 148.41 seconds (RTF 2.61) under concurrent local load; the packaged run took 61.82 seconds (RTF 1.09). A concurrent browser screenshot suite hit its unchanged 45-second timeout (17/18 passed); the complete isolated follow-up passed **18/18 in 46.3 seconds** without changing timeouts/assertions. These are load-dependent observations, not general performance or accuracy benchmarks. Unsigned NSIS build/static resource checks passed; installation was not performed. Source and unpacked EXE evidence reports and review screenshots are kept in ignored `work/phase4/`.

CI retains all five jobs and existing triggers/concurrency. Windows Native additionally prepares public speaker fixtures and validates source plus unpacked-EXE import. Artifacts include status reports only, never recordings, notebook text, model weights or screenshots. One Draft PR opened on the new branch should cause one `pull_request: opened` workflow and zero feature-branch push workflows. Final head SHA, actual runs/counts and results are reported in the PR.

Earlier local checks exposed low-contrast small text and speaker-button accessible-name mismatches; both were corrected without relaxing accessibility assertions. A hidden-window Playwright screenshot timed out after native functional checks passed; screenshots for review are captured from the actual desktop UI build in Chromium, while native inference evidence remains separate.

Physical microphone/speaker behavior, OS-level offline mode, long sessions, representative bilingual/mixed accuracy, difficult overlaps, macOS/Linux codec/native acceptance and installer installation/uninstallation remain separate acceptance work. The unsigned installer is a review build; no merge, production deployment or release is authorized by this PR. JSON/WAV combined backup, encrypted storage and PDF/DOCX reference extraction remain outside this milestone. There is no database migration or production configuration change.
