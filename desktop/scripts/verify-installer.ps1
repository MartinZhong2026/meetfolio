# Real interactive NSIS wizard, no /S or --force-run. UI messages are sent only to our test installer.
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$Target,
  [string]$Out = 'work/installed-app-evidence', [switch]$Reinstall, [switch]$AllUsers, [switch]$ExpectAllUsers)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellLinkUnicode {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size, IntPtr data, uint flags);
  void GetIDList(out IntPtr value); void SetIDList(IntPtr value);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int size);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int size);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int size);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetHotkey(out short value); void SetHotkey(short value);
  void GetShowCmd(out int value); void SetShowCmd(int value);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value,int size,out int index);
}
public class ShortcutDetails { public string TargetPath; public string IconLocation; }
public class InstallerWindow {
  public static ShortcutDetails Shortcut(string file) {
    object instance=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
    try {
      ((System.Runtime.InteropServices.ComTypes.IPersistFile)instance).Load(file,0);
      var link=(IShellLinkUnicode)instance; var target=new StringBuilder(32768); var icon=new StringBuilder(32768);
      link.GetPath(target,target.Capacity,IntPtr.Zero,4); link.GetIconLocation(icon,icon.Capacity,out int index);
      return new ShortcutDetails { TargetPath=target.ToString(), IconLocation=icon.ToString()+","+index };
    } finally { Marshal.FinalReleaseComObject(instance); }
  }
  public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc fn, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc fn, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] static extern IntPtr ReadText(IntPtr hwnd, uint msg, IntPtr max, StringBuilder text);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern uint GetLongPathName(string source, StringBuilder result, uint capacity);
  public static string LongPath(string source) { var b=new StringBuilder(32768); return GetLongPathName(source,b,(uint)b.Capacity)>0 ? b.ToString() : source; }
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  public struct Rect { public int Left, Top, Right, Bottom; }
  public static string Text(IntPtr hwnd) { var b=new StringBuilder(4096); if(Class(hwnd)=="Edit") ReadText(hwnd,0xD,(IntPtr)b.Capacity,b); else GetWindowText(hwnd,b,b.Capacity); return b.ToString(); }
  public static string Class(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,b.Capacity); return b.ToString(); }
  public static IntPtr[] Top(uint pid) { var items=new List<IntPtr>(); EnumWindows((h,d)=> { GetWindowThreadProcessId(h,out uint p); if(p==pid && IsWindowVisible(h))items.Add(h); return true; },IntPtr.Zero); return items.ToArray(); }
  public static IntPtr[] Children(IntPtr parent) { var items=new List<IntPtr>(); EnumChildWindows(parent,(h,d)=> { if(IsWindowVisible(h))items.Add(h); return true; },IntPtr.Zero); return items.ToArray(); }
  public static bool Radio(IntPtr hwnd) { int style=GetWindowLong(hwnd,-16)&15; return Class(hwnd)=="Button" && (style==4 || style==9); }
}
'@
$Installer = (Resolve-Path $Installer).Path
$Target = [IO.Path]::GetFullPath($Target)
$Out = [IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force $Out | Out-Null
function Assert($condition, $message) { if (!$condition) { throw $message } }
function Wait-Until([scriptblock]$Check, [int]$Seconds=60) {
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  do { $value=& $Check; if ($value) { return $value }; Start-Sleep -Milliseconds 300 } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for Windows installer/application state: $($Check.ToString())"
}
function Snapshot([IntPtr]$Window, [string]$Name) {
  [InstallerWindow]::SetForegroundWindow($Window) | Out-Null
  Start-Sleep -Milliseconds 500
  $rect=New-Object InstallerWindow+Rect
  [InstallerWindow]::GetWindowRect($Window,[ref]$rect) | Out-Null
  $bmp=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
  $g=[Drawing.Graphics]::FromImage($bmp); $dc=$g.GetHdc()
  try { [InstallerWindow]::PrintWindow($Window,$dc,2) | Out-Null } finally { $g.ReleaseHdc($dc); $g.Dispose() }
  $bmp.Save((Join-Path $Out "$Name.png")); $bmp.Dispose()
  # NSIS extracts these public source BMPs from its compressed payload. Preserve exact bytes
  # separately from the DPI/theme-dependent rendered control snapshots.
  foreach($directory in @(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue)) {
    if($directory.LastWriteTimeUtc -ge $wizardStarted.AddSeconds(-2)) {
      foreach($asset in @(Get-ChildItem $directory.FullName -Filter '*.bmp' -File -Recurse -ErrorAction SilentlyContinue)) {
        Copy-Item -LiteralPath $asset.FullName -Destination (Join-Path $Out "$Name-payload-$($directory.Name)-$($asset.Name)") -Force
      }
    }
  }
  $index=0
  foreach($child in @([InstallerWindow]::Children($Window))) {
    if([InstallerWindow]::Class($child) -eq 'Static') {
      $bitmapHandle=[InstallerWindow]::SendMessage($child,0x173,[IntPtr]::Zero,[IntPtr]::Zero)
      if($bitmapHandle -ne [IntPtr]::Zero) {
        # HBITMAPs belong to the installer process. Render the control through PrintWindow,
        # which asks that process to paint into our DC; never dereference its GDI handle here.
        $bounds=New-Object InstallerWindow+Rect
        [InstallerWindow]::GetWindowRect($child,[ref]$bounds) | Out-Null
        $image=New-Object Drawing.Bitmap ($bounds.Right-$bounds.Left),($bounds.Bottom-$bounds.Top)
        $graphics=[Drawing.Graphics]::FromImage($image); $context=$graphics.GetHdc()
        try { [InstallerWindow]::PrintWindow($child,$context,2) | Out-Null } finally { $graphics.ReleaseHdc($context); $graphics.Dispose() }
        try { $image.Save((Join-Path $Out "$Name-bitmap-$index.png")) } finally { $image.Dispose() }
        $index++
      }
    }
  }
}
function App-Windows {
  @(Get-Process -Name Meetfolio -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $Target 'Meetfolio.exe') -and $_.MainWindowHandle -ne 0 })
}
function Close-App {
  $apps=App-Windows
  foreach($item in $apps) { Wait-Until { [InstallerWindow]::Text($item.MainWindowHandle) -like 'Meetfolio Desktop*' } | Out-Null }
  $report.stages+='requesting normal title-bar close'
  foreach ($item in $apps) {
    [InstallerWindow]::SetForegroundWindow($item.MainWindowHandle) | Out-Null
    # SC_CLOSE is the same system command as clicking the real title-bar X.
    Assert ([InstallerWindow]::PostMessage($item.MainWindowHandle,0x112,[IntPtr]0xF060,[IntPtr]::Zero)) 'Windows rejected the normal close request'
  }
  Wait-Until {
    $alive=@($apps | Where-Object { $_.Refresh(); !$_.HasExited })
    $alive.Count -eq 0 -and @(App-Windows).Count -eq 0
  } | Out-Null
  $report.stages+='normal title-bar close exited the primary process'
}
$phase=if($Reinstall){'reinstall'}else{'fresh'}
if($AllUsers -or $ExpectAllUsers) { $phase="allusers-$phase" }
$report=@{phase=$phase; signed=$false; interactive=$true; silent=$false; stages=@(); runnerElevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
try {
  Assert (@(App-Windows).Count -eq 0) 'Test requires closed application'
  $previousApp=$null
  if($Reinstall) {
    Start-Process (Join-Path $Target 'Meetfolio.exe') | Out-Null
    $previousApp=Wait-Until { @(App-Windows) | Select-Object -First 1 }
    $report.stages+='reinstall began with the previous installed application running'
  }
  # No scope override: test the real default/previous-install detection. /D only chooses the test directory.
  $wizardStarted=[DateTime]::UtcNow
  $previousPath=$env:Path
  try {
    $env:Path="$env:SystemRoot\System32;$env:SystemRoot"
    $process=Start-Process -FilePath $Installer -ArgumentList "/LANG=2052 /D=$Target" -PassThru
  } finally { $env:Path=$previousPath }
  $window=Wait-Until { @([InstallerWindow]::Top([uint32]$process.Id) | Where-Object { [InstallerWindow]::Class($_) -eq '#32770' }) | Select-Object -First 1 }
  $scopeRecorded=$false; $directoryRecorded=$false; $finish=$false
  $clickedScope=$false; $clickedDirectory=$false; $mainInstallerWindow=$window
  $deadline=[DateTime]::UtcNow.AddMinutes(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    # Follow an NSIS modal close-running-app prompt without touching any UAC/security dialog.
    $active=@([InstallerWindow]::Top([uint32]$process.Id) | Where-Object { [InstallerWindow]::Class($_) -eq '#32770' -and [InstallerWindow]::IsWindowEnabled($_) }) | Select-Object -First 1
    if($active) { $window=$active }
    $children=@([InstallerWindow]::Children($window)); $labels=@($children | ForEach-Object { [InstallerWindow]::Text($_) })
    $radios=@($children | Where-Object { [InstallerWindow]::Radio($_) })
    if ($radios.Count -ge 2 -and !$scopeRecorded) {
      $selected=@($radios | Where-Object { [InstallerWindow]::SendMessage($_,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32() -eq 1 })
      Assert ($selected.Count -eq 1) 'Scope must select exactly one default'
      $label=[InstallerWindow]::Text($selected[0])
      if($ExpectAllUsers) { Assert ($label -match '所有用户|all users|anyone') "Existing all-users install scope was not preserved: $label" }
      else { Assert ($label -match '仅为|当前用户|Only for me|Just for me') "Unexpected fresh/per-user reinstall default: $label" }
      if($AllUsers) {
        $choice=@($radios | Where-Object { [InstallerWindow]::Text($_) -match '所有用户|all users|anyone' })[0]
        [InstallerWindow]::SendMessage($choice,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
      }
      Snapshot $window "$phase-scope"
      $report.scopeDefault=$label; $scopeRecorded=$true
    }
    $edit=@($children | Where-Object { [InstallerWindow]::Class($_) -eq 'Edit' -and [InstallerWindow]::Text($_) -like '*Meetfolio*' })
    if ($edit.Count -gt 0 -and !$directoryRecorded) {
      $actual=[InstallerWindow]::Text($edit[0]); Assert ($actual -eq $Target) "Installation path changed: $actual"
      Snapshot $window "$phase-directory"; $directoryRecorded=$true
    }
    $run=@($children | Where-Object { [InstallerWindow]::Class($_) -eq 'Button' -and [InstallerWindow]::Text($_) -match '运行.*Meetfolio|Run.*Meetfolio|启动.*Meetfolio|執行.*Meetfolio' })
    if ($run.Count -eq 1) {
      Assert ([InstallerWindow]::SendMessage($run[0],0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32() -eq 1) 'Run Meetfolio must be checked by default'
      Assert (@(App-Windows).Count -eq 0) 'Meetfolio launched before the installer Finish action'
      if($previousApp) { $previousApp.Refresh(); Assert $previousApp.HasExited 'Previous app process was not closed before completing reinstall' }
      Snapshot $window "$phase-finish"
      $next=[InstallerWindow]::GetDlgItem($window,1)
      [InstallerWindow]::PostMessage($next,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
      $finish=$true; break
    }
    $next=[InstallerWindow]::GetDlgItem($window,1)
    $nextLabel=[InstallerWindow]::Text($next)
    $advanceScope=$scopeRecorded -and !$clickedScope -and $radios.Count -ge 2
    $advanceDirectory=$directoryRecorded -and !$clickedDirectory -and $edit.Count -gt 0
    $confirmClose=$window -ne $mainInstallerWindow -and $nextLabel -match '确定|重试|OK|Retry|確認'
    if ([InstallerWindow]::IsWindowEnabled($next) -and ($advanceScope -or $advanceDirectory -or $confirmClose)) {
      if($advanceScope) { $clickedScope=$true }
      if($advanceDirectory) { $clickedDirectory=$true }
      [InstallerWindow]::PostMessage($next,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
    }
    # Never post a second Next while the next page is still being created/populated.
    Start-Sleep -Milliseconds 300
  }
  Assert $finish 'The real installer finish/run page was never reached'
  Assert $scopeRecorded 'Installation scope page not observed'
  Assert $directoryRecorded 'Installation directory page not observed'
  Wait-Until { $process.Refresh(); $process.HasExited } | Out-Null
  Assert ($process.ExitCode -eq 0) "Installer exited $($process.ExitCode)"
  $app=Wait-Until { @(App-Windows) | Select-Object -First 1 }
  Start-Sleep -Seconds 5
  Assert (@(App-Windows).Count -eq 1) 'Expected exactly one visible Meetfolio window after Finish'
  $report.stages+='interactive Finish launched exactly one installed Meetfolio window, not before completion'
  Snapshot $app.MainWindowHandle "$phase-launched-app"
  $iconHandle=[InstallerWindow]::SendMessage($app.MainWindowHandle,0x7F,[IntPtr]1,[IntPtr]::Zero)
  Assert ($iconHandle -ne [IntPtr]::Zero) 'Application window has no explicit icon'
  $icon=[Drawing.Icon]::FromHandle($iconHandle).Clone()
  $iconBitmap=$icon.ToBitmap(); $iconBitmap.Save((Join-Path $Out "$phase-window-icon.png")); $iconBitmap.Dispose(); $icon.Dispose()
  # A second normal launch must focus the same instance, not create another browser process/window.
  $second=Start-Process (Join-Path $Target 'Meetfolio.exe') -PassThru
  Wait-Until { $second.Refresh(); $second.HasExited } | Out-Null
  Assert (@(App-Windows).Count -eq 1) 'Second launch created duplicate windows'
  Assert ((App-Windows)[0].Id -eq $app.Id) 'Single-instance primary process changed'
  $report.stages+='second normal launch preserved original single-instance process'
  # Installer creates shortcuts to the branded executable; no startup shortcut is allowed.
  # IShellLinkW retains Unicode; the legacy WScript shortcut property can return ANSI question marks.
  $desktopFolder=if($AllUsers -or $ExpectAllUsers){'CommonDesktopDirectory'}else{'Desktop'}
  $programsFolder=if($AllUsers -or $ExpectAllUsers){'CommonPrograms'}else{'Programs'}
  $shortcuts=@((Join-Path ([Environment]::GetFolderPath($desktopFolder)) 'Meetfolio.lnk'), (Join-Path ([Environment]::GetFolderPath($programsFolder)) 'Meetfolio.lnk'))
  $report.shortcuts=@()
  foreach($file in $shortcuts) {
    Assert (Test-Path $file) "Shortcut missing: $file"
    $link=[InstallerWindow]::Shortcut($file)
    $expectedTarget=Join-Path $Target 'Meetfolio.exe'
    Assert ([InstallerWindow]::LongPath($link.TargetPath) -eq [InstallerWindow]::LongPath($expectedTarget)) "Wrong shortcut target: $file actual=[$($link.TargetPath)] expected=[$expectedTarget]"
    $iconParts=$link.IconLocation -split ',(?=\s*0$)'
    Assert ($iconParts.Count -eq 2 -and [InstallerWindow]::LongPath($iconParts[0]) -eq [InstallerWindow]::LongPath($expectedTarget)) "Wrong shortcut icon: $($link.IconLocation) expected=[$expectedTarget,0]"
    $folder=(New-Object -ComObject Shell.Application).Namespace([IO.Path]::GetDirectoryName($file))
    $appId=$folder.ParseName([IO.Path]::GetFileName($file)).ExtendedProperty('System.AppUserModel.ID')
    Assert ($appId -eq 'org.meetfolio.desktop') "Shortcut taskbar grouping identity mismatch: $appId"
    $report.shortcuts+=@{name=[IO.Path]::GetFileName($file);target=$link.TargetPath;icon=$link.IconLocation;appUserModelId=$appId}
  }
  Assert (!(Test-Path (Join-Path ([Environment]::GetFolderPath('Startup')) 'Meetfolio.lnk'))) 'Unexpected login startup shortcut'
  $runKeys=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run')
  foreach($key in $runKeys) { if(Test-Path $key) { Assert ((Get-Item $key).GetValueNames() -notcontains 'Meetfolio') 'Unexpected login Run registry value' } }
  $hive=if($AllUsers -or $ExpectAllUsers){'HKLM:'}else{'HKCU:'}
  $uninstall=Get-ChildItem "$hive\Software\Microsoft\Windows\CurrentVersion\Uninstall" | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Meetfolio 0.1.0' }
  Assert ($null -ne $uninstall) 'Uninstall registration missing for chosen scope'
  Assert ($uninstall.UninstallString -and $uninstall.UninstallString.Contains((Join-Path $Target 'Uninstall Meetfolio.exe'))) 'Uninstall registry path does not match selected scope/path'
  $report.registrationHive=$hive
  $report.stages+='selected-scope registration, desktop/Start shortcuts point to branded EXE; no login startup persistence'
  Close-App
  $report.stages+='requesting normal restart'
  $third=Start-Process (Join-Path $Target 'Meetfolio.exe') -PassThru
  $app=Wait-Until { @(App-Windows) | Select-Object -First 1 }
  Assert (@(App-Windows).Count -eq 1) 'Normal restart failed'
  Close-App
  $report.stages+='normal window close and restart succeeded'
  $report.signatures=@()
  foreach($file in @($Installer,(Join-Path $Target 'Meetfolio.exe'),(Join-Path $Target 'Uninstall Meetfolio.exe'))) {
    $signature=Get-AuthenticodeSignature -FilePath $file
    Assert ($signature.Status -eq 'NotSigned') "Expected explicitly unsigned review candidate: $file $($signature.Status)"
    $report.signatures+=@{file=[IO.Path]::GetFileName($file);status=$signature.Status.ToString()}
  }
  $report.result='passed'
} catch {
  $report.result='failed'; $report.error=$_.ToString()
  $report.remainingWindows=@()
  foreach($item in @(App-Windows)) {
    $handle=$item.MainWindowHandle
    $report.remainingWindows+=@{pid=$item.Id;title=[InstallerWindow]::Text($handle);class=[InstallerWindow]::Class($handle);
      topWindows=@([InstallerWindow]::Top([uint32]$item.Id) | ForEach-Object { @{title=[InstallerWindow]::Text($_);class=[InstallerWindow]::Class($_);enabled=[InstallerWindow]::IsWindowEnabled($_);controls=@([InstallerWindow]::Children($_) | ForEach-Object { [InstallerWindow]::Text($_) })} });
      controls=@([InstallerWindow]::Children($handle) | ForEach-Object { [InstallerWindow]::Text($_) })}
    try {
      $name="$phase-app-failure"
      Snapshot $handle $name
      $imagePath=Join-Path $Out "$name.png"
      if((Get-Item $imagePath).Length -lt 1MB) {
        Write-Host ('MEETFOLIO_PREVIEW:'+$name+':'+[Convert]::ToBase64String([IO.File]::ReadAllBytes($imagePath)))
      }
    } catch {}
  }
  if($window){ try{Snapshot $window "$phase-failure"}catch{} }
  throw
} finally {
  $report | ConvertTo-Json -Depth 8 | Tee-Object -FilePath (Join-Path $Out "$phase-installer.json")
  if($phase -eq 'fresh' -and $report.result -eq 'passed') {
    # Small, public-fixture previews allow review without downloading the entire installer ZIP.
    foreach($name in @('fresh-scope','fresh-finish','fresh-launched-app')) {
      $imagePath=Join-Path $Out "$name.png"
      if((Get-Item $imagePath).Length -lt 1MB) {
        Write-Host ('MEETFOLIO_PREVIEW:'+$name+':'+[Convert]::ToBase64String([IO.File]::ReadAllBytes($imagePath)))
      }
    }
  }
}
