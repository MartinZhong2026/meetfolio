# Meetfolio — recovered development workspace

> **RECOVERY SNAPSHOT — NOT VERIFIED AS v0.6.0**  
> This repository combines an editable **v0.1-era, Stage 1 reconstruction** with reference assets extracted from **v0.5.1 Windows** and an **experimental English interface overlay**. It is not a copy of the original v0.6.0 source release, and no original Git history is included.

## What can be edited?

The top-level directories `desktop/`, `web/`, `server/`, `docs/` and the root `package.json` form the **editable Stage 1 source baseline**. This source preserves early X-ASR/Electron integration and received partial English UI, searchable interviews and TXT/Markdown reference enhancements during recovery. See [Stage 1 scope](README-RECOVERY.md) and [gap report](RECOVERY_GAP_REPORT.md).

The `recovery-reference/` folder contains **compiled** assets from the separate v0.5.1 Windows installer, an experimental English patch, and older CI files. These are for feature inspection and reconstruction only. They **cannot be pasted over the editable TypeScript tree** to create a complete modern application.

The previous repository's English overlay is archived under `recovery-reference/v051-english-overlay/`; its previous root license is preserved under `recovery-reference/previous-repository/`. `FILE-SHA256.txt` records the original recovery ZIP contents, not a live checksum of this working tree: `.gitignore` has since been extended to protect local data and credentials.

## Known historical milestones (do not confuse with current tree)

- **v0.5.1 installer**: the user's available Windows installer demonstrated richer functionality: local X-ASR, WAV audio recording and playback, PDF/DOCX references, and exports.
- **v0.6.0 Desktop Lite**: formerly published with English UI and Windows/macOS builds. Its original source and installers were not recoverable in this archive.
- **Browser PR #15**: previously existed on the original GitHub account as `feat/browser-notebook-mvp`, with browser recording and Tencent Cloud static hosting; that branch is **not contained here**.

Do not label this repository or its packages as a complete, tested v0.6.0 release. No hosted website or executable has been deployed from this recovery archive.

## Developer checks

Prerequisite: Node.js 22 and npm. Build and install are **not yet independently validated** for this combined recovery archive.

```bash
npm ci
npm run typecheck
npm test
npm run build:desktop
```

The browser preview is not proof that the native X-ASR engine works. Do not use a recovery build with real interview data before microphone, storage, export, packaging and privacy tests have passed.

## Getting started / re-upload

Read [UPLOAD-TO-GITHUB-WINDOWS.md](UPLOAD-TO-GITHUB-WINDOWS.md). Import **the extracted directory** into GitHub Desktop instead of uploading this ZIP as a single file. Publish **private first**, inspect files and licenses, then choose whether to make the repository public.

## Recovery files

- [Detailed version gap report](RECOVERY_GAP_REPORT.md)
- [Updated v0.5.1 → v0.6.0 findings](docs/recovery/v051_to_v060_findings.md)
- [Previous stage comparison](docs/recovery/v060_reconstruction_audit.md)
- [Source provenance + folder guide](docs/recovery/RECOVERY-PROVENANCE.md)
- [Original license](LICENSE) and third-party notices in `docs/third-party` and `recovery-reference/`

**Privacy:** No personal interview content, API keys, code-signing identities or `.env` secrets should ever be committed. The included `.env.example` is a template only.
