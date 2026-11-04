# Phase 5.3 — Speaker label correction in offline imported interviews

## Problem verified in code

Long recordings are split into at most two-minute windows (`IMPORT_WINDOW_SAMPLES`).
Automatic diarization clusters voices separately in each window. The worker then uses an embedding similarity threshold of 0.55 to connect each window's detected voices to existing interview-wide labels; if no existing label reaches that score, it creates another label, up to 12 in automatic mode. As a consequence, one human can appear as multiple `Speaker N` labels. The label count is not a factual count of people. Distorted/reverberant microphone input, short turns and changing voice conditions can aggravate this.

The importer already supported `Expected speakers` with a fixed positive count. The worker caps global voice labels at that count. That limits the number of distinct labels but does **not** prove they are assigned correctly. For long recordings it intentionally does not force a fixed number of clusters **inside every two-minute window** because a given window can contain fewer speakers than the whole interview.

## Safe corrections shipped in this branch

- Import instructions now explicitly tell users to choose `2 speakers` when a recording is known to contain two people, rather than `Detect automatically`. Automatic speaker separation itself remains opt-in because it is expensive.
- Review → Speakers lists **detected labels**, not asserted people. Unlabeled turns are no longer counted as an additional detected speaker.
- Review → Speakers → `Merge` lets the researcher choose one known-duplicate label, select a target label, preview the global turn count, and confirm the merge. It changes only `speakerLabel` and `updatedAt` for matching segments; transcript words, original edits, source recording IDs, timestamps and WAVs are untouched. The operation is not automatically reversible; advise users to export a JSON backup before bulk changes.
- Review still allows individual-turn corrections and rename. **No code automatically guesses which two of eight existing labels match**; this must be checked by listening to real audio.

## Limits / future scientific evaluation

No benchmark or ground-truth two-person audio was available in this repository change. This is a safe UI/data-editing fix, **not** a claim of improved underlying diarization accuracy. To validate a future engine modification, evaluate fixed-count and automatic modes on labeled 2-, 3- and 4-speaker long recordings; measure diarization error rate (DER), speaker-count accuracy, overlap and short-turn sensitivity, runtime, and cross-window identity stability. Do not change thresholds, clustering or threading without those fixtures and reproducible metrics.

## Local verification (keep GitHub Actions manual-only)

```powershell
cd D:\GitHub\meetfolio
git status -sb
git pull --ff-only origin feat/phase5-1-ux-cleanup-no-auto-ci
npm run build:desktop
npm run test:desktop
npm run verify
```

Manually test an existing long real recording: export JSON backup first; select a misidentified label, audition several turns, merge into the correct label, confirm speaker count decreases, reload, and verify timestamped text and WAV playback remain intact.
