# Restore the original v0.5.1 Chinese UI from the backup created by Install-English-Preview.ps1.
param([Parameter(Mandatory=$true)][string]$BackupDir, [string]$InstallDir = "")
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'Meetfolio' -ErrorAction SilentlyContinue) { throw 'Close Meetfolio before restoring the original UI.' }
$backupUi = Join-Path $BackupDir 'ui'
if (-not (Test-Path -LiteralPath (Join-Path $backupUi 'assets\index-IyWnOIEo.js'))) { throw 'Invalid backup directory.' }
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Meetfolio'),
        (Join-Path $env:ProgramFiles 'Meetfolio'),
        (Join-Path ${env:ProgramFiles(x86)} 'Meetfolio')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'resources\ui\index.html')) }
    if ($candidates.Count -ne 1) { throw 'Pass -InstallDir to select the exact original installation.' }
    $InstallDir = [string]$candidates[0]
}
$targetUi = Join-Path $InstallDir 'resources\ui'
Copy-Item -LiteralPath (Join-Path $backupUi 'index.html') -Destination (Join-Path $targetUi 'index.html') -Force
Copy-Item -LiteralPath (Join-Path $backupUi 'sw.js') -Destination (Join-Path $targetUi 'sw.js') -Force
Write-Host 'Original Chinese UI restored. No interviews or recordings were modified.'
