[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [int]$GitTimeoutSeconds = 60,
    [switch]$TestForceIndexRestoreFailure
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')

function Stop-IfPaused($Paths) {
    $pauseState = Get-AutosyncPauseState $Paths
    if ($pauseState.Paused) {
        $reasons = @()
        if ($pauseState.EmergencyPause) { $reasons += 'emergency marker' }
        if ($pauseState.Leases.Count -gt 0) { $reasons += "$($pauseState.Leases.Count) agent lease(s)" }
        Write-Host "DustWeaver auto-sync is paused by $($reasons -join ' and ')."
        return $true
    }
    return $false
}

function Invoke-CheckedGit {
    param([string[]]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds = 60)
    $job = Start-Job -ScriptBlock {
        param($Directory, $GitArguments)
        Set-Location -LiteralPath $Directory
        $env:GIT_TERMINAL_PROMPT = '0'
        $env:GIT_ASKPASS = 'echo'
        $output = & git @GitArguments 2>&1 | Out-String
        [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
    } -ArgumentList $WorkingDirectory, $Arguments
    if (-not (Wait-Job $job -Timeout $TimeoutSeconds)) {
        Stop-Job $job | Out-Null
        Remove-Job $job -Force | Out-Null
        throw "git $($Arguments -join ' ') timed out after $TimeoutSeconds seconds"
    }
    $result = Receive-Job $job
    $state = $job.State
    Remove-Job $job -Force | Out-Null
    if ($state -ne 'Completed' -or $null -eq $result -or $result.ExitCode -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $($result.ExitCode): $($result.Output)"
    }
    return $result.Output
}

$lockOwned = $false
$paths = $null
$indexBackup = $null
$indexExistedBeforeStaging = $false
$stagingOccurred = $false
$commitSucceeded = $false
$indexRestored = $false
$preserveIndexBackup = $false

function Restore-OriginalIndex {
    if (-not $script:stagingOccurred -or $script:commitSucceeded -or $script:indexRestored) { return }
    $indexPath = Join-Path $script:paths.GitDirectory 'index'
    try {
        if ($TestForceIndexRestoreFailure) {
            throw 'test-only forced index restoration failure'
        }
        if ($script:indexExistedBeforeStaging) {
            if (-not (Test-Path -LiteralPath $script:indexBackup -PathType Leaf)) {
                throw "index backup is missing: '$($script:indexBackup)'"
            }
            Copy-Item -LiteralPath $script:indexBackup -Destination $indexPath -Force -ErrorAction Stop
        } elseif (Test-Path -LiteralPath $indexPath) {
            Remove-Item -LiteralPath $indexPath -Force -ErrorAction Stop
        }
        $script:indexRestored = $true
        Remove-Item -LiteralPath $script:indexBackup -Force -ErrorAction Stop
        $script:indexBackup = $null
    } catch {
        $script:preserveIndexBackup = $true
        if ($null -ne $script:paths -and -not (Test-Path -LiteralPath $script:paths.PauseMarker)) {
            New-Item -ItemType File -Path $script:paths.PauseMarker -Force -ErrorAction SilentlyContinue | Out-Null
        }
        throw "INDEX RESTORATION FAILED. Auto-sync remains paused. Preserve and recover from '$($script:indexBackup)'. $($_.Exception.Message)"
    }
}

try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    [void](Test-DustWeaverRepositoryIdentity $RepositoryRoot -ThrowOnFailure)
    $paths = Get-AutosyncPaths $RepositoryRoot

    # Gate 1: before locking or staging.
    if (Stop-IfPaused $paths) { exit 0 }
    $lockState = Get-AutosyncLockState $paths.RunningLock
    if ($lockState.Exists) {
        Write-Host "DustWeaver auto-sync did not start: $($lockState.Detail). Locks are never removed automatically."
        exit 0
    }

    $lockData = @{
        pid = $PID
        processStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
        createdUtc = [DateTime]::UtcNow.ToString('o')
        repository = $RepositoryRoot
    } | ConvertTo-Json -Compress
    try {
        $writer = $null
        $stream = [IO.File]::Open($paths.RunningLock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $writer = New-Object IO.StreamWriter($stream)
            $writer.Write($lockData)
            $writer.Flush()
        } finally {
            if ($null -ne $writer) { $writer.Dispose() } else { $stream.Dispose() }
        }
        $lockOwned = $true
    } catch [IO.IOException] {
        Write-Host 'DustWeaver auto-sync did not start because another instance acquired the lock.'
        exit 0
    }

    if (Stop-IfPaused $paths) { exit 0 }
    $branch = Get-CurrentGitBranch $RepositoryRoot
    if ($branch -ne 'main') {
        Write-Host "DustWeaver auto-sync refused to run on branch '$branch'; main is required."
        exit 0
    }
    if (Test-GitOperationInProgress $paths.GitDirectory) { throw 'a Git operation is already active' }

    $status = & git -C $RepositoryRoot status --porcelain 2>$null
    if ($LASTEXITCODE -ne 0) { throw "git status failed: $($status -join [Environment]::NewLine)" }
    if ($status) {
        $indexPath = Join-Path $paths.GitDirectory 'index'
        $indexBackup = Join-Path $paths.GitDirectory "AUTOSYNC_INDEX_BACKUP_$PID"
        $indexExistedBeforeStaging = Test-Path -LiteralPath $indexPath
        if ($indexExistedBeforeStaging) {
            Copy-Item -LiteralPath $indexPath -Destination $indexBackup -ErrorAction Stop
        }
        $stagingOccurred = $true
        Invoke-CheckedGit @('add', '-A') $RepositoryRoot $GitTimeoutSeconds | Out-Null

        # Gate 2: immediately before commit. If pause appeared after staging,
        # restore the exact pre-sync index; working-tree content is preserved.
        if (Stop-IfPaused $paths) {
            Restore-OriginalIndex
            exit 0
        }
        & git -C $RepositoryRoot diff --cached --quiet
        if ($LASTEXITCODE -eq 1) {
            Invoke-CheckedGit @('commit', '-m', "Auto-sync $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')") $RepositoryRoot $GitTimeoutSeconds | Out-Null
            $commitSucceeded = $true
            Remove-Item -LiteralPath $indexBackup -Force -ErrorAction Stop
            $indexBackup = $null
        } elseif ($LASTEXITCODE -ne 0) { throw 'git diff --cached --quiet failed' }
    }

    # Gate 3: immediately before network synchronization and again before push.
    if (Stop-IfPaused $paths) { exit 0 }
    Invoke-CheckedGit @('pull', '--rebase', 'origin', 'main') $RepositoryRoot $GitTimeoutSeconds | Out-Null
    if (Test-GitOperationInProgress $paths.GitDirectory) { throw 'pull left an unresolved Git operation; push is blocked' }
    if (Stop-IfPaused $paths) { exit 0 }
    $ahead = & git -C $RepositoryRoot rev-list --count '@{u}..HEAD' 2>&1
    if ($LASTEXITCODE -ne 0) { throw "could not determine upstream divergence: $($ahead -join [Environment]::NewLine)" }
    if ([int]($ahead | Select-Object -Last 1) -gt 0) {
        Invoke-CheckedGit @('push', 'origin', 'main') $RepositoryRoot $GitTimeoutSeconds | Out-Null
    }
    Write-Host 'DustWeaver auto-sync completed successfully.'
    exit 0
} catch {
    $originalError = $_.Exception.Message
    try {
        Restore-OriginalIndex
    } catch {
        Write-Error "DustWeaver auto-sync stopped unsafely: $($_.Exception.Message)"
        exit 1
    }
    Write-Error "DustWeaver auto-sync stopped safely: $originalError"
    exit 1
} finally {
    if ($lockOwned -and $null -ne $paths -and (Test-Path -LiteralPath $paths.RunningLock)) {
        Remove-Item -LiteralPath $paths.RunningLock -Force -ErrorAction SilentlyContinue
    }
    if (-not $preserveIndexBackup -and $indexBackup -and (Test-Path -LiteralPath $indexBackup)) {
        Remove-Item -LiteralPath $indexBackup -Force -ErrorAction SilentlyContinue
    }
}
