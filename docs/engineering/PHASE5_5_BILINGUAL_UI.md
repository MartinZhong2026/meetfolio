# Phase 5.5 — Simplified Chinese / English desktop UI switch

## User experience

- A small **中文 / EN** control is visible in the top-right desktop workspace status bar.
- Switching immediately rerenders **navigation, Preparation, Live session, Import audio, Review & export, Speaker management, Model & Settings, saved-interview history and WAV catalog**.
- Language selection is stored in this computer's browser/Electron `localStorage` under `meetfolio.ui.language` and restored on reload and future starts. Defaults to English for backward-compatible existing installations.
- `document.documentElement.lang` follows the selection; controls use translated accessible names, hints, placeholders and status text.
- The existing self-hosted Huninn font and system Chinese fallback remain; runtime use is offline.

## Data boundary

UI translation is **presentation-only**. It does **not** translate or rewrite original transcript content, segment IDs, WAV recordings, speaker identities, user-entered interview titles or notes. The ASR language and model capabilities are independent of the UI language. Changing UI language does not call a cloud service, migrate notebooks, alter audio files, or edit exports. Format names (JSON, TXT, WAV, Markdown, DOCX, X-ASR) remain unchanged.

Some low-level native/OS errors, model-provided diagnostics, old free-form recovery messages and imported speaker-name data can still appear in English; they are shown verbatim rather than translated speculatively.

## Implementation

- `web/src/desktop/language.tsx`: React context, strongly typed locale selection, Chinese UI translation table and persisted preference.
- `web/src/desktop/DesktopApp.tsx`: language provider wrapper, toolbar selector and translated navigation, history and settings.
- `web/src/desktop/{Preparation,LiveInterview,AudioImport,ReviewExport,SpeakerManager,ModelCard,Recordings,Transcript,SegmentPlayback}.tsx`: translated UI strings without modifying data.
- `web/src/desktop/desktop.css`: compact responsive selector and correct saved-state indicator positioning.
- `web/src/desktop/language.test.ts`, `web/desktop-e2e/language.spec.ts`: fallback, persistence, bilingual navigation and unchanged transcript regression coverage.

## Verification (no automatic GitHub Actions)

This change was made by GitHub connector commits, **not compiled or executed locally** by the assistant. Branch workflow CI remains `workflow_dispatch` only. Run in VS Code PowerShell:

```powershell
cd D:\GitHub\meetfolio
git status -sb
# Stop if the worktree is dirty; do not overwrite local changes.
git pull --ff-only origin feat/phase5-1-ux-cleanup-no-auto-ci
npm run build:desktop
npm run test:desktop
npm run verify
npm run electron
```

Expected desktop browser case count after this phase: 42 (two viewports). This is an **expected count, not a pass claim**; the existing 38 checks need to rerun as well as four language checks. The new web unit suite adds three localization assertions to the previously passing 47 tests.

Manual UX checks: change language while a real interview is open, reload, verify selection persists, check Chinese and English note types/metadata, confirm prior transcripts/WAV links unchanged, expand/collapse review panels and export disclosures, and inspect screen-reader naming and smaller laptop widths. Preserve backup before large manual data edits. Do not merge, push other branches or publish new installer without approval.
