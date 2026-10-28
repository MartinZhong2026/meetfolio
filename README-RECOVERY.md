# Meetfolio source recovery — stage 1 (NOT v0.6.0)

> This is an incremental reconstruction from the user-supplied **v0.1-era** source archive, not an authenticated copy of the released v0.6.0 code. Its version remains 0.1.0 deliberately. Read `RECOVERY_GAP_REPORT.md` before building.

## Restored in this stage

- English-first Desktop Lite interview interface and an English fictional demo.
- Explicit removal of the old optional-AI sales/configuration panel from the local desktop interface; the old historical server sources are preserved unchanged.
- Backwards-compatible local TXT/Markdown reference files (8 per interview, 6 MB/file, 100,000 characters/file), with notebook backup validation, display in the interview guide and provenance labeling on export.
- Search across local interviews' topics, participants, segments, notes and reference filenames.
- Kept existing local offline X-ASR Electron integration, microphone permissions, human transcript correction, notebook IndexedDB persistence, local backups and TXT/Markdown/DOCX export.

## Missing before matching v0.6.0

**Native audio:** WAV recording, per-segment replay, native audio recovery and microphone device selection are *not* restored. **Documents:** PDF/DOCX native extraction and PDF print/export are *not* restored. **Platform:** macOS Intel/Apple Silicon native package targets and verification are *not* restored. **QA:** full automated builds, live microphone ASR and external UAT are *not* verified because npm dependencies could not be installed in the recovery environment.

It would be misleading to rename this ZIP `Meetfolio v0.6.0` or promise drop-in production compatibility. Do not publish or use for sensitive research until native recording, persistence, resource bounds and long-session behavior are tested.

## Run / verify on a development machine

From repo root using Node.js 22:

```sh
npm ci
npm run typecheck
npm test
npm run build:desktop
npm run desktop
# browser preview: http://127.0.0.1:4175
```

The browser preview cannot access the native X-ASR runtime. For actual Windows/Electron acceptance, build with `npm run build:electron`, package using the repository's existing Windows scripts, then verify a real microphone and installer. Do not mistake a browser preview for a functional offline transcription test.

## Recovery provenance

Source archive: `meetfolio_2e0bbdd_continued_modified_source(3).zip` (provided by user). No `.git` history was present, so the original branches/tags cannot be recovered from this copy. The original code is not overwritten in the uploaded ZIP; this generated archive is a separate modified working tree. Generated changes were syntactically parsed using TypeScript transpile diagnostics and tested for schema roundtripping separately; see `RECOVERY_GAP_REPORT.md` and `RECOVERY_VERIFICATION.json`.
