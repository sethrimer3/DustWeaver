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
        return [pscustomobject]@{ Exists = $false; Active = $false; Stale = $false; Detail = 'no lock' }
    }
    try {
        $lock = Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $processId = [int]$lock.pid
        $expectedStart = [DateTime]::Parse([string]$lock.processStartUtc).ToUniversalTime()
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            return [pscustomobject]@{ Exists = $true; Active = $false; Stale = $true; Detail = "PID $processId is no longer running" }
        }
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $expectedStart).TotalSeconds) -le 2) {
            return [pscustomobject]@{ Exists = $true; Active = $true; Stale = $false; Detail = "active PID $processId" }
        }
        return [pscustomobject]@{ Exists = $true; Active = $false; Stale = $true; Detail = "PID $processId was reused" }
    } catch {
        return [pscustomobject]@{ Exists = $true; Active = $false; Stale = $false; Detail = 'lock metadata is unreadable; ownership is unknown' }
    }
}

function Test-GitOperationInProgress {
    param([Parameter(Mandatory)][string]$GitDirectory)
    $markers = @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')
    return [bool]($markers | Where-Object { Test-Path -LiteralPath (Join-Path $GitDirectory $_) } | Select-Object -First 1)
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
