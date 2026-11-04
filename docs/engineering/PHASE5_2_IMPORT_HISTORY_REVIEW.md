# Phase 5.2 — Import speed choices, history discovery, separate exports

## Scope and rationale

This feature-branch patch responds to three real-use observations: long English audio processing, missing/hidden history, and inability to export two imported recordings separately.

### Existing behaviour verified in code

- Previous UI defaulted `diarize=true`, so imports executed both speech recognition and optional CPU speaker diarization.
- `openImport` reused the active non-demo interview, and `appendImportedTranscript` appended segments to that interview. Native WAVs still had distinct `audio.recordingId` values, but the only visible transcript export was the whole interview.
- Sidebar recents had a small fixed-height scrolling area and no dedicated library view.
- WAV export was available in Model & Settings → Local storage, not alongside transcript export.

### New behaviour

- New imports from a populated interview create a fresh local notebook interview before starting audio work. Empty drafts remain usable; existing records and audio files are untouched. The imported filename becomes the interview title on successful completion.
- My interviews opens a dedicated searchable history with title, date, segment count and number of linked audio recordings. Opening a record returns to its own stage and transcript.
- Review & export offers per-recording TXT, MD and DOCX buttons grouped by original `audio.recordingId` (including older combined interviews). Each per-recording export contains only matching ASR segments; timestamps use source-file-relative positions. Notes, reference materials and manual unlinked segments are retained in the whole-interview export only. Per-recording output filenames include full source IDs to avoid overwriting adjacent exports.
- When the native recording export method is available, Review & export offers WAV output beside the same source ID. This does not delete WAVs or mutate interview records.
- Speaker separation is **opt-in**, not the default. With it off, the existing recognizer runs without the extra diarization/embedding stage; speakers will not be auto-labelled. This is a lower-compute choice, **not a measured speed guarantee** and does not modify recognition model threading or decoding parameters.
- Existing import checkpoints and older combined notebook records remain compatible. Imports previously saved together can still be reviewed and exported independently by source identity.

### Limits

- This change does **not** benchmark 36-minute English audio or guarantee a target wall-clock time. To diagnose a remaining bottleneck, profile decode, speaker separation and speech recognition phases separately on the affected CPU.
- Legacy recordings without a valid stored `audio.recordingId` cannot be automatically attributed to a WAV; they remain in whole-interview exports.
- The UI does not retroactively recover original filenames for old combined recordings when the notebook lacks that mapping; recording ID prefixes distinguish files.
- JSON backup still excludes WAV bytes; maintain separate secure backups.
- New browser regression tests use mock/fixture inputs. The previous 30 passing Playwright tests predate these changes and do not establish this patch's correctness.

### Local validation, without GitHub Actions

```powershell
cd D:\GitHub\meetfolio
git status -sb
git pull --ff-only origin feat/phase5-1-ux-cleanup-no-auto-ci
npm run build:desktop
npm run test:desktop
npm run verify
```

Check both old mixed interviews and two new separate real-world imports without deleting prior local data. Measure a comparable audio file with and without speaker separation if the user is willing to trade labels for processing speed. Do not publish a new installer or merge until explicitly approved.
