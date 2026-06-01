Start-Sleep -Seconds 1

$currentProcessId = $PID
$currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$currentProcessId"
if ($null -eq $currentProcess) {
  exit 0
}

$launcherProcess = Get-Process -Id $currentProcess.ParentProcessId -ErrorAction SilentlyContinue
if ($null -eq $launcherProcess -or $launcherProcess.MainWindowHandle -eq 0) {
  exit 0
}

Add-Type -Name WindowApi -Namespace DustWeaverLauncher -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@

[DustWeaverLauncher.WindowApi]::ShowWindow($launcherProcess.MainWindowHandle, 0) | Out-Null
