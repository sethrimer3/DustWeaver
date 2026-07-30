[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$LeaseId,
    [string]$Owner = 'unspecified',
    [string]$Purpose = 'AI coding task',
    [ValidateRange(0, 3600)][int]$WaitTimeoutSeconds = 90
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'autosync-common.ps1')
try {
    $RepositoryRoot = if ($RepositoryRoot) { Get-DustWeaverRepositoryRoot $RepositoryRoot } else { Get-DustWeaverRepositoryRoot }
    [void](Test-DustWeaverRepositoryIdentity $RepositoryRoot -ThrowOnFailure)
    $paths = Get-AutosyncPaths $RepositoryRoot
    $pauseDescription = $null
    if ($LeaseId) {
        $leasePath = Get-AutosyncLeasePath $paths.PauseLeasesDirectory $LeaseId
        New-Item -ItemType Directory -Path $paths.PauseLeasesDirectory -Force -ErrorAction Stop | Out-Null
        if (-not (Test-Path -LiteralPath $leasePath -PathType Leaf)) {
            $leaseData = @{
                version = 1
                leaseId = $LeaseId
                owner = $Owner
                purpose = $Purpose
                createdUtc = [DateTime]::UtcNow.ToString('o')
                repository = $RepositoryRoot
            } | ConvertTo-Json -Compress
            try {
                $stream = [IO.File]::Open($leasePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
                $writer = New-Object IO.StreamWriter($stream)
                try {
                    $writer.Write($leaseData)
                    $writer.Flush()
                } finally {
                    $writer.Dispose()
                }
            } catch [IO.IOException] {
                if (-not (Test-Path -LiteralPath $leasePath -PathType Leaf)) { throw }
            }
        }
        $pauseDescription = "lease '$LeaseId'"
    } else {
        if (-not (Test-Path -LiteralPath $paths.PauseMarker)) {
            New-Item -ItemType File -Path $paths.PauseMarker -ErrorAction Stop | Out-Null
        }
        if (-not (Test-Path -LiteralPath $paths.PauseMarker -PathType Leaf)) {
            throw "emergency pause marker was not created at '$($paths.PauseMarker)'"
        }
        $pauseDescription = 'legacy emergency marker'
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitTimeoutSeconds)
    while ($true) {
        $lockState = Get-AutosyncLockState $paths.RunningLock
        if (-not $lockState.Exists) {
            Write-Host "DustWeaver auto-sync is paused by $pauseDescription and quiescent. It is safe to begin editing."
            exit 0
        }
        if (-not $lockState.Active) {
            Write-Error "Pause $pauseDescription created, but auto-sync is not quiescent. $(Get-AutosyncManualLockRecoveryMessage $paths.RunningLock $lockState)"
            exit 1
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            Write-Error "Pause was requested, but auto-sync is still running ($($lockState.Detail)) after $WaitTimeoutSeconds seconds. Do not begin editing. The $pauseDescription remains in place."
            exit 1
        }
        Write-Host "Waiting for DustWeaver auto-sync to finish ($($lockState.Detail))..."
        Start-Sleep -Seconds 1
    }
} catch { Write-Error "Could not pause DustWeaver auto-sync: $($_.Exception.Message)"; exit 1 }
