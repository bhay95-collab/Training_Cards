<#
  Opens the Training Card in Microsoft Edge as a clean app window (no address bar or tabs).

    -Layout Single   one window filling the second screen
    -Layout Dual     two windows: left half and right half of the second screen

  Opens on the second screen. If the PC has only one screen, opens on that.

  Where it looks for TrainingCard.html (first one found wins):
    1. -CardPath, if given
    2. the folder that holds the .bat file
    3. this Assets folder
    4. the current user's Desktop

  Each window uses its own small Edge profile under %LOCALAPPDATA%\TrainingCard, so the
  windows can be placed exactly. Running a launcher again closes its old windows first,
  so every class starts with a fresh card.
#>
param(
  [ValidateSet('Single', 'Dual')][string]$Layout = 'Single',
  [string]$CardPath = '',
  [string]$Url = ''        # the live site; when set, opens it instead of the local file
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TCWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
}
"@
# Work in real screen pixels so the halves line up on scaled (125% / 150%) displays.
[TCWin]::SetProcessDPIAware() | Out-Null

function Fail($message) {
  [System.Windows.Forms.MessageBox]::Show($message, 'Training Card', 'OK', 'Warning') | Out-Null
  exit 1
}

# ---------- Find the card ----------
$live = [bool]$Url
$batFolder = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$card = @($CardPath,
          (Join-Path $batFolder 'TrainingCard.html'),
          (Join-Path $PSScriptRoot 'TrainingCard.html'),
          (Join-Path $desktop 'TrainingCard.html')) |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if ($live) {
  $url = $Url
} elseif (-not $card) {
  Fail "Can't find TrainingCard.html.`n`nPut it on the Desktop, or in the same folder as this launcher."
} else {
  $url = ([System.Uri](Resolve-Path -LiteralPath $card).Path).AbsoluteUri
}

# ---------- Find Edge ----------
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
          "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $edge) { Fail "Can't find Microsoft Edge on this PC." }

# ---------- Helpers ----------
function Get-ProfileProcesses($dir) {
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dir) }
}

function Close-Profile($dir) {
  $old = @(Get-ProfileProcesses $dir)
  if ($old.Count) {
    $old | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800   # let Edge release the profile
  }
}

function Find-Window($proc, $dir) {
  for ($i = 0; $i -lt 80; $i++) {   # up to ~20 seconds
    Start-Sleep -Milliseconds 250
    if (-not $proc.HasExited) {
      $proc.Refresh()
      if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc.MainWindowHandle }
    }
    foreach ($p in Get-ProfileProcesses $dir) {
      $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
      if ($gp -and $gp.MainWindowHandle -ne [IntPtr]::Zero) { return $gp.MainWindowHandle }
    }
  }
  return [IntPtr]::Zero
}

# Move a window so its VISIBLE edges sit exactly on x/y/w/h
# (Windows 10/11 windows have invisible borders that would otherwise leave gaps).
function Set-WindowBox($hwnd, [int]$x, [int]$y, [int]$w, [int]$h) {
  [TCWin]::ShowWindow($hwnd, 9) | Out-Null          # restore if minimised/maximised
  [TCWin]::MoveWindow($hwnd, $x, $y, $w, $h, $true) | Out-Null
  $outer = New-Object TCWin+RECT
  $frame = New-Object TCWin+RECT
  [TCWin]::GetWindowRect($hwnd, [ref]$outer) | Out-Null
  if ([TCWin]::DwmGetWindowAttribute($hwnd, 9, [ref]$frame, 16) -eq 0) {
    $l = $frame.Left - $outer.Left; $t = $frame.Top - $outer.Top
    $r = $outer.Right - $frame.Right; $b = $outer.Bottom - $frame.Bottom
    [TCWin]::MoveWindow($hwnd, $x - $l, $y - $t, $w + $l + $r, $h + $t + $b, $true) | Out-Null
  }
}

function Open-Card($name, [int]$seat = 1) {
  # Live windows each get their own profile AND seat number, so every screen is its own trainee.
  $profileName = if ($live) { "Live-$name" } else { $name }
  $target = if ($live) { $url.Split('#')[0].TrimEnd('?') + "?seat=$seat" } else { $url }
  $dir = Join-Path $env:LOCALAPPDATA "TrainingCard\Edge-$profileName"
  Close-Profile $dir
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $arguments = @(
    "--user-data-dir=`"$dir`"",
    "--app=`"$target`"",
    '--no-first-run',
    '--no-default-browser-check'
  )
  $proc = Start-Process -FilePath $edge -ArgumentList $arguments -PassThru
  $hwnd = Find-Window $proc $dir
  if ($hwnd -eq [IntPtr]::Zero) { Fail "Edge opened, but the Training Card window didn't appear in time. Try again." }
  return $hwnd
}

# ---------- Open ----------
# Use the second screen (the first one that isn't the main screen, left to right).
# If this PC only has one screen, use that.
$screen = [System.Windows.Forms.Screen]::AllScreens |
  Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X } | Select-Object -First 1
if (-not $screen) { $screen = [System.Windows.Forms.Screen]::PrimaryScreen }
$area = $screen.WorkingArea   # that screen minus any taskbar

if ($Layout -eq 'Single') {
  $win = Open-Card 'Full'
  Set-WindowBox $win $area.X $area.Y $area.Width $area.Height
  [TCWin]::ShowWindow($win, 3) | Out-Null                         # maximise
  [TCWin]::SetForegroundWindow($win) | Out-Null
}
else {
  $half = [math]::Floor($area.Width / 2)
  $left = Open-Card 'Left' 1
  Set-WindowBox $left $area.X $area.Y $half $area.Height
  $right = Open-Card 'Right' 2
  Set-WindowBox $right ($area.X + $half) $area.Y ($area.Width - $half) $area.Height
  [TCWin]::SetForegroundWindow($left) | Out-Null
}
