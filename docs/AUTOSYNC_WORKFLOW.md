# DustWeaver Auto-Sync Workflow

DustWeaver's scheduled auto-sync can commit any dirty file. Coding agents must
pause it so incomplete work, failed experiments, and unrelated local changes
cannot become automatic commits.

## Commands

```powershell
powershell -NoProfile -File scripts/pause-autosync.ps1 -LeaseId codex-<new-guid> -Owner Codex -Purpose "<short task>"
powershell -NoProfile -File scripts/autosync-status.ps1
powershell -NoProfile -File scripts/resume-autosync.ps1 -LeaseId codex-<same-guid>
powershell -NoProfile -File scripts/tests/autosync-integration.ps1
```

Agent pauses are unique JSON leases under `.git/AUTOSYNC_PAUSE_LEASES/`; they
are never tracked. Each agent releases only its own lease, so one finishing task
cannot resume auto-sync while another task is active. The legacy
`.git/AUTOSYNC_PAUSED` file remains available as a manual/emergency global stop
when the pause/resume helpers are called without `-LeaseId`.

The scheduled process checks for the emergency marker or any lease before
staging, before committing, and before pulling, rebasing, or pushing. A paused
run exits successfully without changing Git state. Every helper first verifies
that the resolved repository is DustWeaver using its configured `origin`,
expected files, and package metadata.

## Agent procedure

1. Confirm `main` and inspect the tree. Preserve unrelated changes. If clean,
   update with a fast-forward-only pull.
2. Before investigation or editing, generate a unique lease ID and retain it
   for the task. Pause with `-LeaseId`, `-Owner`, and a short `-Purpose`, and
   require exit code 0. The helper creates that lease immediately, then waits up
   to 90 seconds for an active lock owner to finish. A lease without a
   successful, quiescent result is not permission to edit. Override the bound
   when needed with `-WaitTimeoutSeconds <seconds>`.
3. Keep it paused throughout editing, validation, commit, rebase, and push.
4. Create one coherent commit directly on `main`, synchronize safely, and push
   without force to `origin/main`.
5. Verify the exact commit on `origin/main`, release only the task's exact lease
   with `resume-autosync.ps1 -LeaseId <id>`, and run `autosync-status.ps1`.
   A successful agent task is not finished until its lease is absent. Other
   agents' leases may correctly leave auto-sync paused.

Agents do not create branches or pull requests unless the user explicitly asks.
Auto-sync is never an agent's final commit mechanism. Existing feature branches
remain preserved for human review.

If work is interrupted, tests fail, a conflict occurs, or push verification
fails, leave the task lease present, keep incomplete work uncommitted, and
report the exact lease ID and repository status.

`autosync-status.ps1` lists every lease with its owner, purpose, creation time,
age, and a `stale=true` warning after six hours by default. Override the display
threshold with `-StaleLeaseHours <hours>`. Stale or unreadable leases are never
removed automatically: inspect their metadata and repository state before
releasing that exact ID.

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

Resume warns but does not block on a dirty tree. Releasing one lease does not
remove any other lease or the emergency marker. This permits concurrent agent
work while making clear that the next scheduled run may commit changes only
after the final pause reason is released.

Before staging, auto-sync saves the exact Git index. If staging or commit fails,
times out, or a pause arrives before commit, it restores that index byte-for-byte
and leaves working-tree content untouched. The backup is deleted only after a
successful commit or successful restoration. If restoration fails, auto-sync
creates the emergency pause marker, preserves the reported
`.git/AUTOSYNC_INDEX_BACKUP_*` file, and exits nonzero for manual recovery.

## Scheduled task

Task `\SyncGithubRepos` retains its ten-minute schedule, user context, hidden
execution, and `C:\Users\srime\Documents\GitHub` working directory. It launches:

```text
wscript.exe "C:\Users\srime\Documents\GitHub\DustWeaver\scripts\scheduled-sync-all-repos-hidden.vbs"
```

That tracked wrapper runs `scripts/scheduled-sync-all-repos.ps1`, which verifies
DustWeaver's identity and delegates it to `scripts/autosync.ps1`; other
repositories retain their prior behavior. While any lease or the emergency
marker is present, DustWeaver exits successfully and the scheduler continues
servicing other repositories.

Run the disposable Git-repository regression suite with:

```powershell
powershell -NoProfile -File scripts/tests/autosync-integration.ps1
```
