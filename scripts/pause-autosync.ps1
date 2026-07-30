[CmdletBinding()]
param([string]$RepositoryRoot, [ValidateRange(0, 3600)][int]$WaitTimeoutSeconds = 90)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')
try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    [void](Test-DustWeaverRepositoryIdentity $RepositoryRoot -ThrowOnFailure)
    $paths = Get-AutosyncPaths $RepositoryRoot
    if (-not (Test-Path -LiteralPath $paths.PauseMarker)) {
        New-Item -ItemType File -Path $paths.PauseMarker -ErrorAction Stop | Out-Null
    }
    if (-not (Test-Path -LiteralPath $paths.PauseMarker -PathType Leaf)) {
        throw "pause marker was not created at '$($paths.PauseMarker)'"
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitTimeoutSeconds)
    while ($true) {
        $lockState = Get-AutosyncLockState $paths.RunningLock
        if (-not $lockState.Exists) {
            Write-Host 'DustWeaver auto-sync is paused and quiescent. It is safe to begin editing.'
            exit 0
        }
        if (-not $lockState.Active) {
            Write-Error "Pause marker created, but auto-sync is not quiescent. $(Get-AutosyncManualLockRecoveryMessage $paths.RunningLock $lockState)"
            exit 1
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            Write-Error "Pause was requested, but auto-sync is still running ($($lockState.Detail)) after $WaitTimeoutSeconds seconds. Do not begin editing. The pause marker remains at '$($paths.PauseMarker)'."
            exit 1
        }
        Write-Host "Waiting for DustWeaver auto-sync to finish ($($lockState.Detail))..."
        Start-Sleep -Seconds 1
    }
} catch { Write-Error "Could not pause DustWeaver auto-sync: $($_.Exception.Message)"; exit 1 }
