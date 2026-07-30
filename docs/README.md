# Documentation Index

Concise index for humans and token-limited agents. See root [`AGENTS.md`](../AGENTS.md) for the required agent read order and workflow rules; root [`README.md`](../README.md) is the human entry point.

## Canonical / current

- [`AI_REPO_MAP.md`](AI_REPO_MAP.md) — routing map: where to look for a given task type.
- [`CURRENT_STATUS.md`](CURRENT_STATUS.md) — current project state and known issues.
- [`Todo.md`](Todo.md) — operational task queue.
- [`../nextSteps.md`](../nextSteps.md) — prioritized planning log of recent build work (stays at repo root; read every task cycle alongside `AGENTS.md`).
- [`render-chunk-prewarming.md`](render-chunk-prewarming.md) — render chunk prewarm/adopt system.
- [`campaign-room-cache-architecture.md`](campaign-room-cache-architecture.md) — campaign/room cache architecture.
- [`pixelMaterials.md`](pixelMaterials.md) — pixel material simulation.
- [`zip-move-blocks.md`](zip-move-blocks.md) — zip/kinetic move-block behavior.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — compact AI-facing architecture guide.
- [`BRANCH_RECOVERY.md`](BRANCH_RECOVERY.md) — historical git branch recovery notes.
- [`AUTOSYNC_WORKFLOW.md`](AUTOSYNC_WORKFLOW.md) — main-only AI workflow and local auto-sync pause/lock protocol.

## `decisions/` — active design decisions and plans

- [`decisions/DECISIONS.md`](decisions/DECISIONS.md) — architectural decisions log.
- [`decisions/REFACTORING_PLAN.md`](decisions/REFACTORING_PLAN.md) — active file-splitting refactor plan.
- [`decisions/performanceOptimizationDecisions.md`](decisions/performanceOptimizationDecisions.md) — build-by-build performance decisions.
- [`decisions/combatDustPolishDecisions.md`](decisions/combatDustPolishDecisions.md) — combat/dust polish decisions.
- [`decisions/MajorDustUpgradePlan.md`](decisions/MajorDustUpgradePlan.md) — dust/mote system upgrade plan.

## `systems/` — active subsystem reference docs

- [`systems/render-pipeline.md`](systems/render-pipeline.md) — render pipeline detail (moved from root `ARCHITECTURE.md`).
- [`systems/movement.md`](systems/movement.md) — player movement values/behavior.
- [`systems/CustomBlockSpriteSystem.md`](systems/CustomBlockSpriteSystem.md) — custom block sprite system.
- [`systems/RoomLoadingOptimizations.md`](systems/RoomLoadingOptimizations.md) — consolidated room-loading optimization reference.
- [`systems/PERFORMANCE_DIAGNOSIS.md`](systems/PERFORMANCE_DIAGNOSIS.md) — rendering/transition freeze diagnosis.
- [`systems/manual_test_checklist.md`](systems/manual_test_checklist.md) — manual QA checklist.

## `archive/` — historical, superseded, or working-log material

Kept for routing/history only; verify current source before treating any claim as live.

- [`archive/RefactorPlan.md`](archive/RefactorPlan.md) — historical refactor working log.
- [`archive/RoomLoadingOptimizations.local.md`](archive/RoomLoadingOptimizations.local.md) — historical room-loading working log.
- [`archive/DUST_TYPES_ARCHIVE.md`](archive/DUST_TYPES_ARCHIVE.md) — removed dust types.
- [`archive/ENEMY_COMBAT_ARCHIVE.md`](archive/ENEMY_COMBAT_ARCHIVE.md) — removed enemy attack/block decisions.
- [`archive/legacy.md`](archive/legacy.md) — legacy grapple miss / limp-chain physics.

## Not moved

- Root `README.md` — human entry point.
- Root `AGENTS.md` — canonical repo-wide agent entry point (the former duplicate `agents.md` was removed; Windows checkouts are case-insensitive, so keep only one casing).
- Root `nextSteps.md` — actively read every task cycle per `AGENTS.md`; left at root deliberately rather than moved, to avoid touching its many live cross-references for no reader benefit.
