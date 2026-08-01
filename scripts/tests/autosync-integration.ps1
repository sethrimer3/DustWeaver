[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "DustWeaver-autosync-tests-$PID-$([Guid]::NewGuid().ToString('N'))"
$passed = 0
$failed = 0

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Test([string]$Name, [scriptblock]$Body) {
    try {
        & $Body
        $script:passed++
        Write-Host "PASS $Name"
    } catch {
        $script:failed++
        Write-Host "FAIL $Name`: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Invoke-WorkflowScript([string]$Script, [string]$Repository, [string[]]$ExtraArguments = @()) {
    $arguments = @('-NoProfile', '-File', (Join-Path $sourceRoot "scripts\$Script"), '-RepositoryRoot', $Repository) + $ExtraArguments
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & powershell.exe @arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join [Environment]::NewLine) }
}

function New-TestRepository([string]$Name, [string]$InitialBranch = 'main', [switch]$WrongIdentity) {
    $repository = Join-Path $testRoot $Name
    $bare = Join-Path $testRoot "$Name-origin.git"
    & git init --bare --initial-branch=main $bare | Out-Null
    & git init --initial-branch=$InitialBranch $repository | Out-Null
    & git -C $repository config user.name 'DustWeaver Auto-sync Tests'
    & git -C $repository config user.email 'autosync-tests@example.invalid'
    New-Item -ItemType Directory -Path (Join-Path $repository 'src'), (Join-Path $repository 'scripts') | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'scripts\autosync-common.ps1') -Destination (Join-Path $repository 'scripts\autosync-common.ps1')
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'scripts\autosync.ps1') -Destination (Join-Path $repository 'scripts\autosync.ps1')
    Set-Content -LiteralPath (Join-Path $repository 'AGENTS.md') -Value '# test'
    Set-Content -LiteralPath (Join-Path $repository 'src\build-info.ts') -Value 'export const BUILD_NUMBER = 0;'
    $packageJson = if ($WrongIdentity) { '{"name":"not-dustweaver"}' } else { '{"name":"dustweaver"}' }
    Set-Content -LiteralPath (Join-Path $repository 'package.json') -Value $packageJson
    Set-Content -LiteralPath (Join-Path $repository 'seed.txt') -Value 'seed'
    & git -C $repository add -A
    & git -C $repository commit -m seed | Out-Null
    $remote = if ($WrongIdentity) { 'https://github.com/example/not-dustweaver.git' } else { 'https://github.com/sethrimer3/DustWeaver.git' }
    & git -C $repository remote add origin $remote
    if (-not $WrongIdentity -and $InitialBranch -eq 'main') {
        $fileUri = ([Uri]$bare).AbsoluteUri
        & git -C $repository -c "url.$fileUri.insteadOf=$remote" push -u origin main | Out-Null
    }
    return [pscustomobject]@{ Path = $repository; Bare = $bare; Remote = $remote }
}

function Use-LocalRemote($TestRepository) {
    $fileUri = ([Uri]$TestRepository.Bare).AbsoluteUri
    $env:GIT_CONFIG_COUNT = '1'
    $env:GIT_CONFIG_KEY_0 = "url.$fileUri.insteadOf"
    $env:GIT_CONFIG_VALUE_0 = $TestRepository.Remote
}

function Clear-LocalRemote {
    Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0 -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $repo = New-TestRepository 'primary'
    Use-LocalRemote $repo

    Invoke-Test 'pause creates marker' {
        $result = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-WaitTimeoutSeconds', '2')
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')) 'pause marker missing'
    }
    Invoke-Test 'pause is idempotent' {
        $result = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-WaitTimeoutSeconds', '2')
        Assert-True ($result.ExitCode -eq 0) $result.Output
    }
    Invoke-Test 'paused auto-sync performs no mutation' {
        Set-Content (Join-Path $repo.Path 'paused-change.txt') 'change'
        $before = & git -C $repo.Path status --porcelain
        $head = & git -C $repo.Path rev-parse HEAD
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ((& git -C $repo.Path rev-parse HEAD) -eq $head) 'HEAD changed'
        $after = (& git -C $repo.Path status --porcelain) -join "`n"
        Assert-True ($after -eq ($before -join "`n")) 'status changed'
        Remove-Item (Join-Path $repo.Path 'paused-change.txt')
    }
    Remove-Item (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED') -ErrorAction SilentlyContinue

    Invoke-Test 'agent leases are independent and last lease controls resume' {
        $first = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-LeaseId', 'agent-one', '-Owner', 'Codex', '-Purpose', 'first task')
        $second = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-LeaseId', 'agent-two', '-Owner', 'Codex', '-Purpose', 'second task')
        Assert-True ($first.ExitCode -eq 0) $first.Output
        Assert-True ($second.ExitCode -eq 0) $second.Output
        $leases = Join-Path $repo.Path '.git\AUTOSYNC_PAUSE_LEASES'
        Assert-True (Test-Path (Join-Path $leases 'agent-one.json')) 'first lease missing'
        Assert-True (Test-Path (Join-Path $leases 'agent-two.json')) 'second lease missing'

        $releaseFirst = Invoke-WorkflowScript 'resume-autosync.ps1' $repo.Path @('-LeaseId', 'agent-one')
        Assert-True ($releaseFirst.ExitCode -eq 0) $releaseFirst.Output
        Assert-True (-not (Test-Path (Join-Path $leases 'agent-one.json'))) 'first lease remained'
        Assert-True (Test-Path (Join-Path $leases 'agent-two.json')) 'second lease was removed'
        Assert-True ($releaseFirst.Output.Contains('remains paused')) 'remaining pause was not reported'

        Set-Content (Join-Path $repo.Path 'leased-change.txt') 'change'
        $head = & git -C $repo.Path rev-parse HEAD
        $pausedResult = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($pausedResult.ExitCode -eq 0) $pausedResult.Output
        Assert-True ((& git -C $repo.Path rev-parse HEAD) -eq $head) 'lease allowed a commit'
        Remove-Item (Join-Path $repo.Path 'leased-change.txt')

        $releaseSecond = Invoke-WorkflowScript 'resume-autosync.ps1' $repo.Path @('-LeaseId', 'agent-two')
        Assert-True ($releaseSecond.ExitCode -eq 0) $releaseSecond.Output
        Assert-True (-not (Test-Path (Join-Path $leases 'agent-two.json'))) 'second lease remained'
        Assert-True ($releaseSecond.Output.Contains('is active')) 'final release did not activate auto-sync'
    }
    Invoke-Test 'path casing does not bypass an active lease' {
        $pauseResult = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-LeaseId', 'case-lease', '-Owner', 'Codex', '-Purpose', 'casing test')
        Assert-True ($pauseResult.ExitCode -eq 0) $pauseResult.Output
        Set-Content (Join-Path $repo.Path 'casing-change.txt') 'change'
        $head = & git -C $repo.Path rev-parse HEAD
        $upperPath = $repo.Path.ToUpperInvariant()
        $result = Invoke-WorkflowScript 'autosync.ps1' $upperPath
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ((& git -C $repo.Path rev-parse HEAD) -eq $head) 'casing bypassed lease and committed'
        Remove-Item (Join-Path $repo.Path 'casing-change.txt')
        $release = Invoke-WorkflowScript 'resume-autosync.ps1' $repo.Path @('-LeaseId', 'case-lease')
        Assert-True ($release.ExitCode -eq 0) $release.Output
    }
    Invoke-Test 'forward-slash path does not bypass an active lease' {
        $pauseResult = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-LeaseId', 'slash-lease', '-Owner', 'Codex', '-Purpose', 'slash test')
        Assert-True ($pauseResult.ExitCode -eq 0) $pauseResult.Output
        Set-Content (Join-Path $repo.Path 'slash-change.txt') 'change'
        $head = & git -C $repo.Path rev-parse HEAD
        $slashPath = $repo.Path -replace '\\', '/'
        $result = Invoke-WorkflowScript 'autosync.ps1' $slashPath
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ((& git -C $repo.Path rev-parse HEAD) -eq $head) 'forward-slash path bypassed lease and committed'
        Remove-Item (Join-Path $repo.Path 'slash-change.txt')
        $release = Invoke-WorkflowScript 'resume-autosync.ps1' $repo.Path @('-LeaseId', 'slash-lease')
        Assert-True ($release.ExitCode -eq 0) $release.Output
    }
    Invoke-Test 'invalid lease ID is rejected without escaping lease directory' {
        $result = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-LeaseId', '..\escape')
        Assert-True ($result.ExitCode -ne 0) 'invalid lease ID succeeded'
        Assert-True (-not (Test-Path (Join-Path $repo.Path '.git\escape.json'))) 'invalid lease escaped its directory'
    }

    Invoke-Test 'pause waits for active process and lock removal' {
        $lock = Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'
        $ready = Join-Path $testRoot 'holder-ready'
        $holder = Start-Job -ScriptBlock {
            param($LockPath, $ReadyPath, $Repository)
            $process = Get-Process -Id $PID
            @{ pid=$PID; processStartUtc=$process.StartTime.ToUniversalTime().ToString('o'); createdUtc=[DateTime]::UtcNow.ToString('o'); repository=$Repository } |
                ConvertTo-Json -Compress | Set-Content -LiteralPath $LockPath
            New-Item -ItemType File -Path $ReadyPath | Out-Null
            Start-Sleep -Seconds 2
            Remove-Item -LiteralPath $LockPath -Force
        } -ArgumentList $lock, $ready, $repo.Path
        while (-not (Test-Path $ready)) { Start-Sleep -Milliseconds 50 }
        $result = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-WaitTimeoutSeconds', '5')
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True (-not (Test-Path $lock)) 'lock remained'
        Wait-Job $holder | Out-Null
        Remove-Job $holder
        Remove-Item $ready
    }
    Remove-Item (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED') -ErrorAction SilentlyContinue

    Invoke-Test 'pause times out on active process' {
        $lock = Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'
        $process = Get-Process -Id $PID
        @{ pid=$PID; processStartUtc=$process.StartTime.ToUniversalTime().ToString('o'); createdUtc=[DateTime]::UtcNow.ToString('o'); repository=$repo.Path } |
            ConvertTo-Json -Compress | Set-Content -LiteralPath $lock
        $result = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-WaitTimeoutSeconds', '1')
        Assert-True ($result.ExitCode -ne 0) 'pause unexpectedly succeeded'
        Assert-True (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')) 'marker missing after timeout'
        Remove-Item $lock -Force
    }
    Remove-Item (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')

    foreach ($kind in @('stale', 'unreadable')) {
        Invoke-Test "pause refuses $kind lock" {
            $lock = Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'
            if ($kind -eq 'stale') {
                @{ pid=999999; processStartUtc=[DateTime]::UtcNow.ToString('o'); createdUtc=[DateTime]::UtcNow.ToString('o'); repository=$repo.Path } |
                    ConvertTo-Json -Compress | Set-Content $lock
            } else { Set-Content $lock 'not-json' }
            $result = Invoke-WorkflowScript 'pause-autosync.ps1' $repo.Path @('-WaitTimeoutSeconds', '1')
            Assert-True ($result.ExitCode -ne 0) 'pause unexpectedly succeeded'
            Assert-True (Test-Path $lock) 'lock was deleted'
            Remove-Item $lock
            Remove-Item (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')
        }
    }

    Invoke-Test 'wrong repository identity is rejected without marker' {
        $wrong = New-TestRepository 'wrong' -WrongIdentity
        $result = Invoke-WorkflowScript 'pause-autosync.ps1' $wrong.Path
        Assert-True ($result.ExitCode -ne 0) 'wrong identity succeeded'
        Assert-True (-not (Test-Path (Join-Path $wrong.Path '.git\AUTOSYNC_PAUSED'))) 'wrong repo was mutated'
    }
    Invoke-Test 'non-main branch is refused without commit or staging' {
        $other = New-TestRepository 'other-branch' -InitialBranch 'test-only'
        Set-Content (Join-Path $other.Path 'dirty.txt') 'dirty'
        $result = Invoke-WorkflowScript 'autosync.ps1' $other.Path
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ((& git -C $other.Path rev-list --all --count) -eq 1) 'commit created'
        Assert-True (-not (& git -C $other.Path diff --cached --name-only)) 'file staged'
    }
    Invoke-Test 'concurrent instance cannot acquire active lock' {
        $lock = Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'
        $process = Get-Process -Id $PID
        @{ pid=$PID; processStartUtc=$process.StartTime.ToUniversalTime().ToString('o'); createdUtc=[DateTime]::UtcNow.ToString('o'); repository=$repo.Path } |
            ConvertTo-Json -Compress | Set-Content $lock
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True (Test-Path $lock) 'foreign lock deleted'
        Remove-Item $lock
    }
    Invoke-Test 'clean repository creates no commit and cleans lock' {
        $head = & git -C $repo.Path rev-parse HEAD
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ((& git -C $repo.Path rev-parse HEAD) -eq $head) 'commit created'
        Assert-True (-not (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'))) 'lock remained'
    }
    Invoke-Test 'successful commit includes pre-staged changes and leaves no backup' {
        Set-Content (Join-Path $repo.Path 'staged.txt') 'staged'
        & git -C $repo.Path add staged.txt
        Set-Content (Join-Path $repo.Path 'unstaged.txt') 'unstaged'
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ((& git -C $repo.Path show 'HEAD:staged.txt') -eq 'staged') 'staged content not committed'
        Assert-True (-not (Get-ChildItem (Join-Path $repo.Path '.git') -Filter 'AUTOSYNC_INDEX_BACKUP_*')) 'backup remained'
    }
    Invoke-Test 'commit failure restores exact staged and unstaged state' {
        Set-Content (Join-Path $repo.Path 'pre-staged.txt') 'one'
        & git -C $repo.Path add pre-staged.txt
        Set-Content (Join-Path $repo.Path 'not-staged.txt') 'two'
        $beforeStaged = (& git -C $repo.Path diff --cached --binary) -join "`n"
        $hook = Join-Path $repo.Path '.git\hooks\pre-commit'
        Set-Content $hook "#!/bin/sh`nexit 1"
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($result.ExitCode -ne 0) 'commit failure unexpectedly succeeded'
        Assert-True (((& git -C $repo.Path diff --cached --binary) -join "`n") -eq $beforeStaged) 'staged state changed'
        Assert-True ((& git -C $repo.Path status --porcelain -- not-staged.txt) -match '^\\?\\?') 'unstaged file became staged'
        Assert-True (-not (Get-ChildItem (Join-Path $repo.Path '.git') -Filter 'AUTOSYNC_INDEX_BACKUP_*')) 'backup remained after restoration'
        Remove-Item $hook
        & git -C $repo.Path reset -- pre-staged.txt | Out-Null
        Remove-Item (Join-Path $repo.Path 'pre-staged.txt'), (Join-Path $repo.Path 'not-staged.txt')
    }
    Invoke-Test 'restoration failure pauses and preserves index backup' {
        Set-Content (Join-Path $repo.Path 'restore-failure.txt') 'restore'
        $hook = Join-Path $repo.Path '.git\hooks\pre-commit'
        Set-Content $hook "#!/bin/sh`nexit 1"
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path @('-TestForceIndexRestoreFailure')
        Assert-True ($result.ExitCode -ne 0) 'restoration failure unexpectedly succeeded'
        Assert-True (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')) 'restoration failure did not pause'
        $backups = @(Get-ChildItem (Join-Path $repo.Path '.git') -Filter 'AUTOSYNC_INDEX_BACKUP_*')
        Assert-True ($backups.Count -eq 1) 'index backup was not preserved'
        Assert-True ($result.Output.Contains('AUTOSYNC_INDEX_BACKUP_')) 'backup path was not reported'
        Copy-Item -LiteralPath $backups[0].FullName -Destination (Join-Path $repo.Path '.git\index') -Force
        Remove-Item $hook, $backups[0].FullName, (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')
        Remove-Item (Join-Path $repo.Path 'restore-failure.txt')
    }
    Invoke-Test 'unresolved Git operation blocks sync and cleans lock' {
        Set-Content (Join-Path $repo.Path '.git\MERGE_HEAD') ('0' * 40)
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path
        Assert-True ($result.ExitCode -ne 0) 'operation unexpectedly succeeded'
        Assert-True (-not (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'))) 'lock remained'
        Remove-Item (Join-Path $repo.Path '.git\MERGE_HEAD')
    }
    Invoke-Test 'pull failure blocks push' {
        Set-Content (Join-Path $repo.Path 'pull-failure.txt') 'local'
        $remoteBefore = & git --git-dir=$($repo.Bare) rev-parse main
        Clear-LocalRemote
        $result = Invoke-WorkflowScript 'autosync.ps1' $repo.Path @('-GitTimeoutSeconds', '3')
        Assert-True ($result.ExitCode -ne 0) 'pull failure unexpectedly succeeded'
        Assert-True ((& git --git-dir=$($repo.Bare) rev-parse main) -eq $remoteBefore) 'push occurred'
        Assert-True (-not (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_RUNNING'))) 'lock remained'
        Use-LocalRemote $repo
    }
    Invoke-Test 'resume refuses active stale unreadable locks' {
        foreach ($content in @(
            (@{ pid=$PID; processStartUtc=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); createdUtc=[DateTime]::UtcNow.ToString('o'); repository=$repo.Path } | ConvertTo-Json -Compress),
            (@{ pid=999999; processStartUtc=[DateTime]::UtcNow.ToString('o'); createdUtc=[DateTime]::UtcNow.ToString('o'); repository=$repo.Path } | ConvertTo-Json -Compress),
            'not-json'
        )) {
            Set-Content (Join-Path $repo.Path '.git\AUTOSYNC_RUNNING') $content
            New-Item -ItemType File (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED') -Force | Out-Null
            $result = Invoke-WorkflowScript 'resume-autosync.ps1' $repo.Path
            Assert-True ($result.ExitCode -ne 0) 'resume unexpectedly succeeded'
            Assert-True (Test-Path (Join-Path $repo.Path '.git\AUTOSYNC_PAUSED')) 'pause marker removed'
        }
        Remove-Item (Join-Path $repo.Path '.git\AUTOSYNC_RUNNING')
    }
    Invoke-Test 'resume refuses every Git operation marker' {
        foreach ($marker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
            $path = Join-Path $repo.Path ".git\$marker"
            if ($marker -like 'rebase-*') { New-Item -ItemType Directory $path | Out-Null } else { Set-Content $path ('0' * 40) }
            $result = Invoke-WorkflowScript 'resume-autosync.ps1' $repo.Path
            Assert-True ($result.ExitCode -ne 0) "resume allowed $marker"
            Remove-Item $path -Recurse -Force
        }
    }
    Invoke-Test 'status reports detailed state read-only' {
        Set-Content (Join-Path $repo.Path 'status-untracked.txt') 'x'
        $before = (& git -C $repo.Path status --porcelain) -join "`n"
        $result = Invoke-WorkflowScript 'autosync-status.ps1' $repo.Path @('-ScheduledTaskName', '\NoSuchTestTask')
        Assert-True ($result.ExitCode -eq 0) $result.Output
        foreach ($needle in @('Repository identity: passed', 'Emergency pause marker: present', 'Agent pause leases:', 'Changes: staged=', 'Divergence from origin/main:', 'Git operation: none', 'Running lock:')) {
            Assert-True ($result.Output.Contains($needle)) "status missing '$needle'"
        }
        Assert-True (((& git -C $repo.Path status --porcelain) -join "`n") -eq $before) 'status mutated repository'
        Remove-Item (Join-Path $repo.Path 'status-untracked.txt')
    }
    Invoke-Test 'status identifies stale agent lease without removing it' {
        $leases = Join-Path $repo.Path '.git\AUTOSYNC_PAUSE_LEASES'
        New-Item -ItemType Directory -Path $leases -Force | Out-Null
        @{ version=1; leaseId='stale-agent'; owner='Codex'; purpose='abandoned test'; createdUtc=[DateTime]::UtcNow.AddHours(-2).ToString('o'); repository=$repo.Path } |
            ConvertTo-Json -Compress | Set-Content (Join-Path $leases 'stale-agent.json')
        $result = Invoke-WorkflowScript 'autosync-status.ps1' $repo.Path @('-ScheduledTaskName', '\NoSuchTestTask', '-StaleLeaseHours', '1')
        Assert-True ($result.ExitCode -eq 0) $result.Output
        Assert-True ($result.Output.Contains('id=stale-agent')) 'stale lease ID missing'
        Assert-True ($result.Output.Contains('stale=true')) 'stale lease warning missing'
        Assert-True (Test-Path (Join-Path $leases 'stale-agent.json')) 'status removed stale lease'
        Remove-Item (Join-Path $leases 'stale-agent.json')
    }
    Invoke-Test 'resume refuses non-main' {
        $other = Get-Item (Join-Path $testRoot 'other-branch')
        New-Item -ItemType File (Join-Path $other.FullName '.git\AUTOSYNC_PAUSED') -Force | Out-Null
        $result = Invoke-WorkflowScript 'resume-autosync.ps1' $other.FullName
        Assert-True ($result.ExitCode -ne 0) 'resume allowed non-main'
    }
} finally {
    Clear-LocalRemote
    Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $PID -and $_.StartTime -gt (Get-Date).AddMinutes(-10)
    } | ForEach-Object { } # The harness stops only the explicit holder it creates.
    if (Test-Path -LiteralPath $testRoot) {
        $resolved = [IO.Path]::GetFullPath($testRoot)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or -not (Split-Path $resolved -Leaf).StartsWith('DustWeaver-autosync-tests-')) {
            throw "Refusing to remove unexpected test path '$resolved'."
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

Write-Host "Auto-sync integration tests: $passed passed, $failed failed."
if ($failed -ne 0) { exit 1 }
