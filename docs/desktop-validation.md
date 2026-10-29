# Desktop UI validation — 2026-10-24

The UI branch starts at `edd9ed0` on main and does not depend on or merge PR #2. Validation used Linux Chromium with Windows-sized **1366×768** and **1920×1080** viewports, not Windows hardware. Local Node 24.19.0/npm 11.9.0 were available; CI uses Node 22. The existing server suites used a disposable PostgreSQL 17 database. No real native speech engine, microphone recording, third-party AI request or paid deployment was used.

## Baseline and final checks

| Check | Result |
| --- | --- |
| Baseline `npm run typecheck`, `npm run build` | Passed before UI changes. |
| Baseline `npm run test -w web` | 25/25 passed. |
| `npm ci --cache /workspace/.npm --prefer-offline` | Passed with the final manifests/lockfile; no new unique dependency package. |
| `npm run typecheck` | Passed, including the desktop source, native contract and browser tests. |
| `npm test` | Server 95/95, web 29/29 (25 existing + 4 persistence/backup/evidence/model checks). |
| `npm run build` | Passed for the existing full web/server application with the new `/desktop` route. |
| `npm run build:desktop` | Passed; separate `web/dist-desktop`, static shell/service worker and lazy DOCX chunk. |
| `PW_CHROMIUM=/usr/bin/chromium npm run test:desktop` | 10/10 passed across both target laptop/desktop widths. See coverage below. |
| `PW_CHROMIUM=/usr/bin/chromium npm run test:e2e` | Initial full run: 28 passed, 2 failed. Failures and targeted reruns are recorded below; all 30 existing scenarios passed across the full run and final rerun. |
| `PW_CHROMIUM=/usr/bin/chromium npm run test:e2e -w web -- desktop-entry.spec.ts` | 3/3 passed: login-free `/desktop` route probes at 1440/1024/390px; block backend API calls and verify draft persistence. |
| `git diff --check` | Passed before submission. |
| Gitleaks 8.30.0 on the staged diff (`stdin --redact`) | No secrets found. |

Browser commands use a preinstalled Chromium. CI installs Chromium itself. Local default browser discovery was unavailable on an initial targeted rerun; supplying `PW_CHROMIUM` used the installed executable. No paid providers are needed.

## Desktop checks and corrections

The dedicated 10-test suite (five scenarios at each target size) covers:

1. Preparation/live/review, three columns with a larger transcript panel, corrected/original text, all note categories retained in exports, source-link focus, Markdown content, a generated DOCX, saved edits and **offline page reload**. Backend/external requests are denied; fetch/WebSocket entry points throw if used in the main journey.
2. Forced IndexedDB quota failure, visible unsaved state, emergency JSON export, retry, restored copies and prevention of simultaneous writes in another tab.
3. **Mock native host only:** model-download progress, runtime-confirmed readiness, permission denial, recording, interruption, session-relative timestamp offsets on resume and refresh recovery. An active saved recording restores as interrupted; missing audio is not claimed recovered.
4. 390px fallback, unavailable-model recording block and persistence of an unfinished manual transcript draft.
5. Revocation of a cached model-ready state: a fresh runtime check blocks capture before microphone permission or transcription.

Unit tests additionally check nested backup validation, unsafe IDs and duplicate evidence sequence rejection, IndexedDB round-trips, preserved originals/drafts and honest model-state requirements.

Early browser checks found and corrected insufficient contrast in recent-interview metadata and an import control outside the main landmark. Final axe checks report no violations on the three primary stages at both target widths. The first offline test also exposed a Vary-header cache mismatch in static preview: the worker now looks up only its own precached static files with `ignoreVary`, excluding application APIs and interview data. Build asset names version the cache, including CSS changes. It is registered only by the separate desktop entry, leaving the authenticated application's caching behavior unchanged.

A full-app entry probe also caught implicit textarea labels incorporating the restored initial value, making their exact accessible names unstable. Explicit accessible labels now remain stable after local draft restoration.

The React review kept persistence and runtime state separate from the three stage components. Native callbacks are gated by session identity, duplicate final events are ignored within a session, and resumed engine times are offset onto the existing timeline. IndexedDB saves confirm on transaction completion; errors never claim a successful save. Interrupted starts and stale model badges cannot silently start capture.

## Existing application regression results

The existing full-app run passed 28/30 scenarios, including account isolation, mocked transcription/recovery and all tested layout sizes. Two existing checks failed:

- The guide-import assertion matched both a numbered guide row and a temporarily closing modal textarea. It now waits for the uniquely named guide checkbox, keeping the same user-facing assertion without relying on text that also appears in the dialog. Production guide logic was not changed.
- The existing 6,000-segment edit timing check took **3,027 ms**, over its **3,000 ms** limit while other browser verification was running. A further targeted run measured **3,267 ms**. The threshold was not weakened and the production transcript component was not changed.

The final isolated command was:

```sh
PW_CHROMIUM=/usr/bin/chromium npm run test:e2e -w web -- --last-failed
```

Both failed scenarios passed (2/2, 46 seconds), including the full prepare/transcribe/notes/summary/edit/export journey and the existing scale threshold. This is a successful targeted rerun, not a claim that the initial full run was clean. The initial selector scoping attempt also needed correction because the visible row includes a number; the final checkbox selector is unambiguous.

## Screenshots and remaining limits

`docs/desktop-screenshots/` contains actual viewport screenshots for preparation, live interview, review, unsaved storage, model download, denied permission and interruption. The research content is synthetic. **Native-state screenshots use `mock-local-engine` injected by Playwright**, not a real installed engine or a hardware recording. The original supplied PNGs are visual references and are not passed off as implementation screenshots.

Outstanding work is explicit in [desktop-ui.md](desktop-ui.md): a real native Windows runtime/model/downloader, secure IPC and installer, real microphone/offline-ASR acceptance, recording archiving or audio-gap recovery, clickable DOCX citations, local AI configuration and cross-device/server migration. Browser storage is unencrypted and evictable; JSON backups remain necessary. Actual Windows/macOS devices, long sessions and manual assistive-technology review were not verified.

No repository visibility change, PR #2 merge, paid hosting or deployment was performed. Existing dependency advisories from release preparation were not remediated by this UI-only PR and remain a separate release concern.

## Related experimental provider PR

A separate [Draft PR #3](https://github.com/MartinZhong2003/meetfolio/pull/3) adds experimental server-side local X-ASR using sherpa-onnx. Its setup notes were inspected. It is not merged into or wired to this login-free notebook, and it still requires the original Fastify/PostgreSQL/account workflow. This UI does not query its server readiness endpoint or claim to test that provider. Combining it with a native desktop host is a separate integration step; loaded/offline readiness must remain truthful across that boundary.
