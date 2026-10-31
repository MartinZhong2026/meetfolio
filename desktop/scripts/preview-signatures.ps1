param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Uninstaller)
$ErrorActionPreference = 'Stop'
# A pwsh parent may pass Core module paths to Windows PowerShell 5.1.
# Scope module discovery to this child host; do not change the parent or machine.
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$security = Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force -PassThru -ErrorAction Stop
$signatureCommand = $security.ExportedCmdlets['Get-AuthenticodeSignature']
if (-not $signatureCommand) { throw 'Host Authenticode cmdlet unavailable' }
$items = foreach ($file in @($Installer,$Executable,$Uninstaller)) {
  $signature = & $signatureCommand -LiteralPath $file
  if ($signature.Status -ne 'NotSigned') { throw "Unexpected preview signature status: $($signature.Status)" }
  @{ file = [IO.Path]::GetFileName($file); status = $signature.Status.ToString() }
}
$items | ConvertTo-Json -Compress
