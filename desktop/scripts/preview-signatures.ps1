param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Uninstaller)
$ErrorActionPreference = 'Stop'
$items = foreach ($file in @($Installer,$Executable,$Uninstaller)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'NotSigned') { throw "Unexpected preview signature status: $($signature.Status)" }
  @{ file = [IO.Path]::GetFileName($file); status = $signature.Status.ToString() }
}
$items | ConvertTo-Json -Compress
