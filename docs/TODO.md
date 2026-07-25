# TODO

Keep this file short and actionable. It is not a design document or changelog.

## Agent maintenance rule

- Check off items when completed and include the validation command or reason in the PR/commit summary.
- Add newly discovered deferred work here if it is concrete and still relevant.
- If validation cannot be completed, record the failure or unavailable environment in the final report.
- Do not dump broad design notes here. Link to detailed docs instead.

## High priority

- [ ] Regenerate baked wall templates for the official campaign rooms whose baked hash is stale (dev console logs `[wallTemplate] roomId=… source=fallback reason=stale_hash` for at least: bend, seal_chamber, the_fall, lobby, tall_shaft, chasm, overgrown_shaft, underwater_lake, magma_corridor, a_big_ask, lava_tube, crimson_throne). Until regenerated, every load of these rooms skips the baked fast path and rebuilds wall templates via the incremental merge fallback. Re-export the rooms from the editor (or run the bake path) so `bakedWallTemplate` matches current wall data.
- [ ] Capture live browser transition timings for representative rooms using `__dwBenchPingPong(roomA, roomB, iterations)` and inspect `__dwTransitionStats(n)`.
- [ ] Based on measured transition phases, choose the next bottleneck to optimize rather than speculating.
- [ ] Verify whether first-entry resident wall-template builds on very large rooms still cause visible frame spikes.
- [ ] Verify sprite/background decode behavior on first entry after the current decode-aware preload work.
- [ ] Continue hardening resident-room / zone-resident loading toward the goal of room-level instant transitions and longer loading only between zones.
- [ ] Protect map sketch rendering from room-edge artifact regressions. Add narrow tests or visual debug checks if feasible.

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
