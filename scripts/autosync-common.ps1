Set-StrictMode -Version Latest

function Get-DustWeaverRepositoryRoot {
    param([string]$StartPath = $PSScriptRoot)
    $candidate = Get-Item -LiteralPath (Resolve-Path -LiteralPath $StartPath -ErrorAction Stop).Path
    if (-not $candidate.PSIsContainer) { $candidate = $candidate.Directory }
    while ($null -ne $candidate) {
        if (Test-Path -LiteralPath (Join-Path $candidate.FullName '.git')) { return $candidate.FullName }
        $candidate = $candidate.Parent
    }
    throw "Could not locate a Git repository above '$StartPath'."
}

function Get-NormalizedGitHubRepository {
    param([string]$RemoteUrl)
    if (-not $RemoteUrl) { return $null }
    $normalized = $RemoteUrl.Trim() -replace '\\', '/'
    if ($normalized -match '^(?:https?://github\.com/|git@github\.com:|ssh://git@github\.com/)(?<repo>[^/]+/[^/]+?)(?:\.git)?/?$') {
        return $Matches.repo.ToLowerInvariant()
    }
    return $null
}

function Test-DustWeaverRepositoryIdentity {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [switch]$ThrowOnFailure
    )
    $resolvedRoot = [IO.Path]::GetFullPath($RepositoryRoot)
    # Read the configured value rather than `git remote get-url`, which applies
    # url.*.insteadOf rewrites and can hide the repository's declared identity.
    $remoteOutput = & git -C $resolvedRoot config --get remote.origin.url 2>$null
    $remote = if ($LASTEXITCODE -eq 0) { [string]($remoteOutput | Select-Object -Last 1) } else { '<missing origin>' }
    $normalizedRemote = Get-NormalizedGitHubRepository $remote
    $requiredFiles = @('AGENTS.md', 'src/build-info.ts', 'scripts/autosync.ps1')
    $missingFiles = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $resolvedRoot $_) -PathType Leaf) })
    $packageName = $null
    $packagePath = Join-Path $resolvedRoot 'package.json'
    if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
        try { $packageName = [string]((Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).name) } catch { $packageName = '<unreadable>' }
    }
    $valid = $normalizedRemote -eq 'sethrimer3/dustweaver' -and
        $missingFiles.Count -eq 0 -and
        $packageName -eq 'dustweaver'
    $result = [pscustomobject]@{
        Valid = $valid
        RepositoryRoot = $resolvedRoot
        Remote = $remote
        NormalizedRemote = $normalizedRemote
        MissingFiles = $missingFiles
        PackageName = $packageName
    }
    if (-not $valid -and $ThrowOnFailure) {
        throw "DustWeaver repository identity check failed. Resolved path: '$resolvedRoot'. Detected origin: '$remote'. Missing expected files: '$($missingFiles -join ', ')'. Package name: '$packageName'."
    }
    return $result
}

function Get-AutosyncPaths {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $gitDirOutput = & git -C $RepositoryRoot rev-parse --git-dir 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Could not resolve the Git directory: $($gitDirOutput -join [Environment]::NewLine)" }
    $gitDir = [string]($gitDirOutput | Select-Object -Last 1)
    if (-not [IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $RepositoryRoot $gitDir }
    $gitDir = [IO.Path]::GetFullPath($gitDir)
    return @{
        GitDirectory = $gitDir
        PauseMarker = Join-Path $gitDir 'AUTOSYNC_PAUSED'
        RunningLock = Join-Path $gitDir 'AUTOSYNC_RUNNING'
    }
}

function Get-AutosyncLockState {
    param([Parameter(Mandatory)][string]$LockPath)
    if (-not (Test-Path -LiteralPath $LockPath)) {
        return [pscustomobject]@{ Exists = $false; Active = $false; Stale = $false; Readable = $true; Detail = 'no lock'; ProcessId = $null; ProcessStartUtc = $null; CreatedUtc = $null; Repository = $null }
    }
    try {
        $lock = Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $processId = [int]$lock.pid
        $expectedStart = [DateTime]::Parse([string]$lock.processStartUtc).ToUniversalTime()
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            return [pscustomobject]@{ Exists = $true; Active = $false; Stale = $true; Readable = $true; Detail = "PID $processId is no longer running"; ProcessId = $processId; ProcessStartUtc = $expectedStart; CreatedUtc = $lock.createdUtc; Repository = $lock.repository }
        }
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $expectedStart).TotalSeconds) -le 2) {
            return [pscustomobject]@{ Exists = $true; Active = $true; Stale = $false; Readable = $true; Detail = "active PID $processId"; ProcessId = $processId; ProcessStartUtc = $expectedStart; CreatedUtc = $lock.createdUtc; Repository = $lock.repository }
        }
        return [pscustomobject]@{ Exists = $true; Active = $false; Stale = $true; Readable = $true; Detail = "PID $processId was reused"; ProcessId = $processId; ProcessStartUtc = $expectedStart; CreatedUtc = $lock.createdUtc; Repository = $lock.repository }
    } catch {
        return [pscustomobject]@{ Exists = $true; Active = $false; Stale = $false; Readable = $false; Detail = 'lock metadata is unreadable; ownership is unknown'; ProcessId = $null; ProcessStartUtc = $null; CreatedUtc = $null; Repository = $null }
    }
}

function Get-AutosyncManualLockRecoveryMessage {
    param([Parameter(Mandatory)][string]$LockPath, [Parameter(Mandatory)]$LockState)
    return "Do not begin editing. Inspect '$LockPath' with Get-Content -LiteralPath '$LockPath'; confirm the recorded process is not running with Get-Process -Id <pid>; then remove only that exact stale lock with Remove-Item -LiteralPath '$LockPath'. Lock state: $($LockState.Detail)."
}

function Test-GitOperationInProgress {
    param([Parameter(Mandatory)][string]$GitDirectory)
    return (Get-GitOperationState $GitDirectory) -ne 'none'
}

function Get-GitOperationState {
    param([Parameter(Mandatory)][string]$GitDirectory)
    if (Test-Path -LiteralPath (Join-Path $GitDirectory 'MERGE_HEAD')) { return 'merge' }
    if ((Test-Path -LiteralPath (Join-Path $GitDirectory 'rebase-merge')) -or (Test-Path -LiteralPath (Join-Path $GitDirectory 'rebase-apply'))) { return 'rebase' }
    if (Test-Path -LiteralPath (Join-Path $GitDirectory 'CHERRY_PICK_HEAD')) { return 'cherry-pick' }
    if (Test-Path -LiteralPath (Join-Path $GitDirectory 'REVERT_HEAD')) { return 'revert' }
    return 'none'
}

function Get-CurrentGitBranch {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $branch = & git -C $RepositoryRoot branch --show-current 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Could not determine the current branch: $($branch -join [Environment]::NewLine)" }
    return [string]($branch | Select-Object -Last 1)
}

function Test-WorkingTreeDirty {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $status = & git -C $RepositoryRoot status --porcelain 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the working tree: $($status -join [Environment]::NewLine)" }
    return [bool]$status
}
