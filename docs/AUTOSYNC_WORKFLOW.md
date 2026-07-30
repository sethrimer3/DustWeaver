# DustWeaver Auto-Sync Workflow

DustWeaver's scheduled auto-sync can commit any dirty file. Coding agents must
pause it so incomplete work, failed experiments, and unrelated local changes
cannot become automatic commits.

## Commands

```powershell
powershell -NoProfile -File scripts/pause-autosync.ps1
powershell -NoProfile -File scripts/autosync-status.ps1
powershell -NoProfile -File scripts/resume-autosync.ps1
```

The pause marker is `.git/AUTOSYNC_PAUSED`; it is never tracked. The scheduled
process checks it before staging, before committing, and before pulling,
rebasing, or pushing. A paused run exits successfully without changing Git
state.

## Agent procedure

1. Confirm `main` and inspect the tree. Preserve unrelated changes. If clean,
   update with a fast-forward-only pull.
2. Pause auto-sync before investigation or editing and confirm status.
3. Keep it paused throughout editing, validation, commit, rebase, and push.
4. Create one coherent commit directly on `main`, synchronize safely, and push
   without force to `origin/main`.
5. Verify the exact commit on `origin/main`, then resume auto-sync.

Agents do not create branches or pull requests unless the user explicitly asks.
Auto-sync is never an agent's final commit mechanism. Existing feature branches
remain preserved for human review.

If work is interrupted, tests fail, a conflict occurs, or push verification
fails, leave the marker present, incomplete work uncommitted, and report status.

## Lock and recovery

`.git/AUTOSYNC_RUNNING` prevents concurrent instances and records process ID and
start time. A matching live process owns it. Missing/reused PIDs are reported as
stale, but scripts never delete stale or unreadable locks automatically. Confirm
no sync process is running, inspect the JSON, then remove only that exact file:

```powershell
Get-Content .git/AUTOSYNC_RUNNING
Get-Process -Id <recorded-pid>
Remove-Item -LiteralPath .git/AUTOSYNC_RUNNING
```

Never remove a lock plausibly owned by a live process. `git status` and files
such as `.git/MERGE_HEAD`, `.git/rebase-merge`, or `.git/rebase-apply` identify
in-progress operations; resolve them manually. Resume refuses during one.

Resume warns but does not block on a dirty tree. This permits intentional local
work while making clear that the next scheduled run may commit it.

## Scheduled task

Task `\SyncGithubRepos` retains its ten-minute schedule and launches
`wscript.exe "C:\Users\srime\Documents\GitHub\sync-repos-hidden.vbs"`. Its
PowerShell implementation delegates DustWeaver to `scripts/autosync.ps1`;
other repositories retain their prior behavior. While paused, DustWeaver exits
successfully and the scheduler continues servicing other repositories.
