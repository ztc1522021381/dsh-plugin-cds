Add-Type -AssemblyName System.Drawing, System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Cap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
'@
Add-Type -TypeDefinition $sig
[void][Cap]::SetProcessDPIAware()

$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*DeepSeek Harness*' } | Select-Object -First 1
if ($null -eq $p) { Write-Output 'NO WINDOW'; exit 1 }
$h = $p.MainWindowHandle
Write-Output "pid=$($p.Id) title=$($p.MainWindowTitle)"

[void][Cap]::ShowWindow($h, 9)
[void][Cap]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 900

$r = New-Object Cap+RECT
[void][Cap]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L
$hh = $r.B - $r.T
Write-Output "rect L=$($r.L) T=$($r.T) R=$($r.R) B=$($r.B)  ${w}x${hh}"

$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$out = $args[0]
if ([string]::IsNullOrEmpty($out)) { $out = 'E:\Desktop\DeepSeek\DSH work\cds-dsh\preview\live-now.png' }
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "SAVED $out $((Get-Item $out).Length) B"
