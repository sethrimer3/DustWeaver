[CmdletBinding()]
param([string]$RepositoryRoot)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')
try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    $paths = Get-AutosyncPaths $RepositoryRoot
    if (-not (Test-Path -LiteralPath $paths.PauseMarker)) { New-Item -ItemType File -Path $paths.PauseMarker | Out-Null }
    $lockState = Get-AutosyncLockState $paths.RunningLock
    Write-Host 'DustWeaver auto-sync is paused.'
    Write-Host "Running state: $($lockState.Detail)."
    exit 0
} catch { Write-Error "Could not pause DustWeaver auto-sync: $($_.Exception.Message)"; exit 1 }
