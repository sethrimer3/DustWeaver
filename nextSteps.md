# DustWeaver — Next Steps

## Current Documentation Status

This file is a prioritized planning document, not a raw changelog dump.
Historical build notes are archived under **Historical Notes** at the bottom
and are retained only where they still provide useful debugging context.
Active tasks that have been completed are removed from the top sections and
either archived or removed entirely.

---

## Priority 1 — Performance and Transition Safety

### Current Status

The core freeze-fix infrastructure is complete and production-safe (BUILD 389
through this pass).  The main remaining risks are documented below.

### What Was Fixed in This Pass (BUILD 390)

1. **`roomPreloadScheduler.ts` — worker-unavailable heavy-room path**
   Previously, when the Web Worker was unavailable (Safari Private, strict CSP)
   and a heavy room's idle timeout fired, the scheduler built the room synchronously
   on the main thread — potentially freezing gameplay for hundreds of milliseconds.

   Changed: when `deadline.didTimeout` fires for a room above the cost threshold
   and the worker is still unavailable, the speculative preload is **skipped**
   rather than forced.  The existing async loading overlay will cover any
   resulting cache miss if the player actually transitions to that room.

   Dev log: `[preload] <roomId> (radius-N): skipping heavy speculative preload
   (estimated Xms, worker unavailable). Async overlay will cover any transition
   cache miss.` — visible in DEV builds only.

2. **`roomPreloadScheduler.ts` — stale header comments updated**
   Removed references to `EdgeExtensionCache` (legacy-only, not built at runtime).
   Corrected description of radius-1 behavior (was "always synchronous"; now
   describes worker dispatch and skip-on-unavailable logic accurately).

3. **`preparedRoomRuntime.ts` — safe urgent-build variant added**
   Added `tryEnsureRoomPreparedIfCheap(roomId, cache, maxCostMs?)` which
   applies the build-cost heuristic before deciding whether to build
   synchronously.  Returns `false` (without building) if the estimated cost
   exceeds `maxCostMs` (default: `SAFE_SYNC_BUILD_COST_MS = 8 ms`).  Use
   this instead of `ensureRoomPrepared` from active gameplay paths.
   Added `_estimateRoomBuildCostMs` as a local helper (avoids circular import
   with `roomPreloadScheduler.ts` which already uses an identical heuristic).
   Exported `SAFE_SYNC_BUILD_COST_MS` constant for consistent threshold sharing.

4. **`blockEdgeShading.ts` — budget guard documentation**
   Added a prominent ⚠️ warning to the `applyOrganicEdgeShading` JSDoc noting
   that callers must check `FP.isBakeBudgetExhausted()` before invoking it,
   with pointers to `proceduralBlockSprite.ts` and `folderBlockThemes.ts` as
   reference implementations of correct usage.

### Remaining Risks

1. **Sprite/chunk warm-up lag on cold entry**
   With caps of 8 bakes/frame and 4 chunks/frame, a fresh room converges over
   ~10–20 frames.  Tiles near the camera may briefly show the dark fallback
   fill.  If noticeable, increase `spriteBakeMaxPerFrame` or `_maxChunksPerFrame`
   from the console.

2. **Worker unavailable — heavy rooms no longer freeze, but also not preloaded**
   Heavy adjacent rooms are now skipped instead of synchronously built when the
   worker is unavailable.  Cache-miss transitions to such rooms will hit the
   async loading overlay.  This is the correct tradeoff for gameplay smoothness,
   but users on Safari Private or strict CSP environments will see the overlay
   more often for large rooms.

3. **`applyOrganicEdgeShading` direct callers**
   Any future code that calls `applyOrganicEdgeShading` directly (bypassing
   `folderBlockThemes.ts` or `proceduralBlockSprite.ts`) must add its own
   `FP.isBakeBudgetExhausted()` guard.  The budget is enforced at the caller
   level, not inside `blockEdgeShading.ts`, to avoid architecture coupling.

4. **Phase D wall template build timing**
   `buildRoomWallTemplate()` on a large room is O(n²) and may exceed 16 ms.
   It runs in Phase D (one phase per RAF frame behind the loading overlay), so
   it does not block normal gameplay, but Phase D itself may be a slow frame
   visible in the Freeze debug panel.  Worker-preloaded rooms bypass this entirely.

### How to Verify

1. `npm run build` — must pass with no type errors.
2. Enter large adjacent rooms repeatedly in all four directions.
3. Test with worker available (normal Chrome): transitions should be instant or
   use the loading overlay with no gameplay freeze.
4. Test with worker unavailable if feasible (Safari Private / DevTools → Block
   Workers): large rooms should use the async loading overlay on first visit;
   no multi-second freeze should occur.
5. Check the Freeze debug panel (pause menu → Debug → Freeze) — no `preload`
   entries >8 ms during normal gameplay.
6. Confirm no stale `EdgeExtensionCache` runtime references remain in active
   comments (legacy items are isolated in `src/render/transitions/legacy/`).

---

## Priority 2 — Block Seam Blending Polish

### Implemented in This Pass

1. **Custom sprite asset support.**  `seamBlending.ts` now loads artist-authored
   PNGs from `ASSETS/SPRITES/BLOCKS/transitions/generic/{profile}/edge_{N|E|S|W}_01.png`
   (plus optional `corner_inner_01.png`, `corner_outer_01.png`, `diagonal_01.png`).
   Missing sprites are cached as misses after the first 404 — no per-frame fetch
   cost.  Procedural stamps remain the fallback when sprites are absent.
   `preloadTransitionSprites(profiles)` warms the cache at room load time.

2. **Explicit profile overrides.**  `EXPLICIT_PROFILES` in `seamBlending.ts` is
   an override map checked before keyword heuristics.  Profile resolution order:
   explicit map → keyword heuristic → none.  Add entries to `EXPLICIT_PROFILES`
   when a new block theme's ID doesn't match any keyword correctly.

3. **Editor backdrop live-previews seam blending changes.**  `editorController.ts`
   now calls `setActiveSeamBlending(mode)` immediately on dropdown change, which
   invalidates the chunk cache so the backdrop updates without a playtest cycle.

4. **Corner and diagonal seam accents.**  Inner corners (where two orthogonal
   seam edges meet) and diagonal-only contacts (tiles that touch only at a corner)
   both receive small procedural accent stamps.  Custom `corner_inner_01.png` and
   `diagonal_01.png` sprites are used when present.  Accents are sparse and
   deterministic (hash-seeded, no flicker).

5. **Per-mode density tuning.**  `intensityDensity(mode)` returns 0.5 / 1.0 / 1.4
   for subtle / organic / heavy.  Each stamp function scales its count or skip
   threshold by the density multiplier, so subtle is noticeably sparser and heavy
   is noticeably denser — not just more opaque.

### Remaining Limitations

1. **No artist-authored transition sprites exist yet.**  The hooks and fallback
   are in place; someone still needs to create the PNG assets.

2. **`EXPLICIT_PROFILES` is empty by default.**  Manual entries are needed as
   new themes are introduced that the keyword heuristic misidentifies.  The map
   includes a comment block with examples.

---

## Priority 3 — Dust Weaver Architect Polish

1. **Hit-flash visual on the Architect core** — `dwaHitFlashTicks` is tracked
   in `ClusterState` and decremented each tick, but the renderer does not yet
   read it.  Add a quick alpha/color boost in `dustWeaverArchitectRenderer.ts`
   when `snap.dwaHitFlashTicks > 0`.

2. **Dust Nail secondary attack** — A simple projectile fired when the player
   stays at range for too long (low-priority; construction pressure is the
   primary threat).

3. **Variant fine-tuning** — The `large` variant uses the same patterns with
   higher HP/block counts.  Dedicated 5-block patterns in `DWA_PATTERNS` would
   give it a more distinct feel.

4. **Wall-jump suppression near Architect Blocks** — Architect Blocks are
   hazard entities, not real tiles, so they do not affect
   `playerWallSurface` eligibility.  If wall-interaction feels wrong near
   blocks, add a proximity check in the wall-surface pass.

5. **Per-Architect block-count cap enforcement** — `DWA_MAX_BLOCKS_PER_ARCHITECT`
   is defined but enforced only via pattern-size choice; a counted guard would
   be more robust when several Architects are active.

---

## Verification Checklist

- [ ] `npm run build` passes
- [ ] Enter large adjacent rooms repeatedly in all four directions
- [ ] Test with worker available
- [ ] Test with worker unavailable if feasible
- [ ] Check Freeze debug panel — no unexpected `preload` spikes during gameplay
- [ ] Cache-hit transitions remain instant
- [ ] Cache-miss transitions use the async loading overlay
- [ ] Confirm no stale `EdgeExtensionCache` runtime references in active comments
- [ ] No legacy fancy transition or edge-extension code reactivated

---

## Historical Notes

Build notes are condensed here for debugging context only.  They are not
current tasks.

---

### BUILD 392 — Golden Dust Guide Path Fixes + Timer Persistence

Key fixes: `guideDustPaths` never loaded at runtime (missing mapping in
`roomJsonLoader.ts`); per-point speed control added across the full pipeline;
arc-length parameterized renderer with smooth speed interpolation and lateral
jitter; duplicate FP lifecycle removed from `gameRender.ts`; timer persistence
ordering fixed in `gameOverlayController.ts`.

---

### BUILD 389 / 390 — Freeze Fix Infrastructure

**Infrastructure added:**
- `src/debug/perfFreezeProfiler.ts` — global dev-only per-frame freeze profiler
  with 120-frame ring buffer.  Tracks wall/bg chunk builds, sprite bakes,
  edge-shading calls, layout work, room preload tasks, and load-phase sub-steps.
  `isBakeBudgetExhausted()` / `spriteBakeMaxPerFrame=8` work in both dev and
  production.
- Wall/bg chunk cap: 4 rebuilds/frame (`chunkRenderCache.ts`).
- Sprite bake cap: 8 bakes/frame (production-safe; `folderBlockThemes.ts`,
  `proceduralBlockSprite.ts`).
- Layout signature replaced with fast LCG hash (`blockWallLayoutCache.ts`).
- Radius-1 rooms above 8 ms estimated cost dispatched to Web Worker
  (`roomPreloadScheduler.ts`).

**Known bugs fixed in this pass (BUILD 390):**
- Worker-unavailable timeout-forced heavy-room build now **skips** instead of
  synchronously building on the main thread.

**Remaining known issues after BUILD 390:**
- Sprite/chunk warm-up lag (~10–20 frames on cold entry) — intentional tradeoff.
- Worker-unavailable path skips heavy rooms; async overlay covers cache misses.

---

### BUILD 388 — Legacy Transition Cleanup

All fancy transition systems (edge-extension cache, preview bubbles, camera
reveal, two-room crossing, seamless staging) removed from active gameplay.
Active code uses exclusively `ENABLE_SIMPLE_ROOM_TRANSITIONS = true`.
Legacy files isolated under `src/render/transitions/legacy/`.
`buildPreparedRoomRuntime` and the preparation worker build 3 passes only:
walls, blockers, decorations.

---

### BUILD 387 — Web Worker Migration for Room Preloading

`roomPreparationWorker.ts` and `roomPreparationWorkerProtocol.ts` added.
Heavy radius-2 rooms (>80 ms estimated cost) dispatched to a lazily-created
reusable Worker with zero-copy typed-array transfer.  Fallback: synchronous
build on idle timeout (worker-unavailable case; now improved in BUILD 390 to
skip heavy rooms instead of building synchronously).

---

### BUILD 386 — Room Loading & Preload Freeze Fixes

Fixed: `navigate('mainMenu')` destroyed the official campaign cache before
the player pressed Play.  Transition missing-target recovery deduplicated to
fire once per event.  `estimateRoomBuildCostMs` heuristic added.  Radius-2
heavy room throttling introduced.

---

### BUILD 376 — Non-Blocking Room Preloading (Pass 1)

Replaced synchronous `ensureRoomPrepared()` in the proximity-preload path
with `_preloadScheduleHandle?.prioritize(_tId)` (async, never blocks the
frame).  `requestIdleCallback` timeout raised to 4000 ms.  Deadline
time-budgeting (`MIN_IDLE_BUDGET_MS = 20`) added.

---

### BUILD 374 — Campaign Spawn Starting Options

`CampaignSpawnData` extended with `startingHealth`, `startingDustContainerCount`,
`startingDustTypes`, `startingWeaves`.  Editor inspector supports these fields.

**Remaining items (deferred):**
- Multi-dust spawn on first room load only uses the first unlocked kind.
- Folder-based campaign starting options not yet applied.
- Official campaign starting options not yet applied.

---

### BUILD 359 — Combat/Dust Integration Polish

Storm Weave gating, mote/particle sync invariant, hot-path allocation fixes,
legacy combat path documentation.

**Remaining items (deferred):**
- Mote kind colors for sword blade and arrows (snapshot change needed).
- Visual spent-state for depleted mote particles.
- Vestigial player attack/block input paths not yet removed.

---

### BUILD 356 — Simple Room Transitions Confirmed

`ENABLE_SIMPLE_ROOM_TRANSITIONS = true` confirmed correct; all four crossing
directions verified.  `cancelCameraTransition` hardened.

---

### BUILD 319 — Performance & Seamless Crossing Improvements

Shadow occluder allocation reduction, decoration bloom allocation reduction,
environmental dust wall spatial partitioning, staged room background rendering,
camera settling after seamless crossing.  Seamless-crossing path is currently
dormant (`ENABLE_TWO_ROOM_CAMERA_CROSSING = false`).

**Deferred (requires ENABLE_TWO_ROOM_CAMERA_CROSSING):**
- Staged room hazards / enemies / ropes not preserved across `loadRoom()`.

---

### BUILD 318 — Campaign Spawn Trigger & Fade From Black

`CampaignSpawnData` model, editor placement, official campaign spawn from
registry, fade-from-black on campaign start.
