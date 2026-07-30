[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$ScheduledTaskName = '\SyncGithubRepos',
    [ValidateRange(1, 8760)][int]$StaleLeaseHours = 6
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')
try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    $identity = Test-DustWeaverRepositoryIdentity $RepositoryRoot
    if (-not $identity.Valid) {
        throw "DustWeaver repository identity check failed. Resolved path: '$($identity.RepositoryRoot)'. Detected origin: '$($identity.Remote)'."
    }
    $paths = Get-AutosyncPaths $RepositoryRoot
    $pauseState = Get-AutosyncPauseState $paths
    $branch = Get-CurrentGitBranch $RepositoryRoot
    $porcelain = @(& git -C $RepositoryRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect working-tree details.' }
    $stagedCount = @($porcelain | Where-Object { $_.Length -ge 2 -and $_[0] -notin @(' ', '?') }).Count
    $unstagedCount = @($porcelain | Where-Object { $_.Length -ge 2 -and $_[1] -notin @(' ', '?') }).Count
    $untrackedCount = @($porcelain | Where-Object { $_.StartsWith('??') }).Count
    $dirty = $porcelain.Count -gt 0
    $operation = Get-GitOperationState $paths.GitDirectory
    $lockState = Get-AutosyncLockState $paths.RunningLock
    $ahead = 'unavailable'
    $behind = 'unavailable'
    $divergence = & git -C $RepositoryRoot rev-list --left-right --count 'origin/main...main' 2>$null
    if ($LASTEXITCODE -eq 0 -and $divergence -match '^\s*(\d+)\s+(\d+)\s*$') {
        $behind = $Matches[1]
        $ahead = $Matches[2]
    }
    $lastCommit = & git -C $RepositoryRoot log -1 --date=iso --pretty=format:'%h %ad %s' --grep='^Auto-sync' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $lastCommit) { $lastCommit = 'none found' }
    $scheduledTaskState = 'unavailable'
    $scheduledTaskExecutable = 'unavailable'
    $scheduledTaskArguments = 'unavailable'
    try {
        $taskOutput = & schtasks.exe /Query /TN $ScheduledTaskName /XML 2>$null
        if ($LASTEXITCODE -eq 0) {
            [xml]$taskXml = $taskOutput -join [Environment]::NewLine
            $namespace = New-Object Xml.XmlNamespaceManager($taskXml.NameTable)
            $namespace.AddNamespace('t', $taskXml.DocumentElement.NamespaceURI)
            $scheduledTaskExecutable = $taskXml.SelectSingleNode('//t:Exec/t:Command', $namespace).InnerText
            $argumentNode = $taskXml.SelectSingleNode('//t:Exec/t:Arguments', $namespace)
            $scheduledTaskArguments = if ($argumentNode) { $argumentNode.InnerText } else { '<none>' }
            $enabledNode = $taskXml.SelectSingleNode('//t:Settings/t:Enabled', $namespace)
            $scheduledTaskState = if ($enabledNode -and $enabledNode.InnerText -eq 'false') { 'disabled' } else { 'enabled' }
        } else { $scheduledTaskState = 'not found or inaccessible' }
    } catch { $scheduledTaskState = 'not queryable' }
    Write-Host 'Repository identity: passed (sethrimer3/DustWeaver)'
    Write-Host "Auto-sync: $(if ($pauseState.Paused) { 'paused' } else { 'active' })"
    Write-Host "Emergency pause marker: $(if ($pauseState.EmergencyPause) { 'present' } else { 'absent' })"
    Write-Host "Agent pause leases: $($pauseState.Leases.Count)"
    foreach ($leaseFile in $pauseState.Leases) {
        $leaseId = [IO.Path]::GetFileNameWithoutExtension($leaseFile.Name)
        try {
            $lease = Get-Content -LiteralPath $leaseFile.FullName -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            $createdUtc = [DateTime]::Parse([string]$lease.createdUtc).ToUniversalTime()
            $age = [DateTime]::UtcNow - $createdUtc
            $stale = $age.TotalHours -ge $StaleLeaseHours
            Write-Host ("Lease: id={0} owner={1} age={2:N1}h stale={3} createdUtc={4} purpose={5}" -f $leaseId, $lease.owner, $age.TotalHours, $stale.ToString().ToLowerInvariant(), $createdUtc.ToString('o'), $lease.purpose)
        } catch {
            Write-Host "Lease: id=$leaseId metadata=unreadable stale=unknown path=$($leaseFile.FullName)"
        }
    }
    Write-Host "Branch: $branch"
    Write-Host "Working tree: $(if ($dirty) { 'dirty' } else { 'clean' })"
    Write-Host "Changes: staged=$stagedCount unstaged=$unstagedCount untracked=$untrackedCount"
    Write-Host "Divergence from origin/main: ahead=$ahead behind=$behind"
    Write-Host "Git operation: $operation"
    Write-Host "Running lock: $($lockState.Detail)"
    if ($lockState.Exists) {
        Write-Host "Lock metadata: pid=$($lockState.ProcessId) processStartUtc=$($lockState.ProcessStartUtc) createdUtc=$($lockState.CreatedUtc) repository=$($lockState.Repository)"
    }
    Write-Host "Scheduled task $ScheduledTaskName`: $scheduledTaskState"
    Write-Host "Scheduled executable: $scheduledTaskExecutable"
    Write-Host "Scheduled arguments: $scheduledTaskArguments"
    Write-Host "Last auto-sync commit: $lastCommit"
    exit 0
} catch { Write-Error "Could not inspect DustWeaver auto-sync: $($_.Exception.Message)"; exit 1 }
