# Manual Windows physical microphone / long-interview acceptance for Meetfolio Desktop.
# Captures process health metrics only; never opens audio, exports transcripts or changes user data.
[CmdletBinding()]
param(
  [string]$AppExe = '',
  [ValidateRange(1, 120)][int]$Minutes = 60,
  [ValidateRange(5, 120)][int]$SampleSeconds = 15,
  [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script in Windows PowerShell on a real Windows computer.' }

if (-not $AppExe) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Meetfolio\Meetfolio.exe'),
    (Join-Path $env:ProgramFiles 'Meetfolio\Meetfolio.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Meetfolio 安装验证\Meetfolio.exe')
  )
  $AppExe = @($candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)[0]
}
if (-not $AppExe -or -not (Test-Path -LiteralPath $AppExe -PathType Leaf)) {
  throw 'Meetfolio.exe not found. Supply -AppExe with the actual installed executable path.'
}
$AppExe = [IO.Path]::GetFullPath($AppExe)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path (Get-Location).Path "work\physical-microphone-acceptance\$stamp"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$csv = Join-Path $OutputDirectory 'process-health.csv'
$reportFile = Join-Path $OutputDirectory 'acceptance.json'
$answers = [ordered]@{}
$processDeltas = @{}
$sampleCount = 0
$zeroProcessSamples = 0
$peakMemoryMiB = 0.0
$peakCpuPercent = 0.0
$start = Get-Date
$monitorStarted = $null
$monitoredSeconds = 0

function InstalledProcesses {
  # Electron normally uses multiple Meetfolio.exe processes. Observe all of them.
  @((Get-Process -Name 'Meetfolio' -ErrorAction SilentlyContinue) | Where-Object {
    try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $AppExe) } catch { $false }
  })
}
function Ask([string]$Key, [string]$Question) {
  while ($true) {
    $value = (Read-Host "$Question  [P=通过/F=失败/S=未测试]").Trim().ToUpperInvariant()
    if ($value -in @('P', 'F', 'S')) {
      $answers[$Key] = switch ($value) { 'P' { 'pass' } 'F' { 'fail' } 'S' { 'skip' } }
      return
    }
    Write-Host '请输入 P、F 或 S。'
  }
}
function Save-Report([string]$Phase) {
  # Only status/health metrics are stored. No interview titles, names, transcripts or audio.
  $report = [ordered]@{
    schemaVersion = 1
    source = 'manual-physical-windows-test'
    verificationType = 'human-observed-not-CI'
    phase = $Phase
    model = 'Meetfolio Desktop with locally installed X-ASR'
    executableSha256 = (Get-FileHash -LiteralPath $AppExe -Algorithm SHA256).Hash.ToLowerInvariant()
    testStartUtc = $start.ToUniversalTime().ToString('o')
    updatedUtc = (Get-Date).ToUniversalTime().ToString('o')
    requestedMinutes = $Minutes
    sampleIntervalSeconds = $SampleSeconds
    observedSeconds = $monitoredSeconds
    samples = $sampleCount
    zeroProcessSamples = $zeroProcessSamples
    peakWorkingSetMiB = [math]::Round($peakMemoryMiB, 2)
    peakHostCpuPercent = [math]::Round($peakCpuPercent, 2)
    answers = $answers
    knownLimitations = @(
      'Human responses are not independently certified.',
      'Recording audio and transcription are not collected by this script.',
      'Original audio is not durably backed up by Meetfolio v0.1.0.',
      'This report is not release approval or code-signing evidence.'
    )
  }
  $report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $reportFile -Encoding UTF8
}

Write-Host "Meetfolio physical microphone acceptance — $Minutes minute(s)" -ForegroundColor Cyan
Write-Host "Report folder: $OutputDirectory"
Write-Host 'Use only fictional/consenting material. Keep a separate original-audio backup for important interviews.'
Write-Host 'This script does not record audio, modify Meetfolio, or fake a microphone.'
Write-Host 'First open the installed app, confirm X-ASR Ready, allow the actual microphone and start a NEW synthetic test interview.'
Write-Host 'Read different Chinese sentences periodically throughout the monitoring interval.'
if (@(InstalledProcesses).Count -eq 0) {
  Write-Host 'Meetfolio does not appear to be running. Launching installed application.'
  Start-Process -FilePath $AppExe | Out-Null
}
Read-Host 'Press Enter ONLY AFTER the physical microphone is actively recording in Meetfolio'
if (@(InstalledProcesses).Count -eq 0) { throw 'Meetfolio is still not running. No acceptance run was recorded.' }
Ask 'physicalMicrophone' 'Did actual microphone input produce real X-ASR partial/final transcription (not a file-backed microphone)?'
$monitorStarted = Get-Date
$last = $monitorStarted
$end = $monitorStarted.AddMinutes($Minutes)
Save-Report 'monitoring'
Write-Host 'Monitoring process memory/CPU. You can keep using Meetfolio normally. Do not close it during this phase.'
try {
  while ((Get-Date) -lt $end) {
    $now = Get-Date
    $elapsed = [math]::Max(0.001, ($now - $last).TotalSeconds)
    $processes = @(InstalledProcesses)
    if ($processes.Count -eq 0) { $zeroProcessSamples++ }
    $memory = 0.0
    $cpuDelta = 0.0
    $next = @{}
    foreach ($proc in $processes) {
      try {
        $proc.Refresh()
        $memory += [double]$proc.WorkingSet64 / 1MB
        $cpu = [double]$proc.CPU
        $id = [string]$proc.Id
        if ($processDeltas.ContainsKey($id) -and $cpu -ge $processDeltas[$id]) {
          $cpuDelta += $cpu - $processDeltas[$id]
        }
        $next[$id] = $cpu
      } catch { }
    }
    $processDeltas = $next
    $cpuPct = [math]::Min(100, [math]::Max(0, 100 * $cpuDelta / $elapsed / [Environment]::ProcessorCount))
    $peakMemoryMiB = [math]::Max($peakMemoryMiB, $memory)
    $peakCpuPercent = [math]::Max($peakCpuPercent, $cpuPct)
    $sampleCount++
    $monitoredSeconds = [int]($now - $monitorStarted).TotalSeconds
    [pscustomobject]@{
      utc = $now.ToUniversalTime().ToString('o')
      elapsedSeconds = [int]($now - $monitorStarted).TotalSeconds
      processCount = $processes.Count
      totalWorkingSetMiB = [math]::Round($memory, 2)
      hostCpuPercent = [math]::Round($cpuPct, 2)
    } | Export-Csv -LiteralPath $csv -NoTypeInformation -Append -Encoding UTF8
    if ($sampleCount % 4 -eq 0) { Save-Report 'monitoring' }
    $last = $now
    $remaining = [math]::Max(0, ($end - (Get-Date)).TotalSeconds)
    Start-Sleep -Seconds ([math]::Min($SampleSeconds, [math]::Ceiling($remaining)))
  }
} finally {
  $monitoredSeconds = [int]((Get-Date) - $monitorStarted).TotalSeconds
  Save-Report 'monitoring-finished-or-interrupted'
}

Write-Host 'Monitoring completed. Now stop recording normally, verify last sentence, save notes and export TXT/DOCX/JSON.'
Read-Host 'Press Enter after checking the transcript and exports'
Ask 'continuousTranscript' 'Were expected sentences represented throughout the interval, without unexplained long gaps or duplicates?'
Ask 'finalFlush' 'Did pause/finish preserve the final spoken sentence and original transcript after corrections?'
Ask 'exportAndRestart' 'Did export, normal app close, restart and local notebook recovery succeed?'
Write-Host 'OPTIONAL interruption checks — use disposable interview data, back up first, never force-sleep a live important interview.'
Ask 'deviceDisconnect' 'Did an actual mic disconnect/reconnect produce honest status, safely recover or clearly flag a gap?'
Ask 'sleepResume' 'Did Windows sleep/resume produce honest interruption/recovery, without invented transcript?'
Save-Report 'completed'
Write-Host "Saved privacy-minimal evidence: $reportFile" -ForegroundColor Green
Write-Host "Process trend: $csv"
Write-Host 'Send the two files to the developer if you want diagnosis. Review their contents before sharing.'
Write-Host 'This is HUMAN-REPORTED physical testing, not automated hardware certification or a signed release.'
