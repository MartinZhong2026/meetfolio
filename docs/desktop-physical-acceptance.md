# Meetfolio Desktop — physical Windows acceptance (v0.1.0)

**Scope:** This checklist is for the **offline Electron/Windows installer** in PR #6. The older `docs/acceptance-testing.md` is for the *separate, server-backed DashScope application* and is not evidence that a Windows physical microphone or long offline interviews passed.

## Current evidence boundary

The pinned `2e0bbdd` version's CI validates real X-ASR CPU inference, file-backed (virtual) microphone capture, installed Windows NSIS flow, offline operation, interrupted-process recovery, close/restart and user data persistence. It **does not** validate a physical laptop microphone, Windows lid sleep/resume, USB/Bluetooth microphone unplug/reconnect, 60–90 minutes of real continuous speech, battery performance or ASR accuracy on the researcher's own voice. The candidate is unsigned. Do not use sensitive interview data for first acceptance.

## Safe test sequence on your own Windows PC

1. **Check binary provenance.** Download the current installer from the same PR #6 GitHub Actions run as your source commit and compare its published SHA-256. Do not disable Windows Defender or SmartScreen. The test candidate is **unsigned** and not a public trusted release.
2. Open the installed **Meetfolio** from the Start Menu. Do **not** run the installer during a recording. Keep your computer plugged in and close competing audio apps.
3. Create a **synthetic/fictional** interview. Confirm actual microphone consent and let X-ASR download and initialize. Verify the model says **Ready** only after true local initialization. Model download needs internet once; transcription should subsequently work offline.
4. For a **5–10 minute smoke test**, use your laptop's built-in real microphone (not a virtual/file-fed input). Speak several Mandarin sentences, including recognizable technical terms, and check partial text, finalized segments, timestamps, pause/resume and export. Compare the text with what you actually said. Document recognizable errors and unexpected duplicates.
5. For a **60-minute qualification**, use the included PowerShell health sampler below. It asks you to start real recording in the application and monitors only process counts, CPU and memory; it does **not** access the microphone or interview content itself. Speak periodically throughout the hour, not just at the beginning. Check the midpoint and ending transcript for missing stretches.
6. **After finishing and exporting a backup**, optionally test unplugging a USB/Bluetooth microphone and laptop sleep/resume in separate disposable sessions. These are *interruption* scenarios, so note honest gaps or user-visible errors; do not expect the computer to recognize speech while it is asleep. Never sacrifice the only copy of a real research interview.
7. Finish the human checklist, then attach only the process-health CSV and acceptance JSON if you want a developer to diagnose it. Review the files before sharing. **No names, audio, transcript content, or API credentials are collected by the script.**

### Run the sampler (from the extracted source repository)

Open **Windows PowerShell** in the source repository directory (the directory containing `desktop`, `web`, `server`). This is a *developer/maintainer qualification tool*, not something ordinary users need to transcribe.

```powershell
# First try a 5-minute smoke test with a real physical microphone:
.\desktop\scripts\physical-microphone-acceptance.ps1 -Minutes 5

# Then an actual continuous 60-minute qualification:
.\desktop\scripts\physical-microphone-acceptance.ps1 -Minutes 60 -SampleSeconds 15
```

If your installed app lives in a custom installation directory, pass it explicitly:

```powershell
.\desktop\scripts\physical-microphone-acceptance.ps1 -AppExe 'C:\Program Files\Meetfolio\Meetfolio.exe' -Minutes 60
```

The script does not request administrator privileges or change application binaries. If Windows execution policy blocks a downloaded script, inspect the script and your organization's policy first; do not disable enterprise security controls. Use only a trusted copy from the reviewed PR.

It creates `work/physical-microphone-acceptance/<timestamp>/process-health.csv` and `acceptance.json` in the source directory. An interrupted script may contain incomplete CSV/JSON evidence, not a successful test. The CSV is updated after each sample. The final JSON distinguishes self-reported observations from independent automated verification.

### Developer-side report review

If Node 22 is installed on a developer computer (not required by Meetfolio end users):

```bash
node desktop/scripts/review-physical-acceptance.mjs path/to/acceptance.json
node --test desktop/test/physical-acceptance.test.mjs
```

A report can be classified **`ready-for-independent-review`** only if it has a complete 60+ minute sample trail without observed process disappearance and the tester marked real microphone capture, transcript, finalization/export, restart and device/sleep observations as passing. This status does **not** prove acoustic accuracy or grant release approval. Skipping any physical tests retains `needs-further-physical-verification`.

## Actual acceptance targets (manual judgement required)

| Category | Minimum observation | Failure evidence |
| --- | --- | --- |
| Real microphone | Speak at normal distance, Chinese/English examples produce actual incremental and final words | No input, missing audio permission, repeated words, incorrect device |
| Recording controls | Start, pause, resume, finish with final flush | Last sentence missing or misleading Ready state |
| 60–90 minutes | CPU/RAM trend and process uptime recorded; transcript has no unexplained lengthy holes | Crashes, memory growth, silence while microphone was active |
| Power/device interruption | Clearly recover or report an honest interruption; don't invent transcription | UI claims uninterrupted transcript when audio was lost |
| Local persistence | Corrected/original words, notes, exports survive app close/restart | Saved material disappears or edits overwrite original words |
| Privacy/cost | Offline microphone transcription works without paid API/login; no cloud speech fallback | Network dependence after installed model; unconsented upload |

**Not included in this patch:** physical microphone access from this sandbox, actual Windows OS suspend, signed installer issuance, clean-PC SmartScreen reputation or 60-minute observation. Those depend on real hardware, a legal signing identity or human user action.
