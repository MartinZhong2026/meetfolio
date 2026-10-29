# Windows physical-device acceptance — Phase 3A

All physical-device results below start as **Not verified**. Automated Electron tests use public file-backed audio; no actual participant or researcher microphone was tested by those commands.

Use a disposable Windows VM or separate Windows test account and a dedicated installation directory. Never install over the everyday Meetfolio application or copy its notebook/data into a test profile. Back up the ordinary notebook and recordings separately. The generated installer is unsigned, version 0.1.0, and is a review candidate only. Do not bypass SmartScreen or change security settings to force it to run. If Windows blocks it, record **Blocked** and keep the evidence.

Use fictional sentences and no research participant data. Record Windows version, device/driver, installer SHA-256, test date, CPU/RAM and whether the model came from download or import. Review any evidence before sharing it.

| Check | Steps and pass criteria | Result |
| --- | --- | --- |
| Installation / first launch | Install only inside the disposable environment. App opens without administrator rights, uses the test account's model/notebook cache, and reports missing model honestly. No user data is overwritten. | Not verified |
| Model acquisition | Click the explicit model download (network required) or import the exact pinned archive. Progress/cancel/retry work; modified archive is rejected; only real native initialization produces Ready. Existing legacy caches without integrity metadata require import/repair without deleting interview data. | Not verified |
| Microphone permission | Grant permission through Windows normally, choose the intended default microphone, and start a consented fictional interview. Denied permission must show an actionable failure and must not appear as recording. Device selection UI is not restored. | Not verified |
| Chinese, 30 seconds | Read known fictional Chinese sentences. Observe partial/final text and sensible timestamps; manually compare words. No invented pass from an empty result. | Not verified |
| English, 30 seconds | Repeat with known English sentences and compare results. Record omissions/errors rather than treating any output as accuracy acceptance. | Not verified |
| Cached offline recognition | Finish model setup, disconnect networking, restart the app and transcribe test speech. Cached model initializes; recognition, notes and save work without a cloud API. Restore networking manually after the test. | Not verified |
| Pause / resume / stop | Speak a distinctive final sentence, pause, resume and finish. Final text survives; timestamps remain ordered; no duplicate sessions or permanently active microphone/child process remain after stop/exit. | Not verified |
| Disconnect / busy / deny | Unplug a removable device or deny permission before a new start. App clearly reports failure/interruption, preserves confirmed text and permits a deliberate retry. No claim that missing audio was recovered. | Not verified |
| Restart / model cache | Close normally and reopen; cached model verifies/loads, notebook persists. Test interrupted shutdown only on a disposable fictional record; interruption is labeled and existing confirmed text survives. | Not verified |
| 10-minute session | Read fictional speech intermittently for ten minutes. Record CPU, working set and fixed-code error logs; no sustained growth, unexplained long gaps, duplicated text or unresponsive controls. Check the final sentence after stop. | Not verified |
| 30-minute session | If feasible repeat for 30 minutes, including a pause/resume. Compare process/memory trend and transcript continuity. Any unperformed step stays Not verified. | Not verified |
| Uninstall / reinstall | In the disposable environment, confirm uninstall does not silently remove the notebook/model; verify reinstall behavior separately. | Not verified |

Main-process diagnostics reside in the test profile's `diagnostics/` directory: at most two 128 KiB JSONL files, fixed event codes only, with a bounded pending write queue. Development includes informational events; packaged mode records errors by default. Logs contain no audio, transcript, arbitrary renderer data or exception strings. Directory permissions depend on the Windows account ACL; this is not encryption against that account. Do not share profile databases or recordings as logs.

## Automated commands and their limits

From the repository root with Node from `.nvmrc`:

```text
npm run build:electron
node server/scripts/check-xasr-runtime.mjs
npm run test -w server -- --config vitest.native.config.ts
node desktop/scripts/native-smoke.mjs --out work/phase3a/boot-smoke
node desktop/scripts/prepare-native-fixture.mjs
```

The fixture command downloads the fixed official model into ignored `work/`, validates its hash, imports it and prepares a public test WAV. `native-smoke.mjs --archive <verified archive> --audio <public WAV> --out <ignored output directory>` then tests actual Electron, native inference, AudioWorklet capture and restart. `--executable <unpacked Meetfolio.exe>` tests packaged resource resolution; it does not install an EXE. HTTP/WebSocket requests are blocked through Electron for this test, which does not prove an OS-wide firewall restriction. No physical microphone is used.

Build the review installer with the existing `package:win` command (publishing disabled), then run `node desktop/scripts/check-review-package.mjs` for static resource and checksum checks. Do not run the historical installer/UI scripts against the daily installation; some select ordinary app paths by default and are outside this automated acceptance.

Only after the relevant physical rows pass can Phase 3A be called **native X-ASR acceptance complete**. Code/CI success alone permits further controlled engineering work; WAV persistence and per-segment playback belong to Phase 3B.
