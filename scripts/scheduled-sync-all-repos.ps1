[CmdletBinding()]
param([string]$RepositoriesRoot = 'C:\Users\srime\Documents\GitHub')

$ErrorActionPreference = 'Continue'
$logFile = Join-Path $RepositoriesRoot 'sync-repos.log'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GIT_ASKPASS = 'echo'

function Write-SyncLog([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" |
        Out-File -FilePath $logFile -Append -Encoding utf8
}

function Invoke-GitWithTimeout {
    param([string[]]$GitArgs, [string]$WorkingDirectory, [int]$TimeoutSeconds = 60)
    $job = Start-Job -ScriptBlock {
        param($Directory, $Arguments)
        Set-Location $Directory
        $env:GIT_TERMINAL_PROMPT = '0'
        $env:GIT_ASKPASS = 'echo'
        & git @Arguments 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "git exited with code $LASTEXITCODE" }
    } -ArgumentList $WorkingDirectory, $GitArgs
    if (Wait-Job $job -Timeout $TimeoutSeconds) {
        $output = Receive-Job $job -ErrorAction Continue
        $state = $job.State
        Remove-Job $job -Force | Out-Null
        if ($state -ne 'Completed') { throw "git $($GitArgs -join ' ') failed: $output" }
        return $output
    }
    Stop-Job $job | Out-Null
    Remove-Job $job -Force | Out-Null
    throw "git $($GitArgs -join ' ') timed out after $TimeoutSeconds seconds"
}

Write-SyncLog '=== Sync run started ==='
Get-ChildItem -LiteralPath $RepositoriesRoot -Directory | ForEach-Object {
    $repository = $_.FullName
    $repositoryName = $_.Name
    if (-not (Test-Path -LiteralPath (Join-Path $repository '.git'))) { return }
    try {
        $dustWeaverScript = Join-Path $repository 'scripts\autosync.ps1'
        if ($repositoryName -eq 'DustWeaver' -and (Test-Path -LiteralPath $dustWeaverScript)) {
            Write-SyncLog 'Syncing DustWeaver through repository safety protocol'
            $output = & powershell.exe -NoProfile -NonInteractive -File $dustWeaverScript -RepositoryRoot $repository 2>&1
            Write-SyncLog "  DustWeaver protocol: $($output -join [Environment]::NewLine)"
            if ($LASTEXITCODE -ne 0) { Write-SyncLog "  DustWeaver protocol stopped safely with exit code $LASTEXITCODE" }
            return
        }

        # Preserve the pre-existing behavior for repositories that have not
        # adopted their own repository-local safety protocol.
        Write-SyncLog "Syncing $repositoryName"
        $status = & git -C $repository status --porcelain 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git status failed: $($status -join [Environment]::NewLine)" }
        if ($status) {
            & git -C $repository add -A
            if ($LASTEXITCODE -ne 0) { throw 'git add failed' }
            & git -C $repository commit -m "Auto-sync $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" 2>&1 |
                ForEach-Object { Write-SyncLog "  auto-commit: $_" }
            if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
        }
        $pullOutput = Invoke-GitWithTimeout @('pull', '--no-rebase') $repository
        Write-SyncLog "  pull: $pullOutput"
        $ahead = & git -C $repository rev-list --count '@{u}..HEAD' 2>&1
        if ($LASTEXITCODE -eq 0 -and [int]($ahead | Select-Object -Last 1) -gt 0) {
            $pushOutput = Invoke-GitWithTimeout @('push') $repository
            Write-SyncLog "  push: $pushOutput"
        }
    } catch {
        Write-SyncLog "  ERROR in $repositoryName`: $($_.Exception.Message)"
    }
}
Write-SyncLog '=== Sync run finished ==='
