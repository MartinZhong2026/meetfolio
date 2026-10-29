> This document preserves the PR #4 **browser-only UI foundation**. The v0.1.0 integration now adds a native Electron host and real offline speech; see [desktop-integration.md](desktop-integration.md) for current packaged-app results and screenshots. Statements below about unavailable native features describe running the standalone browser build without that host.

# Meetfolio Desktop UI

This is a React/TypeScript implementation of the supplied `Meetfolio_Desktop_UI_Concept.zip` HTML and screenshots. It follows the left navigation, sage/white palette, three stages, large central transcript and human-first evidence review. The supplied concept is a reference, not proof of a working speech engine. No prototype screenshot is presented as an implemented runtime feature.

This branch is based directly on `main` (`edd9ed0`) and is independent of Draft PR #2. It does not merge that PR, deploy anything, change repository visibility or purchase services.

## Try it

Use Node.js 22+ and npm from the repository root:

```sh
npm ci
npm run build:desktop
npm run desktop
```

Open **http://127.0.0.1:4175**. No login, database, application backend, API key or paid runtime is required for the local interface. Choose **载入虚构示例** for the clearly labelled synthetic interview, or create your own manual research record. The standalone output is `web/dist-desktop`; serve it at the root of a localhost/HTTPS static origin. Opening the HTML as a `file://` URL is not supported.

The full existing application also exposes **`/desktop`**, linked from its landing page. `npm run dev` → http://localhost:5173/desktop. All existing authenticated routes remain intact. The `/desktop` route does not register a service worker for the server app, and does not automatically fetch accounts or synchronize research data. Its browser origin has its own local notebook.

The standalone build precaches its own shell, styles and DOCX export chunk using a small service worker. Complete the initial online load before going offline. Tests verify full offline reload and retained edits after activation. No server responses or interview data enter the asset cache. Updates wait for old windows to close; stale shell caches are removed on activation. Keep a stable localhost port/origin to reopen the same IndexedDB records.

## What actually works?

| Capability | Status in this PR |
| --- | --- |
| Preparation | Functional local title, participant code, guide, coverage checkboxes, recording-consent flag and reference text; local TXT/Markdown text import. Reference material is labelled as not speech. |
| Three-column interview | Functional guide, larger transcript panel and researcher notes at 1366×768 and 1920×1080; narrower layouts stack panels. Individual columns scroll. |
| Local persistence | IndexedDB schema v1, serial transaction-confirmed saves, saved/pending/error states, draft persistence, retry and unload warning. A Web Lock prevents two tabs from overwriting each other's notebook. A final snapshot is queued before releasing the writer lock on SPA unmount. Browser shutdown can still lose uncommitted changes. |
| Interviews | Create/select multiple local interviews, up to 100 per notebook. No account is required. No automatic migration from the server database. |
| Transcript review | Manual segments are explicitly labelled; search, timestamps, speaker display, importance marks, correction, original-text comparison and restoration work. |
| Notes | All six existing categories are reused; timestamps link to the nearest earlier transcript segment; content/category edits, important marks and unfinished drafts persist. |
| Evidence links | Functional source links focus exact transcript/note nodes. Review shows direct excerpts from stored text and clearly separated researcher interpretations; it does not invent an AI summary. |
| Exports | Functional client-side TXT, Markdown, DOCX and complete JSON notebook backup. Corrections retain original text. Markdown carries source anchors/index links; TXT/DOCX retain timestamps. DOCX does **not** yet provide clickable internal evidence links. |
| Recovery | Reloading a saved active recording produces an interrupted state, with saved text/notes and an explicit missing-audio warning. JSON import validates nested fields/limits and creates copies without overwriting current interviews. This is not audio-gap retranscription. |
| Synthetic walkthrough | Functional fixture loading and start/pause status simulation, always labelled DEMO/synthetic. Fixed fixture timestamps are sample times, not elapsed real recording. No microphone or inference is used. |
| Offline speech recognition | **Not shipped.** This UI branch includes no native speech runtime, X-ASR model, Windows installer or model weights. The interface starts unavailable and cannot recognize speech by itself. |
| Model downloading | Native-bridge integration and progress/error states are wired, but no downloader is supplied. The button appears only when an installed native host exposes it. Download completion alone cannot set a ready badge; model status must be rechecked. Screenshots/tests use an explicit mock host. |
| Microphone / live transcription | Permission, start, pause, end, interruption and restart are wired to a typed native contract. They have been verified with a mock host only, not a physical microphone or an actual offline model. No browser/cloud speech fallback is silently substituted. |
| Optional AI | Informational choice/privacy panel only in the local interface. No key collection or AI requests. Existing server Qwen summaries, citation validation and version history remain in the original app and require its own account/configuration; usage may be billable and live provider behavior remains unverified. |
| Other research features | Existing server PDF/DOCX extraction, ownership/auth, live cloud ASR, recovery and backend exports remain available in the original application. They were not reimplemented as local native capabilities. |

## Native host contract and boundaries

`web/src/desktop/runtime.ts` defines optional `window.meetfolioDesktop` version 1. A future Windows/native host must supply:

- `getModelStatus()` with model state/identity, `offline: true` and `engineLoaded: true` only after the engine has really loaded. Installed files alone are insufficient; the host must load/validate the engine and report its actual state before capture is enabled.
- Optional `downloadModel(onProgress)` with actual byte counts. Initial download may require network/disk space; fees/license/hardware requirements of a future model are not assumed.
- `requestMicrophonePermission()` returning granted/denied/unavailable, reflecting the actual OS/device permission. The host, not this renderer, owns capture and permission prompts.
- `startTranscription({ onSegment, onInterruption })`, returning an asynchronous `stop()`. Emit final, uniquely identified, session-relative timestamped segments. The renderer namespaces segment IDs per start, deduplicates within that session and offsets timestamps onto the interview timeline. Stop must release the physical capture device and flush confirmed final text; it should be idempotent.

A start requires recording consent and a **fresh** installed/offline/loaded engine response before requesting microphone permission. A cached ready label is insufficient. Events arriving after an interrupted/stopped session are ignored. The renderer validates basic segment shape and preserves existing originals; this contract is not a native sandbox or an implementation of an ASR engine. Any real host still needs a secure preload/IPC boundary, validated model integrity/licensing, Windows packaging, microphone tests and offline end-to-end acceptance.

No microphone is requested without that host and ready model. The default browser interface never claims a model is installed. Test fixtures deliberately inject `mock-local-engine`; passing those tests proves state handling, not real ASR accuracy or availability. No real provider, hardware recording or billable call was used here.

## Privacy, costs and persistence

Local research text stays in this browser origin's IndexedDB and is not sent to the application server, analytics or AI. The initial static asset download reaches its host and may produce ordinary host logs. Browser storage is **unencrypted**, can be cleared/evicted, and is unsuitable as the only copy of sensitive research. Incognito/shared Windows accounts and clearing site data affect availability/privacy. OS-level access controls, consent, protected backups and retention remain the researcher's responsibility. A service-worker cache is not a research-data backup.

The Settings screen exports/imports JSON. Imports are capped at 8 MB, have nested/schema validation and create distinct interview copies. Keep backups private. No browser-local reset or deletion is performed by this PR. Preserve the old origin until exported records have been verified elsewhere. Importing a server export/bundle is not currently supported.

Manual preparation, notes, editing, local persistence and exports incur no per-minute API charge. Offline recognition will require a separately supplied real local host/model. Optional third-party AI remains separate from free local research workflows; this UI does not request keys or configure paid services. `docx`, already used by the server, is reused as an explicit browser dependency and executed on export (the standalone worker precaches its code on first load for offline export); no new unique dependency package is introduced. The standalone build includes upstream license notices in `THIRD-PARTY-LICENSES.txt`.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run build:desktop
npm run test:desktop
```

Use `PW_CHROMIUM=/usr/bin/chromium` with an existing Chromium installation (PowerShell: `$env:PW_CHROMIUM = 'C:\path\chrome.exe'`). Otherwise install Chromium with `npx playwright install chromium`. A separate `desktop-ui` CI job has **no backend/database service or provider secrets**.

Automated screenshots in `docs/desktop-screenshots/` are actual viewport captures of this implementation at **1366×768** and **1920×1080**. Preparation/live/review contain fictional data. Download/permission/interruption screenshots exercise the explicit **mock native contract**, not an installed real model. Unsaved-state screenshots use a forced local quota failure.

The dedicated browser suite covers source focus, corrected/original exports, generated DOCX, all three-stage layouts, axe checks, offline refresh, drafts, save-error retry, backup restore, second-tab protection, missing/revoked models, permission denial, interrupted/refresh recovery and a 390px fallback. Tests block backend/external traffic in the main journey and replace fetch/WebSocket entry points with throwing stubs; model tests inject only a local mock.

See [desktop validation](desktop-validation.md) for final counts and environment limits. Windows hardware, real native speech, model download/integrity, long physical recordings and assistive-technology testing remain outstanding. This is a functioning local research UI with a future native integration boundary, **not a completed offline ASR desktop product**.

## Related experimental provider PR

A separate [Draft PR #3](https://github.com/MartinZhong2003/meetfolio/pull/3) adds experimental server-side local X-ASR using sherpa-onnx. Its setup notes were inspected. It is not merged into or wired to this login-free notebook, and it still requires the original Fastify/PostgreSQL/account workflow. This UI does not query its server readiness endpoint or claim to test that provider. Combining it with a native desktop host is a separate integration step; loaded/offline readiness must remain truthful across that boundary.
