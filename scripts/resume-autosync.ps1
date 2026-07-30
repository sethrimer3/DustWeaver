[CmdletBinding()]
param([string]$RepositoryRoot, [string]$LeaseId)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')
try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    [void](Test-DustWeaverRepositoryIdentity $RepositoryRoot -ThrowOnFailure)
    $paths = Get-AutosyncPaths $RepositoryRoot
    if (Test-GitOperationInProgress $paths.GitDirectory) { throw 'an unresolved merge, rebase, cherry-pick, or revert is active' }
    $branch = Get-CurrentGitBranch $RepositoryRoot
    if ($branch -ne 'main') { throw "the current branch is '$branch', not 'main'" }
    $lockState = Get-AutosyncLockState $paths.RunningLock
    if ($lockState.Active) { throw "the auto-sync lock belongs to an $($lockState.Detail)" }
    if ($lockState.Exists) { throw "the auto-sync lock still exists ($($lockState.Detail)); review it manually before resuming" }
    if (Test-WorkingTreeDirty $RepositoryRoot) { Write-Warning 'The working tree is dirty. Resume is allowed, but the next scheduled run may commit these changes.' }
    if ($LeaseId) {
        $leasePath = Get-AutosyncLeasePath $paths.PauseLeasesDirectory $LeaseId
        if (Test-Path -LiteralPath $leasePath) { Remove-Item -LiteralPath $leasePath -ErrorAction Stop }
    } elseif (Test-Path -LiteralPath $paths.PauseMarker) {
        Remove-Item -LiteralPath $paths.PauseMarker -ErrorAction Stop
    }
    $pauseState = Get-AutosyncPauseState $paths
    if ($pauseState.Paused) {
        $remaining = @($pauseState.Leases | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) })
        $reasons = @()
        if ($pauseState.EmergencyPause) { $reasons += 'emergency marker' }
        if ($remaining.Count -gt 0) { $reasons += "leases: $($remaining -join ', ')" }
        Write-Host "Released $(if ($LeaseId) { "lease '$LeaseId'" } else { 'the emergency marker' }); DustWeaver auto-sync remains paused by $($reasons -join '; ')."
    } else {
        Write-Host 'DustWeaver auto-sync is active and will resume on its next scheduled run.'
    }
    exit 0
} catch { Write-Error "Refusing to resume DustWeaver auto-sync: $($_.Exception.Message)"; exit 1 }
