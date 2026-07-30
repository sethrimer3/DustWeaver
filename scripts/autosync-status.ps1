[CmdletBinding()]
param([string]$RepositoryRoot, [string]$ScheduledTaskName = '\SyncGithubRepos')
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')
try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    $paths = Get-AutosyncPaths $RepositoryRoot
    $paused = Test-Path -LiteralPath $paths.PauseMarker
    $branch = Get-CurrentGitBranch $RepositoryRoot
    $dirty = Test-WorkingTreeDirty $RepositoryRoot
    $operation = Test-GitOperationInProgress $paths.GitDirectory
    $lockState = Get-AutosyncLockState $paths.RunningLock
    $lastCommit = & git -C $RepositoryRoot log -1 --date=iso --pretty=format:'%h %ad %s' --grep='^Auto-sync' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $lastCommit) { $lastCommit = 'none found' }
    $scheduledTask = 'unavailable'
    try {
        $taskOutput = & schtasks.exe /Query /TN $ScheduledTaskName /FO LIST /V 2>$null
        if ($LASTEXITCODE -eq 0) {
            $stateLine = $taskOutput | Where-Object { $_ -match '^(Scheduled Task State|Status):' } | Select-Object -First 1
            $scheduledTask = if ($stateLine) { ($stateLine -split ':', 2)[1].Trim() } else { 'present (state unknown)' }
        } else { $scheduledTask = 'not found or inaccessible' }
    } catch { $scheduledTask = 'not queryable' }
    Write-Host "Auto-sync: $(if ($paused) { 'paused' } else { 'active' })"
    Write-Host "Branch: $branch"
    Write-Host "Working tree: $(if ($dirty) { 'dirty' } else { 'clean' })"
    Write-Host "Git operation: $(if ($operation) { 'merge/rebase/cherry-pick/revert active' } else { 'none' })"
    Write-Host "Running lock: $($lockState.Detail)"
    Write-Host "Scheduled task $ScheduledTaskName`: $scheduledTask"
    Write-Host "Last auto-sync commit: $lastCommit"
    exit 0
} catch { Write-Error "Could not inspect DustWeaver auto-sync: $($_.Exception.Message)"; exit 1 }
