# Phase 5.1 — Local UX improvements (review only, automatic CI off on this branch)

Base: `feat/phase5-desktop-release` / Draft PR #7 at `7c2e4e90e2349364cd4d0bd359bb63cd24144ad9`.

## User-visible improvements

- **Single model setup entry:** *Set up offline transcription* runs the existing verified X-ASR installer, speaker model installation and optional Windows GPL FFmpeg decoder in sequence on explicit click. Existing advanced import/repair controls remain. The speech, speaker and decoder resources are still distinct downloads; they are **not bundled into the EXE/DMG**. Some components may require network access. The new UI reports each stage and allows retry after a partial failure.
- **Readability:** Larger transcript body and speaker text, stronger body/metadata contrast and clearer controls for extended bilingual reading.
- **Live focus layout:** Collapsible global navigation; live guide starts hidden and can be shown. Research notes can also be hidden, and Focus on transcript makes the transcript the only visible column. Existing recorder, live transcript, notes and guide data models remain unchanged.
- **Interview deletion:** A per-interview action requires confirmation, is blocked while live/import work or save errors exist, and updates the local notebook. Deleting the last item creates a fresh empty interview to preserve schema-1's invariant. **This does NOT delete the original WAV recordings**; orphaned audio remains discoverable in *Local storage & backup info → Show all local recordings*. There is no undelete for removed notebook text. Do not represent this as secure erasure of local audio.

## Automatic CI limitations and validation

In this **feature branch only**, `.github/workflows/ci.yml` uses `workflow_dispatch` rather than automatic `pull_request`/`push` triggers. It preserves all jobs for optional manual verification. This does **not** disable Actions in repository Settings or modify the existing workflow files on other branches. To disable Actions repository-wide, the repository owner must use GitHub Settings → Actions → General and select the disable option; the current connector does not expose that administrative operation.

No GitHub Actions were intentionally triggered by this work. Because CI is turned off here, **do not claim tests or native builds passed for this branch**. The prior Phase 5 CI success applies only to its own source SHA, not these UI changes.

Run locally on Node 22.23.4 before making a new release:

```bash
npm run verify
npm run test:desktop
```

Targeted UI checks:

```bash
npm run test:desktop
```

Tests added/updated under `web/desktop-e2e/` cover the setup entry (mock native bridge), navigation collapse and deletion, and transcript focus. Mock-bridge tests do **not** prove real model downloads, physical microphone setup or native installer acceptance. Verify the model workflow on actual installed Windows and Mac builds with public/fictional test data and never bypass platform security prompts.

The existing public `v0.2.0-preview.1` installer is **unchanged**. Build, review and version a new candidate separately; do not silently overwrite it or claim the new UI is already downloadable.
