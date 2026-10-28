# Run after a genuinely signed build. Unsigned/invalid identities fail closed; this does not establish SmartScreen reputation.
param([Parameter(Mandatory)][string[]]$Files,
  [Parameter(Mandatory)][string]$ExpectedSubject,
  [string]$ExpectedThumbprint,
  [string]$Out = 'work/signature-verification.json')
$ErrorActionPreference='Stop'
$tool=Get-Command signtool.exe -ErrorAction SilentlyContinue
$toolPath=if($tool) { $tool.Source } else { (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName }
if(!$toolPath) { throw 'Install the Windows SDK SignTool on the trusted signing/verification machine' }
$report=@()
foreach($file in $Files) {
  $file=(Resolve-Path $file).Path
  $signature=Get-AuthenticodeSignature -LiteralPath $file
  if($signature.Status -ne 'Valid') { throw "Authenticode is not valid: $file ($($signature.Status))" }
  if($signature.SignerCertificate.Subject -cne $ExpectedSubject) { throw "Signer subject differs from approved verified identity: $file" }
  if($ExpectedThumbprint -and ($signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint.Replace(' ',''))) { throw "Certificate thumbprint mismatch: $file" }
  if(!$signature.TimeStamperCertificate) { throw "RFC3161 timestamp is required: $file" }
  & $toolPath verify /pa /all /v /tw $file
  if($LASTEXITCODE -ne 0) { throw "SignTool verification failed: $file" }
  $report+=@{file=[IO.Path]::GetFileName($file);status=$signature.Status.ToString();subject=$signature.SignerCertificate.Subject;
    issuer=$signature.SignerCertificate.Issuer;thumbprint=$signature.SignerCertificate.Thumbprint;
    timestampSubject=$signature.TimeStamperCertificate.Subject;sha256=(Get-FileHash $file -Algorithm SHA256).Hash}
}
New-Item -ItemType Directory -Force (Split-Path ([IO.Path]::GetFullPath($Out))) | Out-Null
$report | ConvertTo-Json -Depth 5 | Tee-Object -FilePath $Out
