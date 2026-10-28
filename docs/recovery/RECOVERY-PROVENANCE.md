# Recovery provenance and what is missing

Source inputs verified by `zipfile.testzip` before creating this repository:

1. `Meetfolio_Incremental_Reconstruction_Stage1.zip`: generated from user-uploaded `meetfolio_2e0bbdd_continued_modified_source(3).zip` (v0.1-era source). Editable TypeScript and original repository structure.
2. `Meetfolio_v051_Recovered_Compiled_Code_Reference.zip`: main/preload bundles, `app.asar` and compiled front-end and ASR scripts extracted from user-supplied `Meetfolio-0.5.1-Windows-x64-Installer.zip`; reference-only.
3. `Meetfolio_v051_English_Overlay_Preview.zip`: experimental string translation layer for v0.5.1 runtime; not a complete installer, untested on a physical Windows machine.
4. `Meetfolio_v051_to_v060_Recovery_Findings.md` and `Meetfolio_v0.6.0_Reconstruction_Audit.md`: contemporaneous audit reports and status caveats.

No authentic `.git` history is present in the input archives. GitHub Desktop will create a **new first commit**. Commit timestamps from the old repo cannot be regenerated from these files. The previous PR #15 was not available as source in these uploaded ZIPs; it is not silently reconstructed here. The v0.6.0 officially released binaries and macOS sign/notarize records are not included.

### Top-level structure

- `desktop/`, `web/`, `server/`, `docs/`, `package.json`: Stage 1 **editable project**. v0.1-era underlying architecture, partial reconstruction only.
- `recovery-reference/v051-compiled/`: **v0.5.1 compiled evidence**, not editable TypeScript.
- `recovery-reference/v051-english-overlay/`: English patch used for local experiment; has PowerShell scripts — review them before running.
- `recovery-reference/v01-original-github-workflows/`: older GitHub Actions files preserved but **intentionally inactive** in new repository until tests and secrets have been reviewed. Do not move directly into `.github/workflows/` without verification.
- `docs/recovery/`: reconstruction notes.

### Safety checks

Before pushing, inspect all files for secrets and personal data. `.env.example` is intentionally tracked, `.env` and code-signing `.pfx`/`.p12` are excluded. Third-party licenses and bundled compiled code require review before public redistribution. Archive is a development snapshot, not a software release.
