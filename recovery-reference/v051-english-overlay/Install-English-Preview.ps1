# Apply an English UI-only preview to the exact Meetfolio v0.5.1 build.
# Does not replace any executable or native code. No elevation or Internet usage.
param([string]$InstallDir = "")
$ErrorActionPreference = 'Stop'
$expectedSha = '4dafb128a0064d807b47f9d3bc157540530c6cb9b52f7e2cc1f1119bdc66726e'
$newAsset = 'index-english-b561f2b979.js'
$source = Join-Path $PSScriptRoot 'resources\ui'
if (-not (Test-Path -LiteralPath (Join-Path $source "assets\$newAsset"))) {
    throw "Patch files missing. Extract the whole ZIP first."
}
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Meetfolio'),
        (Join-Path $env:ProgramFiles 'Meetfolio'),
        (Join-Path ${env:ProgramFiles(x86)} 'Meetfolio')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'resources\ui\index.html')) }
    if ($candidates.Count -eq 0) { throw 'Meetfolio installation not found. Pass -InstallDir with your installation folder.' }
    if ($candidates.Count -gt 1) { throw "Multiple Meetfolio installations found: $($candidates -join ', '). Pass -InstallDir to select one." }
    $InstallDir = [string]$candidates[0]
}
$ui = Join-Path $InstallDir 'resources\ui'
$oldAsset = Join-Path $ui 'assets\index-IyWnOIEo.js'
if (-not (Test-Path -LiteralPath $oldAsset)) { throw "This does not look like the exact v0.5.1 installation. Missing: $oldAsset" }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $oldAsset).Hash.ToLowerInvariant() -ne $expectedSha) {
    throw 'Original UI checksum differs. Refusing to patch a different Meetfolio version.'
}
if (Get-Process -Name 'Meetfolio' -ErrorAction SilentlyContinue) {
    throw 'Meetfolio is still running. Close the application completely and retry.'
}
$backupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Meetfolio-English-Backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath $ui -Destination (Join-Path $backupRoot 'ui') -Recurse -Force
Write-Host "Original Chinese UI backed up to: $backupRoot"
try {
    Copy-Item -LiteralPath (Join-Path (Join-Path $source 'assets') $newAsset) -Destination (Join-Path (Join-Path $ui 'assets') $newAsset) -Force
    Copy-Item -LiteralPath (Join-Path $source 'index.html') -Destination (Join-Path $ui 'index.html') -Force
    Copy-Item -LiteralPath (Join-Path $source 'sw.js') -Destination (Join-Path $ui 'sw.js') -Force
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'BACKUP_LOCATION.txt') -Value $backupRoot -Encoding UTF8
    Write-Host 'English UI preview installed. Software version remains 0.5.1.'
    Write-Host 'Open Meetfolio and test using fictional data. If anything fails, restore the backup.'
} catch {
    Write-Warning 'Patch could not be completed. Restoring index.html and sw.js from backup.'
    Copy-Item -LiteralPath (Join-Path $backupRoot 'ui\index.html') -Destination (Join-Path $ui 'index.html') -Force
    Copy-Item -LiteralPath (Join-Path $backupRoot 'ui\sw.js') -Destination (Join-Path $ui 'sw.js') -Force
    throw
}
