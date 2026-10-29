# Windows installation, branding and signing readiness

This updates integration PR #6, based on `bc03e519f71718156f5f68838ceb2bff2c852f94`. No research workspace, recognition algorithm, persistence schema, export or AI configuration changes are required.

## Installation behavior

`desktop/electron-builder.yml` uses electron-builder 26.18.0's assisted NSIS installer and `runAfterFinish: true`. The completion page's **Run Meetfolio** checkbox is checked by default. Clicking Finish launches the installed executable in the user context using upstream `ExecShellAsUser`; unchecking it opts out. There is no custom early-launch hook, downloaded-installer autorun, login startup entry, updater or background service. Silent `/S` installation does not imply launch; interactive Finish is tested independently.

Fresh installations default to the current user (`perMachine: false`, `selectPerMachineByDefault: false`). The path page remains available. Selecting all users may legitimately require UAC; elevation remains supported. Upstream registry detection preserves an existing all-users-only installation as all users. The supplied screenshot explicitly reports an existing Program Files installation, explaining its selected all-users option and shield. Forcing current-user scope during every upgrade would be incorrect.

App ID `org.meetfolio.desktop`, version `0.1.0`, stable workspace origin, single-instance lock and `%LOCALAPPDATA%/Meetfolio` research/model storage are preserved. Installation binaries are separate from that profile. The host shows the workspace after its first frame, coalesces native close requests and retries tokenized preload delivery during startup. Audio/notebook flush executes once per token. After durable-save acknowledgement (or an explicit user decision to exit despite failure), the host permits unload even if React’s browser-only dirty guard has not rerendered yet; it never bypasses that guard before the save decision. A close before the initial notebook read finishes leaves disk data untouched: no editable notebook or unsaved changes exist at that point. No persistence schema or export format changes are made. Uninstall/reinstall does not delete research data. Switching scope is not a research-data migration: each Windows user's notebook remains private to that user.

OS-language detection uses maintained NSIS English/Simplified/Traditional Chinese translations without an extra language-picker screen. `desktop/installer.nsh` only adds an optional `/LANG=2052` (Simplified Chinese), `1028` (Traditional Chinese) or `1033` (English) switch for reproducible verification; scope and launch logic remain upstream.

## Original branding assets

Master: `desktop/assets/meetfolio.svg`. Forest green `#355F52` reuses the existing project's palette; the two white pages are original vector paths. No external icon or trademark is copied. Assets are covered by the repository MIT license. An image-generated book concept informed the design; the committed master is deliberately flat, with no generated texture or gradient.

`npm run icons -w desktop` uses locked development-only `sharp@0.34.5` to export the 1024px PNG, seven-frame ICO (16/24/32/48/64/128/256), 150×57 header BMP and 164×314 sidebar BMP. Small ICO frames use alpha DIBs plus AND masks; 256px uses PNG. Neither sharp nor its toolchain ships in the desktop runtime.

Explicit paths brand the EXE, installer, uninstaller, assisted header and finish/uninstall sidebar. Shortcuts use EXE icon index 0; the BrowserWindow uses the same PNG and its Windows application ID matches the shortcut ID for taskbar grouping. Windows's security/UAC shield is deliberately retained.

`verify-branding.mjs` compares every primary PE icon group's actual payloads to the master ICO and checks execution-level manifests and compares extracted NSIS page BMP bytes to the source assets and checks the actual rendered controls for the forest-green/white artwork (NSIS stores these in its compressed payload, not PE bitmap resources). `verify-installer.ps1` drives the real wizard, records screenshots, checks shortcut targets/icons/application IDs, captures the live window icon, reads Unicode shortcut targets through `IShellLinkW`, tests Finish/second-launch/close/restart, and verifies unsigned Authenticode status. Explorer's icon cache can retain a prior version at the same path; compare PE resources or test in a fresh profile/unique candidate directory before concluding the new binary is wrong. Normal Explorer refresh/sign-out may refresh the display; no protection or cache-deletion bypass is part of this installer.

## Signing choices, checked 2026-10-24

| Option | Legitimate use and limits |
| --- | --- |
| Trusted CA OV | Verify the actual legal identity with the issuer. Current public code-signing keys normally require approved hardware/token or a managed HSM service. Reputation grows over time. |
| Trusted CA EV | Stronger identity checks can meet procurement requirements, but EV does **not** guarantee immediate SmartScreen reputation. Do not buy EV merely to promise warning-free downloads. |
| Microsoft Artifact Signing (formerly Trusted Signing) | Managed Public Trust identity/profile plus Azure eligibility and billing approval are required. The current service quickstart lists organizations in US, Canada, EU, UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel; individuals in US/Canada. Verify current eligibility in the service before purchase; overview pages can lag the service quickstart. We have not established this maintainer's eligibility. Private/Test Trust is not public trust. |
| Microsoft Store | Future MSIX submission can use Store certification/signing. The existing EXE route still requires the publisher to sign the installer and PE files. Store packaging/certification is not implemented or submitted here. |

Sources: [Microsoft signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [current Artifact Signing eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [DigiCert key storage requirements](https://knowledge.digicert.com/general-information/new-private-key-storage-requirement-for-standard-code-signing-certificates-november-2022).

The current candidate is **unsigned**, has no verified publisher identity, and can trigger Windows warnings or enterprise blocks. Author/copyright metadata is not Authenticode identity. Do not invent `publisherName`, install fake roots, disable Defender/SmartScreen/Smart App Control/UAC, remove Mark-of-the-Web, or promise that signing removes every warning. No certificate or signing service has been purchased or used.

## Reproducible future signed build

First acquire a legitimate CA identity or approved Public Trust profile. Review the legal identity that will be publicly exposed, issuer terms, cost and key custody separately. Build only approved source on a trusted Windows x64 host:

```powershell
npm ci --include=optional
npm exec -w desktop -- install-electron
npm run build:electron
# Actual public certificate metadata; not a made-up product/company name:
$env:MEETFOLIO_SIGNING_PUBLISHER = '<exact approved certificate common name>'
$env:MEETFOLIO_CERTIFICATE_SHA1 = '<certificate-store thumbprint>'
node desktop/scripts/prepare-signing.mjs store
npx electron-builder --win nsis --x64 --config work/windows-signing.json --publish never
```

The private key stays in the issuer-supported hardware/HSM provider integrated with the Windows certificate store. A thumbprint selects the certificate; it is not a SHA-1 file-signing algorithm (files use SHA-256). Install the issuer's token/KSP software only on a controlled signing host. Do not export a modern hardware key to a PFX to make CI easier. The signed overlay uses the approved publisher as build-distributor/company metadata without changing source authorship or licenses. The generated config sets `forceCodeSigning: true`; absent signing credentials must fail rather than silently produce an unsigned "signed" build. RFC3161 timestamping is required.

For approved Artifact Signing, set `MEETFOLIO_ARTIFACT_ENDPOINT` to the regional HTTPS `*.codesigning.azure.net` endpoint, `MEETFOLIO_ARTIFACT_ACCOUNT`, `MEETFOLIO_ARTIFACT_PROFILE`, and the verified publisher; run `prepare-signing.mjs azure` instead. It configures electron-builder v26 `azureSignOptions`; no store/PFX options are mixed into that configuration. Authentication must be configured on the signing runner per the service's supported Azure Identity integration. Preparing this JSON alone does not authenticate, spend money or sign anything. The locked v26 builder currently installs the external `TrustedSigning` PowerShell module (minimum 0.5.0) dynamically; review/record its resolved version and dependency supply chain before enabling a signing runner. Real provider authentication and a repeatable controlled signing environment remain unqualified until legitimate credentials are available.

### GitHub Actions controls before enabling real signing

Keep the ordinary PR workflow unsigned (`win.signExecutable=false`). Never expose signing on `pull_request_target` or run untrusted fork code with credentials. A future manual signing job should require a protected `windows-signing` environment with reviewers and approved refs, restricted Actions permissions, a fixed approved source SHA, and pinned trusted action versions. Do not auto-publish a Release.

Prefer OIDC/federated identity restricted to that repository/environment and only the required certificate-profile signer role; confirm electron-builder/Azure Identity on the chosen runner supports that token path. Otherwise use a narrowly scoped service principal in environment secrets (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) according to the supported provider setup. Keep public endpoint/account/profile/verified publisher in environment variables. No private keys, passwords or tokens belong in YAML/config files, logs, artifacts or renderer code. Protected self-hosted token/HSM runners must not accept arbitrary public PR jobs. Rotate/revoke credentials on exposure; retain a signing audit trail and exact source/artifact hashes.

Configuration tests only generate public metadata and check missing identities/unofficial endpoints/secret omission. **No signed build has been tested.** Paid signing jobs are intentionally not enabled.

### Post-sign verification

Run on the installed application, installer and actual bundled uninstaller, after signing and before redistribution:

```powershell
./desktop/scripts/verify-signatures.ps1 -Files @(
  'work/desktop-packages/Meetfolio-0.1.0-windows-x64-setup.exe',
  '<installed directory>/Meetfolio.exe',
  '<installed directory>/Uninstall Meetfolio.exe'
) -ExpectedSubject '<exact approved certificate Subject DN>'
# Optional -ExpectedThumbprint for a fixed store certificate; managed leaves may rotate.
# Independent Windows SDK command:
signtool verify /pa /all /v /tw '<file.exe>'
Get-AuthenticodeSignature '<file.exe>' | Format-List Status,SignerCertificate,TimeStamperCertificate
```

The script requires valid Authenticode, exact approved identity, timestamp and successful Windows SDK verification; it records SHA-256 and public certificate metadata. Check certificate chain/revocation using current Windows trust, all native PE dependency signatures/notices, and the final downloaded artifact on clean machines. Do not re-sign upstream binaries under a different identity without reviewing distribution terms. Run the full installed native/offline/reinstall tests again on the signed artifact. A valid signature proves integrity/publisher identity, not application safety, Store acceptance or instant SmartScreen reputation.

## Verification evidence and limits

The Windows workflow uploads candidate EXE/checksum, real wizard/window-icon screenshots, installer/branding JSON, real native offline reports, reinstall evidence and runtime inventory. It exercises fresh per-user defaults, per-user reinstall while the old application is running, an explicit all-users installation and subsequent all-users default preservation/relaunch with the previous application initially running. Electron correctly has helper processes; "one instance" means one primary workspace process/window, not one OS process total.

GitHub's Windows runner may already be elevated. Record `runnerElevated` and inspect actual `asInvoker` manifests and chosen registry scope; this is not a physical standard-user UAC/SmartScreen assessment. Windows icon caching, downloaded-file reputation, physical microphones and long-session qualification still require manual release checks. Reports must be consulted before claiming any new wizard scenario passed.
