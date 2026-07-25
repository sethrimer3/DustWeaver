# Todo

This is DustWeaver's operational task queue. Keep it short, concrete, actionable, and useful to an agent with limited tokens. It is not a design document or changelog.

## Agent workflow for Todo tasks

When the user says **"Do a task from Todo.md"**, **"Do the next task from Todo.md"**, or equivalent:

1. Read `AGENTS.md`, `docs/AI_REPO_MAP.md`, `docs/CURRENT_STATUS.md`, and this file. Unless the user identifies a specific item, select the **first unchecked `- [ ]` item from top to bottom**. Do not skip it merely because another item is easier.
2. Search/read `nextSteps.md` for prior decisions, measurements, constraints, partial work, or warnings relevant to the selected item. Verify all important assumptions against the current source code because current code is authoritative.
3. Investigate only the selected subsystem and its direct dependencies, then implement the item as completely as the available environment allows. Preserve existing behavior outside the task's scope.
4. Run the narrowest relevant tests first, then `npm run build`, `npm run lint`, and `npm test` when practical. Follow the `BUILD_NUMBER` rule in `AGENTS.md` whenever code changes.
5. Update the documentation before reporting:
   - If the task's core acceptance criteria are complete, check off its Todo item and record concise validation or a completion reference.
   - If core work remains, leave the item unchecked and clarify what is still required.
   - Add concrete unfinished work, blockers, failed or unavailable validation, useful investigation results, and recommended continuation steps to `nextSteps.md`. Give the next agent enough context to continue without repeating the investigation.
   - Add a new unchecked Todo item only when a separate, actionable follow-up should remain in the operational queue.
6. Tell the user exactly what was done, which files changed, what validation passed or failed, and what remains uncertain. End the report with **`TODO ITEMS LEFT: N`**, where `N` is the number of unchecked `- [ ]` checkboxes remaining in `docs/Todo.md` after all edits. Count every unchecked Todo checkbox and do not count checked items or ordinary bullets.

If the selected task requires browser/manual evidence that the environment cannot produce, complete all code and automated validation that can be done, document the missing evidence in `nextSteps.md`, and do not claim the task is fully complete unless its stated acceptance criteria are actually satisfied.

## Adding good Todo items

Each new item should be an implementation-ready mini-brief where possible: state the observed problem or desired behavior, acceptance criteria, likely files/subsystems, relevant existing behavior or constraints, and useful validation commands. Include enough targeted context to reduce repository-wide searching, but link detailed investigation notes from `nextSteps.md` rather than bloating this file.

## Agent maintenance rules

- Check off items when completed and include the validation command or reason in the PR/commit summary.
- Add newly discovered deferred work here only if it is concrete, actionable, and still relevant.
- If validation cannot be completed, record the failure or unavailable environment in `nextSteps.md` and the final report.
- Do not dump broad design notes here. Link to detailed docs instead.

## High priority

- [ ] Regenerate baked wall templates for the official campaign rooms whose baked hash is stale (dev console logs `[wallTemplate] roomId=… source=fallback reason=stale_hash` for at least: bend, seal_chamber, the_fall, lobby, tall_shaft, chasm, overgrown_shaft, underwater_lake, magma_corridor, a_big_ask, lava_tube, crimson_throne). Until regenerated, every load of these rooms skips the baked fast path and rebuilds wall templates via the incremental merge fallback. Re-export the rooms from the editor (or run the bake path) so `bakedWallTemplate` matches current wall data.
- [ ] Capture live browser transition timings for representative rooms using `__dwBenchPingPong(roomA, roomB, iterations)` and inspect `__dwTransitionStats(n)`.
- [ ] Based on measured transition phases, choose the next bottleneck to optimize rather than speculating.
- [ ] Verify whether first-entry resident wall-template builds on very large rooms still cause visible frame spikes.
- [ ] Verify sprite/background decode behavior on first entry after the current decode-aware preload work.
- [ ] Continue hardening resident-room / zone-resident loading toward the goal of room-level instant transitions and longer loading only between zones.
- [ ] Protect map sketch rendering from room-edge artifact regressions. Add narrow tests or visual debug checks if feasible.
- [ ] Recharge the player's grapple at the water surface, but never fully underwater. Acceptance criteria: when the player overlaps a non-frozen water zone and **any portion of the player hitbox is above that zone's top surface** (`player.positionYWorld - player.halfHeightWorld < world.playerBuoyancySurfaceYWorld`), restore `world.hasGrappleChargeFlag` exactly as ground contact does, including the existing golden recharge-ring effect only on the depleted→charged transition. Do not recharge when the entire hitbox is at or below the water surface, even if a shallow zone produces `PLAYER_WATER_STATE_SURFACE`; do not recharge outside water; do not repeatedly restart the ring every surface tick; and do not change underwater grapple consumption, water movement, skipping, or frozen-water behavior. Use the current tick's post-movement hitbox/water contact so crossing into the surface condition can recharge before the grapple constraint phase. Likely files: ground recharge currently lives in `src/sim/clusters/movement.ts`; authoritative AABB water detection and `playerBuoyancySurfaceYWorld` are in `src/sim/hazards.ts`; tick ordering is in `src/sim/tick.ts`; water-state constants/helpers are in `src/sim/clusters/playerWaterPhysics.ts`. Prefer a shared grapple-charge recharge helper rather than duplicating the ground transition/VFX logic. Add deterministic tests (likely extending `src/tests/playerWaterPhysics.test.ts` or a focused grapple-recharge test) for partial surface overlap, fully submerged, outside water, shallow-zone false positives, same-tick surface entry, and one-shot recharge VFX. Run targeted tests, then `npm run build`, `npm run lint`, and `npm test`.
- [ ] Replace the player's ordinary-air terminal fall-speed cap with a two-stage, unbounded natural fall curve. Current behavior is implemented in `src/sim/clusters/playerVerticalMovement.ts`: normal gravity (`900 px/s²`) is applied and then downward velocity is clamped to `NORMAL_MAX_FALL_WORLD_PER_SEC` (`160.5 px/s`, effectively the requested 160); committed fast-fall instead clamps to `FAST_MAX_FALL_WORLD_PER_SEC` (`240 px/s`). Required behavior with no other forces or intentional movement mechanics acting: accelerate quickly under the existing normal gravity until reaching approximately `160 px/s` downward, then continue accelerating downward forever at exactly `20 px/s²`—about `180 px/s` after one additional second, `200 px/s` after two, etc.—with no terminal cap. Make the threshold transition frame-rate-independent using `dtSec`, and handle the crossing tick without overshoot-dependent behavior. Never reduce/clamp an already higher downward velocity caused by a grapple, zip, spring, knockback, room transfer, or another mechanic; while ordinary freefall resumes, preserve that velocity rather than snapping it back to 160. Water physics, grounded state, wall slides, upward/rising motion, active grapple constraints, and collision responses must remain authoritative and must not receive the new post-threshold acceleration when their existing logic says otherwise. Deliberately reconcile the existing down-input fast-fall and jump-held upward-brake behavior: intentional fast-fall may still accelerate the player downward faster and intentional braking may still reduce speed, but neither should leave a passive hard terminal cap that prevents subsequent natural long-fall acceleration. Likely files: `src/sim/clusters/movementConstants.ts` (current gravity/caps/debug overrides and comments), `src/sim/clusters/playerVerticalMovement.ts` (authoritative gravity/cap/brake logic), and any debug-panel bindings or tests referencing `normalFallCapWorld` / `fastFallCapWorld`; preserve backward compatibility for debug controls or rename them coherently to threshold/tuning controls. Add deterministic tests for: rapid approach to the ~160 threshold; +20 px/s after one second and +40 after two; very long unbounded falls; equivalent results across timestep subdivision; exact threshold-crossing behavior; pre-existing velocity above 160 not being reduced; landing/jumping reset behavior; water, wall-slide, active-grapple, fast-fall, and upward-brake interactions. Run targeted movement tests, then `npm run build`, `npm run lint`, and `npm test`.

## Deferred / medium priority

- [ ] Migrate/remove the legacy ordered combat-mote queue, Storm-as-equipped-primary gating, Arrow Weave, and Sword Weave without disturbing the health-derived Stormweave/Shield Weave collection; choose replacement controls before exposing legacy secondary abilities again.
- [ ] Extend Shield Weave collision adapters for lava surfing and laser reflection only after those systems define directional contact/reflection contracts; do not approximate them through the current ordinary-projectile blocker.
- [ ] Implement `evictStalePrewarmedChunks` with an LRU or memory cap if warmed chunk memory growth is observed.
- [ ] Make radius-3 render chunk warming more adaptive by incorporating frame-time checks, if needed.
- [ ] Expose the prewarm debug panel in pause-menu debug UI if useful.
- [ ] Add CI smoke test for `npm ci && npm run build`.
- [ ] Consider `BgWallGridView` dense/sparse adapter only if large-room memory pressure becomes a real issue.
- [ ] Add sprite assets and registrations for enemy palette previews that currently use procedural placeholders.
- [ ] Add crumble/falling block palette entries if those block types become active editor items.
- [ ] Investigate menu animation lag if still reproducible with current assets and renderer path.
- [ ] Verify and polish ultra ice behavior: wall contact stops slip, touching ultra ice resets grapple, and zero-velocity stuck cases return control.
- [x] Editor UI redesign, part 1/2: two independent 260px left/right sidebars (`#editor-ui` / `#editor-ui-right`) with the specified content order, and a reusable accessible collapsible-section component (`createCollapsibleSection` in `src/editor/editorUIHelpers.ts` — real `<button>` header + chevron + `aria-expanded`/`aria-controls`, defaults to collapsed) used by every top-level panel in both sidebars, including the layers panel (`src/editor/editorUILayersPanel.ts`, now built on the shared component). The detached top-right map bar is removed and replaced with the "Zone Map (M)" / "Itemized Map (N)" button row directly under Save and Export Campaign, wired to the existing `onOpenVisualMap` / new `onOpenWorldMap` callbacks. Validated via `npm run build`, `npm run lint`, `npm test`.
- [x] Editor UI redesign, part 2/2: in-memory, controller-owned session state (`EditorSessionUIState` in `src/editor/editorUI.ts`) snapshots every collapsible section's expanded/collapsed state (keyed via a new `key` option on `createCollapsibleSection`) plus each sidebar's visible/hidden state, captured in `closeEditor()` right before `ui.destroy()` and reapplied in `toggle()`'s isActive branch after `createEditorUI()` — survives editor close/reopen within the running session, first-ever open still defaults to all-collapsed, kept fully separate from the disk/localStorage-persisted `EditorWorkspaceUIPrefs`. Added independent hide arrows atop each sidebar plus inward-pointing edge reveal tabs (`#editor-ui` / `#editor-ui-right` operate fully independently). Replaced the hardcoded `EDITOR_PANEL_WIDTH_CSS_PX` (260) check in `editorController.ts` with shared, dynamic hit-region logic in new `src/editor/editorUIHitRegions.ts` (`isPointOverEditorUI`/`isPointOverEditorCanvas`), applied to every canvas gesture path (click, right-click delete, drag-paint, right-drag-paint, hover-scan, wheel zoom) — a hidden sidebar's old 260px region is now fully interactive again, minus only its own reveal-tab hit area. Validated via `npm run build`, `npm run lint`, `npm test`.

## Completed / superseded references

The following are documented as complete in existing planning notes. Keep them here only as routing references for future agents.

- [x] Room schema v3 compressed 1x1 wall storage. See `nextSteps.md`.
- [x] Water/lava, ambient blocker, and background block compression additions. See `nextSteps.md`.
- [x] Complete boundary walls plus independent trigger strips. See `nextSteps.md` and `src/levels/roomBoundaryWalls.ts`.
- [x] Baked runtime wall templates persisted and preferred at runtime. See `nextSteps.md`.
- [x] Render chunk prewarming documented. See `docs/render-chunk-prewarming.md`.
- [x] Per-transition profiler and render-state key memoization. See `nextSteps.md`.

## Validation commands

```bash
npm run build
npm run lint
npm test
```

For transition/performance work, include browser profiler output or summarized `__dwTransitionStats()` results when possible.