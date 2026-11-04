# Phase 5.4 — Transcript-first Review & export + offline Huninn

## Design changes

- **Review viewport:** Reduce top status, title, and stage-navigation spacing **only while a review is open**. This is not a redesign of the live capture page or the import workflow.
- **Transcript-first:** On desktop screens, the transcript fills the available height and receives the majority of width. The optional review/speaker side panel is a narrow column, toggled through "Hide review panel" / "Show review panel" in the transcript heading. When hidden, the transcript becomes a single-column document view.
- **Export disclosure:** Original full-interview TXT/MD/DOCX exports and the per-recording TXT/MD/DOCX/WAV buttons all remain available inside "Export options", closed by default so it does not occupy scarce reading height. The main heading's "Export research record" Markdown shortcut remains in place.
- **Navigation:** Left navigation is still collapsible to icons. "Recent interviews" starts folded and can expand to a scrollable list up to 43dvh high. "My interviews" remains the full searchable saved-history view. No records are deleted or migrated. A separate `view-library` class stops review-only fixed-height styling from applying to the history view.
- **Speaker list:** Long explanatory text is now in a small expandable "About speaker labels" help entry; rename, manual merge and speaker corrections work as before.
- **Legibility:** Local `@fontsource/huninn@5.2.4` includes Huninn 400. CSS uses Huninn first, then `Noto Sans SC`, `PingFang SC`, and `Microsoft YaHei` as fallbacks for missing simplified-Chinese glyphs. UI labels remain legible and the reading column uses 17px/1.9 line-height. Huninn is primarily a Traditional Chinese face and ships one regular weight; browser synthesis is used for heavier headings.
- **Offline:** The font is a version-pinned npm dependency imported into `DesktopApp.tsx`; Vite bundles its CSS and font asset files. No Google Fonts CDN request is required at runtime. The third-party font license is SIL OFL 1.1 and is included in the installed package. Source: https://fontsource.org/fonts/huninn/about .

## Files

- `web/src/desktop/DesktopApp.tsx` — font import, compact recent-list disclosure, distinct library styling
- `web/src/desktop/ReviewExport.tsx` — focus toggle and export disclosure
- `web/src/desktop/SpeakerManager.tsx` — compact speaker help
- `web/src/desktop/desktop.css` — spacing, proportions, responsive and typography
- `web/package.json` and root `package-lock.json` — pinned local font dependency
- `web/desktop-e2e/*.spec.ts` — adapted current navigation/export flows and added a review-layout/Huninn regression.

## Manual verification — GitHub Actions remain opt-in

This patch was committed remotely but **not locally built or tested** by the GitHub connector. Run:

```powershell
cd D:\GitHub\meetfolio
git status -sb
# Stop and resolve any uncommitted work before pulling.
git pull --ff-only origin feat/phase5-1-ux-cleanup-no-auto-ci
npm ci --include=optional
npm run build:desktop
npm run test:desktop
npm run verify
npm run electron
```

The `npm ci` step is required because the new font is a local dependency. The target browser suite now contains 19 test cases × 2 viewports = **38 tests**. These checks are not yet reported as passed.

Check physically in the installed Electron development app at 1366 and 1920 widths: large readable transcript, more vertical space, speaker-panel collapse/restore, export disclosure, separate WAV/text exports, expanded recent-list access, save/reload and offline font presentation. Record screenshots for visual review. Test recording/model functionality separately; this patch intentionally leaves audio inference code unchanged.

No PR was merged, no GitHub Actions run was requested, no release installer was replaced, and no data or local WAVs were modified.
