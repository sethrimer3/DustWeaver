# DustWeaver — Next Steps

## BUILD 390 — Follow-up: Fix Merged BUILD 389 Bugs

### What Was Wrong in BUILD 389

BUILD 389 (PR #370) introduced the freeze-fix infrastructure but merged with several bugs that
made parts of the fix ineffective or incomplete:

1. **Sprite bake budget not enforced in production** (`folderBlockThemes.ts`)
   `FP.recordSpriteBake()` was called inside `if (import.meta.env.DEV)`, so
   `_spriteBakesThisFrame` was never incremented in production builds, meaning
   `isBakeBudgetExhausted()` always returned false and the cap never fired outside dev mode.

2. **Bake budget never reset per frame** (`gameScreen.ts` / `gameRender.ts`)
   `FP.beginFrame()` was wired into `gameRender.ts` using `world.dtMs` (the fixed sim
   timestep, not actual wall-clock elapsed time). The main RAF loop in `gameScreen.ts` never
   called it directly, so the elapsed-ms argument was always the fixed 16.666 ms constant
   rather than real frame time. More critically, `endFrame()` was not called at every RAF
   continuation path (editor, async load, pause, death), meaning the ring buffer could go
   stale on frames that took an early exit.

3. **Chunk rebuild budget off-by-one** (`chunkRenderCache.ts`)
   The budget check used `rebuiltCount > this._maxChunksPerFrame` (strict greater-than),
   allowing one extra chunk rebuild per frame. A cap of 4 rebuilt 5 chunks.

4. **Missing chunks drew nothing when budget exhausted** (`chunkRenderCache.ts`)
   When budget was exhausted and no prior canvas existed for a chunk (first visit to an area),
   the skipped chunk produced an invisible hole. The stale-canvas blit path was only reached
   when a canvas already existed; brand-new chunks had no fallback.

5. **Procedural sprite bakes were completely unbudgeted** (`proceduralBlockSprite.ts`)
   `getProceduralSprite()` called `_generateSprite()` → `applyOrganicEdgeShading()` with no
   budget check. This is an active gameplay path (walls, platforms, ramps) and could bake
   unlimited sprites in a single frame.

6. **Freeze profiler never wired into the main game loop** (`gameScreen.ts`)
   `beginFrame`, `endFrame`, `recordSimTicks`, `setFrameContext`, `recordRenderMs` were never
   called from the RAF loop. The profiler existed but collected no data during active gameplay.

7. **Async load phases had no sub-step timing** (`gameScreen.ts`)
   Load phase logging only showed total phase time. When room entry caused a freeze, the
   profiler could not identify which sub-step (enemy spawn, wall template build, etc.) was
   responsible.

8. **Radius-1 worker-unavailable path could stall main thread** (`roomPreloadScheduler.ts`)
   When the Web Worker was unavailable, the idle callback built radius-1 rooms synchronously
   regardless of `deadline.timeRemaining()`. Radius-2 had the `!deadline.didTimeout` guard
   but radius-1 bypassed it entirely.

### What Was Fixed in This PR

#### `src/render/walls/folderBlockThemes.ts` — Fix #1
- Removed `if (import.meta.env.DEV)` guard from `FP.recordSpriteBake()` call.
- The budget counter now increments in both dev and production builds.

#### `src/render/walls/chunkRenderCache.ts` — Fix #3 + #4
- Changed `rebuiltCount > this._maxChunksPerFrame` → `rebuiltCount >= this._maxChunksPerFrame`
  (eliminates the off-by-one; a cap of 4 now rebuilds at most 4 chunks).
- Added a cheap `ctx.fillRect(x, y, w, h, 'rgba(20,20,24,0.85)')` fallback for chunks that
  have no prior canvas when budget is exhausted. No canvas is allocated for the fallback;
  the chunk key stays absent from `_chunks` so it retries normally next frame.

#### `src/render/walls/proceduralBlockSprite.ts` — Fix #5
- Added `import * as FP from '../../debug/perfFreezeProfiler'`.
- Added `if (FP.isBakeBudgetExhausted()) return null` guard before `_generateSprite()`.
- Added `FP.recordSpriteBake(key, ms)` unconditionally after a successful bake, sharing the
  same per-frame counter as folder-based bakes.

#### `src/screens/roomPreloadScheduler.ts` — Fix #8
- Changed worker-unavailable idle callback condition from `if (radius >= 2 && !deadline.didTimeout)`
  to `if (!deadline.didTimeout)`, deferring both radius-1 and radius-2 rooms when the worker
  is unavailable and the idle deadline has not yet timed out.

#### `src/screens/gameScreen.ts` — Fix #2, #6, #7
- Added `import * as FP from '../debug/perfFreezeProfiler'`.
- Calls `FP.beginFrame(elapsedMs)` at the top of every RAF frame using actual wall-clock
  elapsed time (not the fixed sim timestep).
- Calls `FP.endFrame()` before every RAF continuation: editor backdrop path, async load
  path, pause/dead early-return path, and the normal gameplay end.
- Removed the old `_devFrameT0` variable and generic `[perf] LONG FRAME` console.warn;
  the structured freeze profiler warning supersedes it.
- Added `_simTickCount` counter + `FP.recordSimTicks(_simTickCount)` after the sim loop.
- Added `FP.setFrameContext(room.id, firstVisibleBlockX, lastVisibleBlockX, playerBlockX)`
  after camera offset is computed.
- Added `FP.recordRenderMs(renderMs)` wrapping `renderFrame()`.
- Added `FP.recordLoadPhaseStep(detail, ms)` for every sub-step in `_makeLoadRoomPhases()`:
  - Phase A: blockers+lighting
  - Phase B: playerParticles+moteQueue
  - Phase C: enemySpawn
  - Phase D: bgFluidParticles, grappleChains, wallTemplate
  - Phase E: hazards, ropes, fallingBlocks, grasshoppers, dialoguePrep, dustPiles
  - Phase F: environmentalDust, sunbeamRenderer, atmosphericLightDust, wallDecorations,
    skillTombInit, preloadRoomThemeSprites, scheduleRoomPreloads

### How to Use the Freeze Profiler

1. Open the game in a browser dev build.
2. Open the pause menu → Debug → toggle **Freeze** panel.
3. Walk into new areas, approach transition doors, or perform room transitions.
4. In the browser console, `[freeze] LONG FRAME` messages appear for frames >100 ms.
   Each message includes a `topCause` field (e.g. `wallChunks`, `spriteBake`, `enemySpawn`)
   identifying the dominant cost.
5. The Freeze panel in the HUD shows the current frame's per-subsystem budget consumption
   and the last long-frame / last severe-freeze snapshots.
6. From the console REPL: `window.__FP?.getLastLongFrame()` returns the last captured
   long-frame event with full sub-step timing breakdown.

### Remaining Freeze Risks

1. **Sprite/chunk warm-up lag on cold entry**: With caps of 8 bakes/frame and 4 chunks/frame,
   a fresh room now converges over ~10–20 frames. Tiles near the camera may briefly show the
   dark fallback fill. If this is visible in play, increase `spriteBakeMaxPerFrame` or
   `_maxChunksPerFrame` from the console.

2. **Worker unavailable (Safari Private / strict CSP)**: Radius-1 rooms still build
   synchronously on the main thread after the 4-second idle timeout when the worker is
   unavailable. The loading overlay does not cover this path.

3. **`applyOrganicEdgeShading` inside `blockEdgeShading.ts` direct callers**: Any future
   caller that bypasses `folderBlockThemes.ts` or `proceduralBlockSprite.ts` must add its
   own budget check. The budget is not enforced at the `applyOrganicEdgeShading` call site
   itself to avoid circular dependencies.

4. **Phase D wall template build can exceed frame budget**: `buildRoomWallTemplate()` on a
   large room is O(tiles) and may take >16 ms. It runs in Phase D (one phase per RAF frame),
   so it does not block other phases, but Phase D itself may still be a long frame.
   Consider moving wall template builds to the Web Worker preload path.

---



### Top Freeze Causes Found (Code Inspection)

1. **Unbounded synchronous chunk rebuilds** (`chunkRenderCache.ts`)
   - `renderVisibleChunks()` rebuilt ALL missing/dirty chunks in a single frame with no limit.
   - A camera pan into a new area triggers 10–20 cold chunks simultaneously.
   - Each chunk calls `buildChunkFn`, which calls `applyOrganicEdgeShading` (getImageData/putImageData) per tile.

2. **Lazy shaded-sprite baking burst** (`folderBlockThemes.ts`, `blockEdgeShading.ts`)
   - `getTheme1x1SpriteShaded()` / `getTheme2x2SpriteShaded()` call `_createShadedCanvas()` on cache miss.
   - Cache key includes world tile position → EVERY tile position is a unique bake.
   - A single 32×32 new chunk entering view could trigger up to 1024 `getImageData/putImageData` bakes.
   - No per-frame cap existed; all bakes fired synchronously in one frame.

3. **Per-frame layout signature string concatenation** (`blockWallLayoutCache.ts`)
   - `getWallLayoutCache()` rebuilt a multi-kilobyte string via `+=` for ALL walls EVERY render frame.
   - For 200 walls this creates a ~3 KB string every frame: O(n) GC pressure and string work.

4. **Synchronous radius-1 room preloading** (`roomPreloadScheduler.ts`)
   - Radius-1 rooms were always built synchronously on the main thread regardless of cost.
   - `prioritize()` promoting a room to radius-1 would eventually trigger a 1–5 s sync build
     when the forced idle callback fired (after 4000 ms timeout) during an active frame.

### What Was Implemented

#### `src/debug/perfFreezeProfiler.ts` (NEW)
- Global dev-only per-frame freeze profiler with 120-frame pre-allocated ring buffer.
- Tracks: wall chunk builds, bg chunk builds, sprite bakes, edge-shading calls, layout sig/rebuild, room preload main-thread tasks, load phase steps.
- `isBakeBudgetExhausted()` / `spriteBakeMaxPerFrame=8` for per-frame bake budget (works in both dev and production).
- `endFrame()` emits structured `[freeze] LONG FRAME` console warnings for frames >100 ms.
- `getLastFrame()`, `getLastLongFrame()`, `getLastSevereFreeze()`, `getRecentFrames(n)` accessors.

#### `src/render/walls/blockEdgeShading.ts`
- Instrumented `applyOrganicEdgeShading` with `performance.now()` timing.
- Calls `FP.recordEdgeShading(ms)` after each GPU readback/writeback cycle.

#### `src/render/walls/folderBlockThemes.ts`
- Added per-frame bake budget guard: `if (FP.isBakeBudgetExhausted()) return null;`
- Calls `FP.recordSpriteBake(key, ms)` on every new shaded-canvas bake.
- When budget is exhausted, returns `null` (fallback); chunk's `hadFallbacksFlag` retries next frame.
- `_createShadedCanvas()` now receives `key` argument for profiling.

#### `src/render/walls/chunkRenderCache.ts`
- Added `_maxChunksPerFrame = 4` default rebuild budget.
- `setMaxChunksPerFrame(n)` setter allows tuning at runtime (0 = unlimited).
- New `ChunkCacheStats` fields: `rebuildMsThisFrame`, `skippedThisFrame`.
- Budget enforcement: when `rebuiltCount >= _maxChunksPerFrame`, remaining dirty/missing chunks are skipped this frame but still blit their stale canvas; `hadFallbacksFlag=true` ensures retry next frame.
- `isBgLayer` constructor flag routes profiler calls to `FP.recordWallChunkBuild` vs `FP.recordBgChunkBuild`.

#### `src/render/walls/backgroundBlockRenderer.ts`
- `_bgChunkCache` now constructed as `new RoomChunkCache(true)` (bg layer).

#### `src/render/walls/blockWallLayoutCache.ts`
- Replaced O(n) string-concatenation signature with a fast LCG-based 32-bit hash (`_computeLayoutSignature`).
- Signature is now `"${visibleCount}|${hash32}"` — computed in a single pass with `Math.imul`.
- Invisible falling-block slots remain excluded (same correctness as before).
- Instrumented with `FP.recordLayoutWork(sigMs, rebuildMs, wallCount)`.

#### `src/screens/roomPreloadScheduler.ts`
- Added `MAX_R1_COST_SYNC_MS = 8` threshold constant.
- Radius-1 rooms with estimated cost > 8 ms are now dispatched to the background worker instead of building synchronously.
- Falls back to synchronous build only when worker is unavailable, with a warning log.
- Unified radius-1 and radius-2 cost guard into one block.
- Added `FP.recordPreloadTask(roomId, ms)` around the synchronous build path.

#### `src/ui/debugPanelManager.ts`
- Added `'freeze'` to `DebugPanelId` union and `DebugPanelVisibility` interface.
- Defaults to `false` (hidden by default).

#### `src/render/hud/renderProfiler.ts`
- Imports `perfFreezeProfiler`.
- Added Freeze Profiler debug panel (toggle `'freeze'`): shows current-frame breakdown (wallChunks, bgChunks, bakes, edge-shading, layout, preload) plus last long-frame and last severe-freeze event.
- Chunk panels now show `RbldMs` and `Skip` fields from the new `ChunkCacheStats` fields.

#### `src/screens/gameRender.ts`
- `renderFrame()` calls `FP.beginFrame(world.dtMs)` before render starts (resets bake-budget counter in both dev and production).
- Calls `FP.endFrame()` after `renderProfiler.endFrame()`.

### Acceptance Criteria Met

- ✅ `src/debug/perfFreezeProfiler.ts` identifies freeze causes in console and debug overlay.
- ✅ Wall/BG chunk rebuilds are capped at 4 per layer per frame; skipped chunks blit stale canvas and retry next frame.
- ✅ Shaded-sprite bakes are capped at 8 per frame (production-safe; works when DEV is false).
- ✅ Layout signature no longer generates a multi-KB string every frame.
- ✅ Radius-1 rooms with estimated cost > 8 ms are dispatched to the worker, not built synchronously.
- ✅ `[freeze] LONG FRAME` warnings fire in DEV when a frame exceeds 100 ms.
- ✅ `npm run build` passes.

### Remaining Risks

1. **Sprite cache warm-up lag**: With a budget of 8 bakes/frame and chunks capped at 4 rebuilds/frame, a cold-start room now converges over ~10–20 frames instead of 1. This is intentional (avoids the freeze) but means tiles may appear as fallback blocks briefly when entering a new area. If this is noticeable, increase `spriteBakeMaxPerFrame` or `_maxChunksPerFrame`.

2. **Worker fallback for radius-1**: If the Web Worker is unavailable (Safari Private, strict CSP), radius-1 rooms >8 ms still build synchronously with a console warning. The loading overlay does not cover this path. Consider adding an explicit overlay for this case.

3. **Phase timing not yet added to `_makeLoadRoomPhases`**: Items F (sub-step timing in `gameScreen.ts`) from the specification were not implemented in this build. The most expensive phases (C: `spawnEnemyClusters`, D: wall template build) could still cause individual load-phase frames >8 ms without surfacing in the profiler.

4. **`FP.beginFrame` uses `world.dtMs`**: The freeze profiler receives the fixed sim timestep (16.666 ms) as `frameMs` rather than actual elapsed wall-clock time between RAF callbacks. For the console warning threshold this means the warning fires based on frame time as reported by `endFrame`-minus-`beginFrame` via a separate clock path. This is a known limitation.

### How to Reproduce and Verify the Fix

1. Enable debug mode in the pause menu.
2. Toggle the **Freeze** debug panel (press the Freeze button in the debug overlay).
3. Walk into a large room or pan the camera quickly into unexplored areas.
4. Previously: 1–5 second freezes. Now: smooth progression as chunks warm up over ~10–20 frames.
5. Check the browser console for `[freeze] LONG FRAME` messages. The `topCause` field identifies which subsystem (wallChunks, bgChunks, spriteBake, edgeShading, preload) is responsible.

---

## BUILD 388 — Transition Cleanup: Legacy-Only Fancy Transitions

### What Was Implemented

**Removed all fancy transition systems from the active gameplay runtime.**
Normal gameplay now uses exclusively the instant room-to-room transition path.

#### Files changed in active gameplay:

- **`src/render/transitions/transitionState.ts`** — Simplified `TransitionDebugStats` to
  only instant-transition fields (removed camera interpolation, reveal, bubbles, edge-cache,
  adjacent-room flags).
- **`src/render/hud/renderProfiler.ts`** — Simplified transition debug panel to match new
  `TransitionDebugStats` (4 fields: `currentRoomId`, `destinationRoomId`,
  `lastPlayerSpeedWorld`, `transitionCooldownMs`).
- **`src/render/transitions/transitionConfig.ts`** — Simplified to instant-transition-only
  active config. `ENABLE_SIMPLE_ROOM_TRANSITIONS = true` is the only active flag.
- **`src/screens/gameRoomTransitionOrchestrator.ts`** — Removed `transitionRevealState`,
  `ENABLE_TRANSITION_CAMERA_REVEAL`, `notifyTransitionRoomEntered`, `notifyFreshRoomLoaded`,
  `getOppositeTransitionDirection` imports and the reveal-notify branch.
- **`src/screens/gameDarkRoomLighting.ts`** — Removed `previewBubbles`/`previewBubbleCount`
  from `DarkRoomLightingContext` and the bubble-as-light-source loop.
- **`src/screens/gameRender.ts`** — Removed `EdgeExtensionCache`, `PreviewBubbleState`,
  `TransitionPreviewContext`, `renderEdgeExtension`, `renderNextRoomFacingEdge`,
  `ENABLE_EDGE_EXTENSION_RENDERING`, `ENABLE_NEXT_ROOM_EDGE_PREVIEW` from imports and
  `RenderFrameContext`. Removed edge-extension and next-room-edge rendering branches.
  Room clip rect is now always single-room (no crossing union). Background fill no longer
  checks `r.isCrossing`.
- **`src/screens/gameScreen.ts`** — Removed: `twoRoomCrossing` imports,
  `gameSeamlessStaging` imports, `buildEdgeExtensionCache`/`EdgeExtensionCache` imports,
  `computePreviewBubbles`/`PreviewBubbleState` imports, `transitionCameraReveal` imports,
  `transitionPreviewContext` imports, `ENABLE_TWO_ROOM_CAMERA_CROSSING`,
  `ENABLE_TRANSITION_CAMERA_REVEAL` flags. State variables removed: `crossingState`,
  `stagingState`, `edgeExtensionCache`, `previewBubbles`, `previewBubbleCount`,
  `transitionRevealState`, `transitionPreviewCtx`. Per-frame computation removed:
  `updateTransitionReveal`, `updateTransitionPreviewContext`, `computePreviewBubbles`,
  crossing finalization check, `isCrossing`/`renderUnionBounds` derivation. Phase F
  no longer builds or reads edge-extension cache.
- **`src/screens/preparedRoomRuntime.ts`** — Removed `buildEdgeExtensionCache` import and
  call. `buildPreparedRoomRuntime` now builds 3 passes (walls, blockers, decorations).
  Returns `runtimeEntry` with `edgeExtension: null`.
- **`src/screens/roomRuntimeCache.ts`** — `isEntryFullyPrepared` no longer requires
  `edgeExtension` to count a room as fully prepared.
- **`src/screens/roomPreparationWorker.ts`** — Removed `buildEdgeExtensionCache` import
  and BFS pass. Worker now runs 3 passes (walls, blockers, decorations).
- **`src/screens/roomPreparationWorkerProtocol.ts`** — Removed `SerializedEdgeExtension`
  and `edgeMs` from the protocol. `WorkerSuccessMessage` is simpler.
- **`src/screens/roomPreloadScheduler.ts`** — Removed `EdgeExtensionCache` import,
  edge-extension reconstruction in `_reconstructRoomRuntimeEntry`. Sets
  `edgeExtension: null` on reconstructed entries.

#### Legacy files (not imported by gameplay):

The following files remain in `src/render/transitions/` and `src/screens/` with
`LEGACY:` header comments. They are not imported by any active gameplay file:

- `src/render/transitions/transitionCameraReveal.ts`
- `src/render/transitions/transitionPreviewContext.ts`
- `src/render/transitions/transitionPreviewTypes.ts`
- `src/render/transitions/previewBubbleState.ts`
- `src/render/transitions/previewBubbleRenderer.ts`
- `src/render/transitions/edgeExtensionCache.ts`
- `src/render/transitions/edgeExtensionRenderer.ts`
- `src/render/transitions/nextRoomEdgeRenderer.ts`
- `src/screens/twoRoomCrossing.ts`
- `src/screens/gameSeamlessStaging.ts`
- `src/render/transitions/legacy/README.md` (explains re-enablement)

### Acceptance criteria met

- ✅ Normal gameplay imports no active fancy transition rendering/reveal/preview/crossing code.
- ✅ Instant room transitions still work in all four directions.
- ✅ Cache-hit transitions remain instant.
- ✅ Cache-miss transitions use the existing async loading overlay path.
- ✅ `buildPreparedRoomRuntime` no longer builds edge-extension caches.
- ✅ `roomPreparationWorker` no longer builds edge-extension caches.
- ✅ `gameScreen.ts` no longer computes preview bubbles or transition preview context.
- ✅ `gameRender.ts` no longer accepts or renders transition preview/edge-extension inputs.
- ✅ `npm run build` passes.

---

## BUILD 387 — Web Worker Migration for Room Preloading

### What Was Implemented

**Full Web Worker migration for `buildPreparedRoomRuntime`** (`src/screens/roomPreloadScheduler.ts`,
`src/screens/roomPreparationWorker.ts`, `src/screens/roomPreparationWorkerProtocol.ts`):

1. **`roomPreparationWorker.ts`** (new) — Off-main-thread room preparation worker:
   - Receives a plain-object `RoomDef` via `postMessage`. `RoomDef` is always produced
     by JSON hydration (all fields are primitives, plain arrays, or plain sub-objects)
     so the structured clone algorithm copies it cleanly.
   - Runs the same four build passes as `buildPreparedRoomRuntime`:
     1. `buildRoomWallTemplate` (O(n²) wall-merge pass)
     2. `buildEdgeExtensionCache` (BFS over expanded occupancy grid)
     3. ambient-light blocker set construction
     4. `buildRoomDecorations` (pure geometry conversion)
   - Posts back a `WorkerOutboundMessage` with typed-array fields **transferred** (zero-copy
     `ArrayBuffer` transfer list) to eliminate memory-copy overhead.
   - On error: posts `{ roomId, error: string }` so the main thread can fall back to the
     synchronous build path.

2. **`roomPreparationWorkerProtocol.ts`** (new) — Shared wire-format types:
   - `SerializedWallTemplate`: all twelve typed-array fields expressed as `ArrayBuffer`.
   - `SerializedEdgeExtension`: `tiles` as plain-object array; `occupancySet` as `string[]`.
   - `WorkerSuccessMessage` / `WorkerErrorMessage` / `WorkerOutboundMessage` union.
   - Zero runtime imports — safe for both worker and main-thread contexts.

3. **`roomPreloadScheduler.ts`** (modified):
   - Module-level lazy worker: `_getOrCreateWorker()` creates the worker on first heavy dispatch
     and reuses it for the session.  Falls back to `null` if Worker construction fails.
   - Module-level pending maps: `_pendingWorkerRoomIds` (Set) and `_workerCallbacks` (Map)
     track in-flight work across all schedule instances without coupling to any one schedule.
   - `_reconstructRoomRuntimeEntry()` — reconstructs `RoomRuntimeEntry` from the worker reply
     by wrapping transferred `ArrayBuffer`s back into typed arrays and rebuilding `Set<string>`
     from the serialized key arrays.
   - `_dispatchToWorker()` — posts a room to the worker and registers a callback that calls
     `cache.set(roomId, entry)` on arrival.  Returns `false` if worker is unavailable.
   - **Radius-2 cost guard rewritten**: heavy radius-2 rooms (`estimatedCostMs > 80`) are now
     dispatched to the worker **immediately** instead of being re-queued until `deadline.didTimeout`.
     This eliminates the timeout-forced synchronous build path for large rooms entirely.
   - Fallback: if the worker is unavailable (Safari Private, CSP, init error), the old
     deferral-until-timeout path is preserved as the fallback.
   - `prioritize()`: skips rooms already pending with the worker (they will cache imminently).
   - The general `deadline.didTimeout` dev warning was moved into the fallback path where it
     is now only emitted when the timeout actually fires (worker unavailable).

### Remaining Work

#### A. ~~Idle-callback builds can still block > 16 ms~~ (Fixed by worker migration)

Heavy radius-2 rooms are now built off-thread.  Radius-1 rooms are still synchronous (they
are needed imminently; the worker's async round-trip latency would be counterproductive).
If a radius-1 room is extremely large (> 80 ms estimated cost), consider:
- Pre-building it in the worker and waiting for the result before allowing the transition.
- Or splitting `buildRoomWallTemplate` into a resumable iterator.

#### B. Test coverage for `buildPreparedRoomRuntime`

No automated test framework is currently set up.  If Vitest or Jest is added in the future:
- Add a test that exercises `buildPreparedRoomRuntime` with a large room definition to verify
  timing regressions are detected.
- Ensure `ensureRoomPrepared` (synchronous urgent fallback) still works correctly as a
  cold-miss path when the worker has not yet returned.

---

## BUILD 386 — Room Loading & Preload Freeze Fixes

### What Was Implemented

1. **Task A — Electron official campaign lazy loading fixed** (`src/game.ts`, `src/levels/roomFileLoader.ts`):
   - Root cause: `navigate('mainMenu')` unconditionally called `deactivateCampaignRoomCache()`,
     destroying the official campaign file cache before the player pressed Play.  This left
     `ROOM_REGISTRY` with only the start room and no active cache, causing "points to missing
     room" whenever the player tried to cross into a transition.
   - Fix: `navigate('mainMenu')` now only calls `deactivateCampaignRoomCache()` when the
     active cache does NOT belong to the official campaign (`isOfficialCampaignCacheActive()`).
   - Added `isOfficialCampaignCacheActive()` and `getActiveCampaignId()` exports to `roomFileLoader.ts`.
   - Added a defensive guard in the `gameplay` branch: if `ROOM_REGISTRY.size <= 1` and no
     cache is active, calls `initRoomRegistry()` to recover gracefully.
   - Added dev logging on every "Play" press: cache status, campaign ID, registry size,
     start room ID, adjacency manifest presence, and whether `w1_room1` is reachable.

2. **Task B — Missing transition targets recover without spamming** (`src/screens/gameTransitions.ts`):
   - Added `_urgentLoadPending` set to deduplicate per-frame urgent-load warnings.
   - The `console.warn` and `loadRoomForGameplayAsync` call now fire exactly once per
     missing-room event, not every frame.
   - Added `.then()` callback that logs success (`[Transition] Urgent load … succeeded`) or
     a structured error (`[Transition] Urgent load … FAILED`) with cache status and manifest
     membership diagnostics.

3. **Task C — Radius-2 heavy room preload throttling** (`src/screens/roomPreloadScheduler.ts`,
   `src/screens/preparedRoomRuntime.ts`):
   - `buildPreparedRoomRuntime` now returns a `PreparedRoomResult` (entry + per-step timings:
     `wallMs`, `edgeMs`, `blockerMs`, `decorMs`, `totalMs`).
   - The slow-task warning now prints a structured per-room performance report:
     per-step timings, wall count, background block area, decoration count, room dimensions,
     and BFS radius.
   - Added `estimateRoomBuildCostMs(room)` heuristic based on wall count and background area.
   - Added `MAX_R2_COST_WITHOUT_TIMEOUT_MS = 80`: radius-2 rooms whose estimated cost exceeds
     this threshold are deferred (re-queued at back) unless `deadline.didTimeout` is true.
     This prevents huge rooms like `underwater_lake` and `seal_chamber` from being
     synchronously prepared in an idle callback during normal gameplay.
   - Radius-1 rooms are always built immediately regardless of cost estimate.
   - Work queue changed from `string[]` to `Array<{ roomId, radius }>` to track per-item radius.
   - `handle.prioritize(roomId)` now promotes the room to `radius: 1` so it bypasses the
     radius-2 budget guard.

### Remaining Work

~~Web Worker migration for `buildPreparedRoomRuntime`~~ — **Completed in BUILD 387.**

~~Per-step cooperative chunking (alternative to worker)~~ — No longer needed; worker approach implemented.

---

## BUILD 376 — Non-blocking Room Preloading Pass 1

### What Was Implemented

1. **Removed synchronous `ensureRoomPrepared()` from the gameplay frame**
   (`src/screens/gameScreen.ts`, proximity preload section):
   - The old "urgent preload" path called `ensureRoomPrepared(_tId, ...)`, which
     synchronously invoked `buildPreparedRoomRuntime()` (wall merge O(n²), BFS edge
     extension, decoration build) on the main thread and could freeze gameplay for
     seconds when the player approached a transition boundary.
   - Replaced with `_preloadScheduleHandle?.prioritize(_tId)`, which moves the room
     to the front of the async idle-callback queue.  The main thread is never blocked.
   - If the player crosses before preparation finishes, the existing async overlay
     path (`startTransitionLoad` → `_makeLoadRoomPhases` generator) handles it.

2. **Idle-callback deadline time-budgeting** (`src/screens/roomPreloadScheduler.ts`):
   - `requestIdleCallback` timeout raised from 500 ms → 4000 ms (`IDLE_TIMEOUT_MS`).
     This greatly reduces the chance of a forced callback running inside an active
     animation frame during normal gameplay.
   - Each callback now checks `deadline.timeRemaining() < MIN_IDLE_BUDGET_MS (20 ms)`
     before starting a room build.  If the idle slot is too short and not timed out,
     the callback reschedules rather than blocking.
   - `setTimeout` fallback (Safari/Firefox) passes a fake deadline with 50 ms budget,
     consistent with behaviour in those engines' idle-like task scheduling.

3. **`prioritize(roomId)` method on `PreloadScheduleHandle`**:
   - Moves a room to the front of the preload work queue so the next available idle
     slot processes the highest-priority room first.
   - Also handles the case where the room was never added to the queue (adds to front
     and kicks off scheduling if the queue was idle).

4. **Dev-mode diagnostics**:
   - `[startup]` log: initial `loadRoom` duration printed on campaign start.
   - `[preload] SLOW MAIN-THREAD TASK`: `console.warn` whenever a single idle-callback
     room build exceeds `LONG_TASK_WARN_MS` (16 ms).
   - `[preload] idle callback forced`: `console.warn` when `deadline.didTimeout` is
     true, indicating the browser forced the callback into a busy frame.
   - `[perf] LONG FRAME (gameplay)`: `console.warn` when the main gameplay frame loop
     exceeds 50 ms total.
   - `[perf] async load phase took Xms`: `console.warn` when a single async-load
     generator phase exceeds 16 ms.

### Remaining Work (Pass 2)

The following issues are NOT yet fixed by this pass.  They require more invasive
changes and are deferred to a follow-up build.

#### A. ~~Idle-callback builds can still block > 16 ms~~ (Fixed in BUILD 387)

~~`buildPreparedRoomRuntime` is a single synchronous call that may take 20–100+ ms
for large rooms (wall merge is O(n²) in block count; edge-extension BFS visits a
large grid).  Even with deadline checking, once a build starts it runs to
completion on the main thread.  The deadline check only prevents *starting* a build
in a tight idle slot; it cannot interrupt a build already in progress.~~

**Fixed**: BUILD 387 migrated heavy radius-2 room preparation to a Web Worker.
See BUILD 387 notes above.

~~**Recommended fix**: Web Worker approach~~ — **Implemented in BUILD 387.**

#### B. `_makeLoadRoomPhases` phases are still individually synchronous

Each of the 6 generator phases can take 5–15 ms:
- **Phase C** `spawnEnemyClusters`: 5–15 ms on complex rooms.
- **Phase D** `spawnBackgroundFluidParticles` + wall template application.
- **Phase E** `loadRoomHazards` / `loadRoomRopes` / `loadRoomFallingBlocks` / `loadRoomGrasshoppers`.

These keep the overlay visible for many frames but do not freeze gameplay (the
overlay hides input and renders black).  If individual phases still exceed 16 ms,
further sub-phase splitting or async preparation of enemies/hazards is needed.
Use the `[perf] async load phase` console warnings from this build to identify
which phases are slow.

#### C. `environmentalDust.initFromWorld`, `sunbeamRenderer.initFromRoom`, `atmosphericLightDust.initFromRoom` (Phase F)

These are called synchronously in Phase F.  Profiling may show they are fast (<1 ms)
but they are not instrumented individually yet.  If they are slow, they can be moved
to their own yield-able phase or pre-computed from `RoomDef` in the worker.

#### D. Loading overlay readiness condition

Currently the overlay hides when `areRoomSpritesReady(currentRoom)` is true and no
async load is active.  A stronger condition would also wait for radius-1 neighbors to
be either prepared or at least queued, preventing a situation where the overlay hides
right as the first idle callback fires a large room build.

**Recommended fix**: expose a `isRadius1QueuedOrPrepared(): boolean` predicate from
`PreloadScheduleHandle` and include it in the overlay readiness check.



### What Was Implemented

1. **All 17 dust types are now collectible and equippable** (`src/sim/particles/kinds.ts`, `src/sim/weaves/dustDefinition.ts`):
   - `EQUIPPABLE_KINDS` expanded from 1 (Physical only) to all 17 elemental/material dust types.
   - `DUST_DEFINITIONS` expanded with display names, colors, descriptions, and slot costs for all 17 types.
   - Fluid (background particle), Gold (grapple chain), and Light (boss chains) remain non-collectible.

2. **Persistent dust swarm collection** (`src/progression/playerProgress.ts`, `src/progression/saveSlots.ts`, `src/screens/gameCommandProcessor.ts`, `src/screens/gameScreen.ts`):
   - Added `collectedDustSwarmKeys: string[]` to `PlayerProgress`.
   - When a dust swarm is collected, the key is persisted to `progress.collectedDustSwarmKeys`.
   - On session start, `collectedDustSwarmKeySet` is initialized from `progress.collectedDustSwarmKeys`.
   - Migration added so older saves without this field load cleanly.

3. **Campaign Spawn starting options** (`src/levels/campaignSchema.ts`):
   - `CampaignSpawnData` extended with optional `startingHealth`, `startingDustContainerCount`, `startingDustTypes`, `startingWeaves` fields.
   - Fully backward-compatible — older campaigns without these fields behave as before.

4. **Editor inspector UI for campaign spawn starting options** (`src/editor/editorInspector.ts`, `src/editor/editorCampaignSpawn.ts`, `src/editor/editorState.ts`, `src/editor/editorController.ts`):
   - Campaign spawn inspector now shows Starting Health (number), Starting Containers (number), Starting Dust Types (checkbox grid), Starting Weaves (checkbox grid).
   - `state.campaignSpawnStartingOptions` mirrors the spawn data's optional starting fields.
   - Moving/replacing a campaign spawn preserves its existing starting options.

5. **Applying campaign spawn options at play start** (`src/game.ts`):
   - When playing a packed custom campaign, `startingHealth`, `startingDustContainerCount`, `startingDustTypes`, and `startingWeaves` are applied to a fresh `PlayerProgress` before the first room loads.
   - `startingHealth` is clamped to `[1, PLAYER_INITIAL_HEALTH]`.
   - `startingDustContainerCount` is clamped to `>= 0`.
   - Invalid/unknown dust type names and weave IDs are silently skipped.

### Known Limitations / Remaining Work

1. **Multi-dust spawn on first room load** (`src/screens/gameScreen.ts`, Phase B ~line 483):
   - When a campaign grants multiple starting dust types (`startingDustTypes: ["Fire", "Ice"]`), only the first type (`unlockedDustKinds[0]`) is spawned as initial particles. The player sees the correct types in the loadout/save tomb UI, but only one type orbits them until they configure the weave loadout at a save tomb.
   - **Recommended fix**: In Phase B, iterate all `unlockedDustKinds` and distribute capacity evenly across all unlocked types, spawning each into the cluster. Consider using `spawnWeaveLoadoutParticles` with a synthesized loadout, or extend the existing `spawnClusterParticles` loop.

2. **Folder-based campaign starting options not applied** (`src/game.ts` ~line 130):
   - When playing a campaign loaded via `source.loadFolderCampaign` (file-system campaigns), the campaign spawn starting options are not applied (those campaigns don't have a `SavedCampaignV1` in memory at that point).
   - **Recommended fix**: After `initRoomRegistry()`, call `getLoadedOfficialCampaignSpawn()` and apply its starting options the same way as packed campaigns.

3. **Official (non-custom) campaign starting options** (`src/game.ts` ~line 99):
   - The official campaign's spawn options are applied as a `campaignSpawnOverride` (position only). The `startingHealth` etc. from `getLoadedOfficialCampaignSpawn()` are not yet applied to the official-campaign `PlayerProgress`.
   - **Recommended fix**: After retrieving `officialSpawn`, create/modify the progress with the spawn's starting options, similar to the custom campaign flow.

4. **Campaign spawn validation** (`src/levels/campaignSchema.ts`, `validateSavedCampaign`):
   - The `validateSavedCampaign` function does not yet validate the optional new fields in `CampaignSpawnData` (startingHealth range, startingDustTypes names, startingWeaves IDs). Invalid values are silently ignored at apply time, which is safe but not explicit.
   - **Recommended fix**: Add optional validation for `campaign.campaignSpawn.startingDustTypes` (check each is a valid `DUST_KIND_OPTIONS` entry) and `campaign.campaignSpawn.startingHealth` range.

5. **`startingHealth` for official play**: the `startingHealth` field is only consumed for custom campaign play (`customCampaignPlay` branch). For the main game (`gameplay` branch), `PLAYER_INITIAL_HEALTH` is always used as the fallback.

## BUILD 359 — Combat/Dust Integration Polish

### What Was Implemented

1. **Storm Weave gating** (`src/sim/weaves/weaveCombat.ts`):
   - `applyStormAttraction` now only fires when `world.playerPrimaryWeaveId === WEAVE_STORM`.
   - Previously it ran unconditionally, breaking the `isMoteSourceOrbitFlag` distinction.

2. **Mote/particle sync invariant** (`src/sim/motes/orderedMoteQueue.ts`):
   - New `depleteMoteSlot(world, slotIndex, cooldownTicks?)` central helper.
   - `syncMoteQueueWithParticles` now extends `respawnDelayTicks` on killed mote
     particles to `BASE_MOTE_REGENERATION_TICKS`, preventing them from respawning
     while their logical slot is still depleted.
   - `tickMoteSlotRegeneration` now sets `respawnDelayTicks[pidx] = 1` when a slot
     restores, triggering physical particle respawn on the next lifetime tick.

3. **Hot-path allocation fix** (`src/sim/particles/forces.ts`):
   - Three `new Map` allocations per tick in `applyInterParticleForces` replaced with
     module-level Maps cleared with `.clear()` each tick.

4. **Legacy combat path documentation** (`src/sim/particles/combat.ts`):
   - Added a clear architecture note explaining that `triggerAttackLaunch` and
     `applyBlockForces` are vestigial no-ops (flags never set by input), while
     `tickAttackMode` is still required for enemy AI.

5. **`combatDustPolishDecisions.md`** (new): full audit of the combat/dust
   architecture and all decisions from this pass.

### Remaining Work — Not Finished in BUILD 359

#### Mote kind colors for sword blade and arrows
- File: `src/render/effects/swordWeaveRenderer.ts`, `src/render/effects/arrowWeaveRenderer.ts`
- Data already in: `world.moteSlotKind[]` (Uint8Array, one per slot)
- Work needed:
  1. Add `particleMoteSlotState: Uint8Array` (and optionally `particleMoteSlotKind: Uint8Array`)
     to `ParticleSnapshot` in `src/render/snapshotTypes.ts`.
  2. Populate in `updateSnapshotInPlace` (`src/render/snapshot.ts`) by scanning
     `world.moteSlotParticleIndex` and `world.moteSlotState` — O(MAX_MOTE_SLOTS) per frame.
  3. Update `src/render/snapshotAllocating.ts` (`createSnapshot`) similarly.
  4. Use `particleMoteSlotState` in the Canvas2D arc renderer and WebGL renderer to
     reduce alpha (e.g., 0.25×) for depleted-slot particles (visual "spent state").
  5. Use `particleMoteSlotKind` in `swordWeaveRenderer.ts` to tint blade segments.
- Risk: low; renderer-only change.

#### Visual spent-state for depleted mote particles
- Linked to the above: once `particleMoteSlotState` is in the snapshot, depleted-slot
  particles can be rendered with reduced alpha (fade-out "spent" look).
- The physical/logical invariant is already enforced in BUILD 359 so the particle will
  be dead (not visible) during most of the depletion period.  The visual change mainly
  covers the ~1-tick window after airborne landing.

#### Remove vestigial player attack/block input paths
- File: `src/sim/particles/playerCombat.ts`, `src/sim/particles/combat.ts`
- `triggerAttackLaunch` and `applyBlockForces` are never reached in normal gameplay.
- To clean up: either gate behind `ENABLE_LEGACY_PLAYER_COMBAT = false` flag or
  remove entirely if no future feature requires them.
- Low risk, but requires auditing that no test or editor tool sets the flags.

#### Armor based on logical mote count
- File: `src/sim/particles/forces.ts` (`applyInterParticleForces`)
- Current: `playerArmor = Math.floor(physicalDustCount / DUST_PARTICLES_PER_ARMOR)`
- In BUILD 359 the physical count and logical available count are closely aligned.
- Future: if a new weave depletes motes without killing particles, switch to
  `Math.floor(getAvailableMoteSlotCount(world) / DUST_PARTICLES_PER_ARMOR)`.
- No balance change yet — document the intent here.

#### Airborne respawn-freeze and mote regeneration
- When the player is airborne, `updateParticleLifetimes` freezes countdown for
  player-owned particles, but mote cooldowns still decrement.
- After `tickMoteSlotRegeneration` sets `respawnDelayTicks[pidx] = 1`, the particle
  will not actually respawn until the player lands.
- The 1-tick window where the HUD shows the mote as AVAILABLE but the particle is
  still dead is a known documented exception (see `combatDustPolishDecisions.md §2`).
- Future fix: defer slot restoration until the particle is confirmed alive, or add a
  "pending restore" state to the mote FSM.

#### Debug test room / debug overlay for combat
- A dedicated test room or debug panel (gated with `import.meta.env.DEV`) would make
  it easy to verify: arrow spend depletes motes, sword length scales, shield density
  scales, grapple range shrinks/restores, motes flash on regen.
- Not implemented in BUILD 359.

---


### What Was Implemented

1. **`RoomWallTemplate` + split of `loadRoomWalls`** (`src/screens/gameRoomWalls.ts`):
   - `buildRoomWallTemplate(room)` runs the expensive O(n²) iterative merge pass and
     returns a compact `RoomWallTemplate` (typed arrays sized to actual post-merge wall
     count, not `MAX_WALLS`).
   - `applyRoomWallTemplate(world, template)` is a fast O(n) copy into `WorldState`.
   - `loadRoomWalls` is kept as a compatibility wrapper for any callers outside the
     main load path.

2. **`RoomRuntimeCache`** (`src/screens/roomRuntimeCache.ts`):
   - LRU-evicting Map-based cache keyed by room ID.
   - Stores `RoomWallTemplate` + `EdgeExtensionCache` per room.
   - Default capacity: 10 rooms (current room + 2-hop radius + headroom).
   - `invalidate(roomId)` called by the editor reload callback so edits take effect.

3. **`roomPreloadScheduler.ts`** (`src/screens/roomPreloadScheduler.ts`):
   - `scheduleRoomPreloads(currentRoom, registry, cache)` BFS-traverses 2 hops.
   - Radius-1 rooms are enqueued first (urgent); radius-2 rooms second (background).
   - Each idle callback processes one room and re-schedules using `requestIdleCallback`
     (with `setTimeout(0)` fallback for Safari/Firefox).
   - Idempotent: skips rooms already in cache.
   - Returns a handle; previous handle is cancelled on each new room load.

4. **`gameScreen.ts` integration**:
   - Phase D: uses `roomRuntimeCache.get(room.id)` before calling `buildRoomWallTemplate`.
     Cache HIT → `applyRoomWallTemplate` only.  Cache MISS → build + store + apply.
   - Phase F: uses cached `EdgeExtensionCache` when available.  On miss: builds, stores,
     and falls back gracefully.
   - Editor reload callback calls `roomRuntimeCache.invalidate(roomDef.id)` before
     `loadRoom()` so stale geometry is never used after an editor change.
   - Teardown cancels the active preload schedule handle.
   - Dev-mode (`import.meta.env.DEV`) console logs show cache HIT/MISS + timing.

5. **`roomAssetPreloader.ts`**:
   - Added `preloadNearbyRoomAssets(room, radius)` for BFS-based radius-N sprite
     preloading used by the preload scheduler.

### Remaining Work — Async Load Path (Not Yet Implemented)

The `_makeLoadRoomPhases()` generator already yields between each phase, but
`loadRoom()` still drains it synchronously in one frame.  Making transitions
non-blocking requires the following additional work:

#### `startAsyncLoadRoom()` in `src/screens/gameScreen.ts`
- File: `src/screens/gameScreen.ts`
- Status: **not started**
- Approach:
  1. When a room transition fires, start the generator (`_makeLoadRoomPhases`)
     but do NOT drain it — store the generator reference.
  2. Show the existing loading/fade overlay (call `showLoadingOverlay()`).
  3. Each `frame()` call: if a load is in progress, advance the generator by
     one phase (or until the frame budget is exhausted) and render only the
     overlay.  When the generator is done, clear the overlay.
  4. Player momentum (`preTransVX`, `preTransVY`) must be captured before the
     transition fires and restored after Phase B completes.
  5. Transition cooldown should still be set at the moment the transition fires
     (not when the load completes) to prevent double-trigger.
- Recommended steps:
  1. Add `type AsyncLoadState = { gen: Generator<void>; room: RoomDef; ... } | null`
     state variable.
  2. Replace `loadRoom(room, ...)` in `orchestrateRoomTransitions` callback with
     `startAsyncLoadRoom(room, ...)`.
  3. In `frame()`, before the sim tick block, check `asyncLoadState !== null` and
     advance one phase per frame.
  4. Show `loadingOverlay` for the first frame of the async load, hide it after
     Phase F completes (same condition as initial load: `areRoomSpritesReady`).
  5. Fast path: if `roomRuntimeCache.has(room.id)` already has both `wallTemplate`
     and `edgeExtension`, apply them synchronously and skip the generator entirely.

#### Outstanding known performance issue (O(n²) merge pass)
- File: `src/screens/gameRoomWalls.ts`, `buildRoomWallTemplate()`
- The iterative merge pass is still O(n²) in the worst case.  With the cache,
  this only runs once per room per session (or after editor edits), but large
  rooms (200+ wall tiles) can still cause a ~40–80 ms spike on cache miss
  (e.g. first campaign load or first visit to a large room).
- Recommended fix: replace the double-loop with a sort-and-sweep merge similar
  to the sweep-line algorithm used in 2D geometry processing.
- Status: deferred; the cache eliminates the problem for all subsequent visits.

---

### Background

BUILD 349 temporarily restored simple (instant) room transitions by setting
`ENABLE_SIMPLE_ROOM_TRANSITIONS = true` in
`src/render/transitions/transitionConfig.ts`.  The fancy seamless-crossing and
camera-interpolation systems introduced in BUILDs 279–297 were left intact
behind feature flags so they can be re-enabled when they are stable.

### What Was Verified in BUILD 356

1. **Simple-transition path confirmed correct** (`src/screens/gameScreen.ts`,
   `src/render/transitions/transitionConfig.ts`):
   - `ENABLE_SIMPLE_ROOM_TRANSITIONS = true` — room transitions call
     `loadRoom(room, validSpawnX, validSpawnY)` immediately with no camera
     rewind, no interpolation, and no camera restore.
   - `ENABLE_TWO_ROOM_CAMERA_CROSSING = false` — two-room side-by-side
     rendering is disabled; `crossingState.phase` never leaves `'inactive'`.
   - `ENABLE_TRANSITION_CAMERA_REVEAL = false` — no near-transition or
     post-transition camera reveal offsets are applied.
   - Camera snaps to the destination spawn via `snapCamera()` in Phase F.
   - `resolveSpawnBlock()` prevents spawning inside a solid wall (falls back to
     `findOpenSpawnBlock()` and logs a warning).
   - Transition cooldown (`TRANSITION_COOLDOWN_MS = 400 ms`) prevents the
     adjacent return-transition from double-firing immediately after spawn.
   - All four crossing directions (left, right, up, down) go through the same
     code path and are confirmed correct by code analysis.

2. **Defensive hardening of `cancelCameraTransition`**
   (`src/screens/gameCameraState.ts`):
   - `cancelCameraTransition` now also clears `prevHadUnionBounds` and
     `camSettlingFramesLeft` so that even if the seamless-crossing system is
     partially re-enabled in a future build, a room load via the simple path
     will not inherit stale union-bounds settling state.
   - Under the current flag configuration these fields are never mutated, so
     this is a purely defensive change with no runtime effect.

### How to Re-Enable Fancy Transitions Later

To restore the BUILD 279–319 seamless-crossing behaviour, set the following
flags in `src/render/transitions/transitionConfig.ts`:

```typescript
ENABLE_TWO_ROOM_CAMERA_CROSSING   = true   // re-enable side-by-side rendering
ENABLE_TRANSITION_CAMERA_REVEAL   = true   // optional: camera peek near exits
```

Before re-enabling, address the known issues listed in the BUILD 319 entry
below (staged enemy/hazard simulation, wall auto-tile seam artefacts, narrow-
room camera snap on finalization).  The settling-window code in
`gameCameraState.ts` (`camSettlingFramesLeft`, `prevHadUnionBounds`) and the
`finalizeCrossingSeamless` path in `gameSeamlessStaging.ts` remain intact for
this purpose.

---

## BUILD 319 — Performance & Seamless Crossing Improvements

### What Was Completed in BUILD 319

1. **Shadow occluder allocation reduction** (`src/render/effects/shadowCaster.ts`):
   - Removed `readonly` from `ShadowCasterOccluderPx` fields to allow in-place mutation.
   - Added module-level pool of 4 mutable occluder objects (`_shadowPool`).
   - `buildPlayerShadowOccluders` fills pool objects in-place instead of calling `out.push({...})`.
   - Up to 4 object-literal allocations per frame eliminated in DarkRoom mode.

2. **Decoration bloom allocation reduction** (`src/render/effects/glowPass.ts`,
   `src/render/effects/wallDecorations.ts`):
   - Added `GlowPass.drawCircleDirect(x, y, radius, intensity, color)` that accepts flat arguments.
   - `addDecorationBloom` now calls `drawCircleDirect` instead of `drawCircle({...})`, eliminating
     nested `{ x, y, radius, glow: { enabled, intensity, color } }` object literals per bloom call.

3. **Environmental dust wall spatial partitioning** (`src/render/environmentalDust.ts`):
   - Added `_wallColumnGrid: Map<number, number[]>` (cell width = 32 world units).
   - `_buildWallGrid(world)` called once per room load: registers each wall index in every
     column cell it spans.
   - `resolveWorldCollisions` now looks up only the column bucket for the particle's X position
     for both the AABB collision pass and the surface-anchor pass, reducing worst-case cost from
     O(particles × walls) to O(particles × walls-in-column).

4. **Staged room background rendering** (`src/screens/gameRender.ts`, `src/screens/gameScreen.ts`):
   - Added `StagedRoomBgInfo` interface and `stagedRoom: StagedRoomBgInfo | null` field to
     `RenderFrameContext`.
   - When `stagedRoom` is non-null, `renderFrame` clips each room's background to its own
     screen-space rect using nested `ctx.save()/clip()/restore()`, then calls
     `renderWorldBackground` for the staged room first (with adjusted camera offset
     `ox + originXWorld * zoom`) and then for the active room.
   - Eliminates the visual discontinuity where the active room's background filled the full
     union clip rect when rooms had different backgrounds.
   - `gameScreen.ts` populates `stagedRoom` from `stagingState.stagedRooms[0]`.

5. **Camera settling after seamless crossing finalization** (`src/screens/gameCameraState.ts`):
   - Added `camSettlingFramesLeft`, `settlingMinX/Y/MaxX/Y`, `prevHadUnionBounds` to
     `GameCameraState` and `CAM_SETTLING_FRAMES = 21` constant.
   - When `renderUnionBounds` transitions from non-null → null, the settling window starts:
     effective bounds lerp frame-by-frame from the captured union bounds toward the new
     single-room bounds over 21 frames (~0.35 s at 60 fps), preventing the camera snap on
     rooms narrower or shorter than 480×270 px.
   - After settling expires, the existing `CAMERA_BOUNDS_LERP_SPEED` lerp resumes as before.
   - This path is currently dormant (`ENABLE_TWO_ROOM_CAMERA_CROSSING = false`) but is in place
     for when seamless crossings are re-enabled.

---

## BUILD 318 — Campaign Spawn Trigger & Fade From Black

### What Was Completed in BUILD 318

1. **Campaign Spawn data model** (`src/levels/campaignSchema.ts`):
   - New `CampaignSpawnData` interface: `{ roomId: string; xBlock: number; yBlock: number }`.
   - `SavedCampaignMetadata` gains optional `campaignSpawn?: CampaignSpawnData`.
   - Backward compatible — older campaigns without `campaignSpawn` continue to load.

2. **Official campaign spawn loaded from registry** (`src/levels/rooms.ts`):
   - `initRoomRegistry()` stores `campaignSpawn` from the packed campaign in `loadedOfficialCampaignSpawn`.
   - New `getLoadedOfficialCampaignSpawn()` getter exposed for `game.ts`.
   - `loadedOfficialCampaignRevisionMetadata` and `loadedOfficialCampaignSpawn` are reset on `initRoomRegistry()`.

3. **Editor palette** (`src/editor/editorDropdownData.ts`):
   - Added `campaign_spawn` item (label: `Campaign Spawn`, category: `triggers`).
   - Renamed existing `player_spawn` item label from `Player Spawn` to `Room Spawn (Fallback)`.

4. **Editor state** (`src/editor/editorState.ts`):
   - Added `'campaignSpawn'` to `SelectedElementType`.
   - Added `campaignSpawnBlock: [number, number] | null` to `EditorState`; initialized to `null`.

5. **Editor tools** (`src/editor/editorTools.ts`, `src/editor/editorDeleteTool.ts`):
   - `selectAtCursor` hit-tests `state.campaignSpawnBlock` — returns `{ type: 'campaignSpawn', uid: 0 }`.
   - `deleteAtCursor` clears `state.campaignSpawnBlock = null` when cursor hits campaign spawn.
   - Controller calls `syncCampaignSpawnToSessionAfterDelete()` after every delete to update session.

6. **Editor rendering** (`src/editor/editorOverlayDrawers.ts`, `src/editor/editorRendererHelpers.ts`):
   - Campaign spawn drawn as ⭐ with a gold footprint outline.
   - "CAMPAIGN SPAWN" label rendered below marker when selected or hovered.
   - New color constants `CAMPAIGN_SPAWN_COLOR` and `CAMPAIGN_SPAWN_SELECTED`.
   - Tooltip/name maps updated to include `campaignSpawn`.

7. **Editor controller** (`src/editor/editorController.ts`):
   - `loadRoomForEditing` syncs `state.campaignSpawnBlock` from session on room load.
   - New helpers: `syncCampaignSpawnBlockFromSession`, `syncCampaignSpawnToSessionAfterDelete`,
     `showCampaignSpawnReplaceModal`, `placeCampaignSpawn`.
   - Singleton enforcement: placing `campaign_spawn` when another exists in a different room shows
     a modal: **"This will remove the current campaign spawn, proceed?"** with Yes/No.
   - Choosing Yes removes old spawn and places new one; updates session `campaignSpawn` and `initialRoomId`.
   - Campaign spawn property changes handled directly in the controller's `onPropertyChange` hook
     (bypasses room-data path since campaign spawn is not stored in room JSON).

8. **Inspector** (`src/editor/editorInspector.ts`):
   - `campaignSpawn` element shows xBlock/yBlock fields, editable via property change.

9. **New campaign sessions** (`src/editor/editableCampaignSession.ts`):
   - `createNewCampaignSession` pre-populates `campaignSpawn` at the starter room's spawn position.
   - `assembleExportCampaign` automatically includes `campaignSpawn` via `...session.campaign.campaign`.
   - `initialRoomId` is kept synchronized with `campaignSpawn.roomId` when a spawn is placed.

10. **Runtime start logic** (`src/game.ts`, `src/screens/gameScreen.ts`):
    - Main campaign: uses `getLoadedOfficialCampaignSpawn()` to set start room and position when
      the player has no save slot.
    - Custom campaign play: extracts `campaignSpawn` from packed campaign; passes room and block
      position as `startRoomId` and `campaignSpawnBlockOverride` to `startGameScreen`.
    - `startGameScreen` accepts new optional `campaignSpawnBlockOverride?` parameter.
    - `desiredSpawnBlock` uses `campaignSpawnBlockOverride` instead of `currentRoom.playerSpawnBlock`
      when available (save data still takes priority).
    - Death-respawn uses campaign spawn room and block when no save exists.

11. **Fade from black** (`src/screens/gameLoadingOverlay.ts`, `src/screens/gameScreen.ts`):
    - `GameLoadingOverlay.show(isCampaignInitialLoad?)` — when true, uses 700 ms fade (vs 300 ms).
    - `gameScreen.ts` calls `showLoadingOverlay()` on every initial game start (even when sprites
      are already cached), ensuring a deliberate fade-from-black at campaign start.
    - Subsequent room-load overlays (mid-session sprite cache misses) use the standard 300 ms fade.

---

## Remaining / Deferred Work

Items are grouped by risk and origin.

---

### Campaign & File System

#### ~~1. Dynamic `STARTING_ROOM_ID`~~ — **Superseded by Campaign Spawn (BUILD 318)**
**Resolution (BUILD 318):** The Campaign Spawn system is now the authoritative source for the
starting room and block position. `STARTING_ROOM_ID = 'lobby'` is retained as a last-resort fallback.

---

### Rendering — Seamless Crossing (Deferred — requires ENABLE_TWO_ROOM_CAMERA_CROSSING)

#### 1. Staged room hazards / enemies / ropes
**Files:** `src/screens/gameSeamlessStaging.ts`, `src/sim/world.ts`, enemy AI files  
**Issue:** Hazards (water/lava/spikes), enemies, falling blocks, and ropes from the staged
room are not preserved after `loadRoom()`. Players can walk through them without interaction.  
**Proposed path:** Before `loadRoom()` in `_finalizeCrossingSeamless`, snapshot the staged
room's hazard arrays and enemy clusters; after `loadRoom()`, re-append them at the staged
room's world-space offset. Enemy AI requires sim-layer awareness of the offset.  
**Blocker:** `ENABLE_TWO_ROOM_CAMERA_CROSSING = false` in `src/render/transitions/transitionConfig.ts`.
Re-enable crossing first, then address this sim-layer change.  
**Risk:** High — requires non-trivial sim-layer changes; defer to a dedicated pass.

---

### Rendering — Performance

#### 2. Spatial partitioning for DarkRoom particle-light loop
**File:** `src/render/effects/darkRoomOverlay.ts`, `src/screens/gameDarkRoomLighting.ts`  
**Issue:** The particle-light contribution loop in `renderDarkRoomLighting` scans all
particles linearly (O(n)). With thousands of particles this can be costly even though
viewport culling and `maxParticleLightCount` limit how many lights are emitted.  
**Proposed fix options:**
- Add a compact alive-Physical index list to `WorldSnapshot` (one sweep per frame, maintained
  during `updateSnapshotInPlace`), letting the render loop skip dead/non-Physical particles.
  Requires snapshot schema change but no cross-layer spatial coupling.
- Or: build a per-frame volatile spatial index from snapshot particle positions for the
  lighting pass only. Acceptable since it's render-only.  
**Blocker:** Any approach requires either snapshot schema changes or a per-frame allocation.
  The existing viewport-cull + quality-cap already limits practical cost to tens of particles
  per frame in most rooms.  
**Risk:** Medium — cross-layer or snapshot interface changes needed.

#### 3. Large-room stress-test room
**File:** New file in `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/` or editor export  
**Issue:** No dedicated profiler test room exists with high decoration, background block,
and liquid/hazard coverage to measure chunk-rebuild performance across builds.  
**Required steps (editor-only, cannot be hand-authored safely):**
  1. Open editor, create a new room ~120×80 blocks.
  2. Add 200+ decorations, 30+ background block defs, 10+ dust containers, 4 sunbeam emitters,
     representative liquid zones and spike hazards.
  3. Export room JSON to `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/dev_stress_test.json`.
  4. Add to the room registry (`src/levels/rooms.ts`) behind a dev flag so it is accessible
     from the editor visual map without appearing in the campaign path.  
**Risk:** Low — does not affect existing rooms. Must be done via editor, not hand-written JSON.

---

### Editor — Placement Performance

#### 4. Editor placement freeze — active-room-only edits (BUILD 340)
**Files:** `src/editor/editorController.ts`, `src/editor/editorHistory.ts`

**What was fixed in BUILD 340:**
- Placement/delete hot path now mutates only active room state and no longer calls `onLoadRoom` per placement.
- `applyEdits` now has `placement` vs `metadata` modes; placement mode marks dirty state only and skips room rebuild/reload.
- Added explicit boundary commit flow: `commitActiveRoomToCampaign(reason)` used for room switch, playtest/confirm, export, and manual save.
- Added richer placement perf log output:
  `[editor-perf] placeBlock total=... touchedCampaign=false committedRoom=false stringified=false localStorage=false dehydrated=false campaignValidated=false allRoomsLooped=false cacheInvalidation=local`
- Undo/redo snapshots switched from JSON stringify/parse to `structuredClone`, removing JSON serialization from placement hot path.

**Remaining work not completed in BUILD 340:**
1. Undo/redo is still full-room snapshot-based (now clone-based), not delta-based transactions by tile/tool.
2. No new measured timing capture has been recorded yet after BUILD 340 in a large-room stress run.

**Manual verification still needed:**
- Paint 100+ blocks in a large room and confirm no 1–2s freeze and immediate overlay response.
- Verify room switch + save/discard keeps/rolls back edits correctly with campaign sessions.
- Verify playtest and export include latest active-room edits without per-placement campaign commit.

**Compatibility risk to monitor:**
- Any future feature that relies on ROOM_REGISTRY being updated every placement may now need an explicit metadata sync point (currently done on metadata edits and map-open paths).

---

## BUILD 350 — Monolith Refactor Follow-up

### What was completed in BUILD 350

1. **Extracted render quality orchestration**
   - Added `src/screens/gameRenderQuality.ts`.
   - Moved adaptive quality config + renderer/system propagation + chunk-cache cap updates out of `gameRender.ts`.

2. **Extracted background/effect orchestration**
   - Added `src/screens/gameRenderBackgroundPass.ts`.
   - Moved staged/active room background draw flow and procedural background effects (Thero + Crystalline Cracks) out of `gameRender.ts`.

3. **Extracted scene-light pass orchestration**
   - Added `src/screens/gameRenderSceneLighting.ts`.
   - Moved scene-light initialization, room-change occluder dirty marking, and pass rendering out of `gameRender.ts`.

4. **Updated game renderer wiring only**
   - `src/screens/gameRender.ts` now delegates to the extracted modules without changing public interfaces or runtime feature set.

### Remaining / deferred from this pass

1. `src/screens/gameRender.ts` is still sizable and can be further split (for example clip-region and world-entity pass orchestration), but this was deferred to avoid high-risk render-order regressions.
2. `src/screens/gameScreen.ts` and `src/editor/editorController.ts` remain monolithic and are good candidates for future low-risk extraction passes.
3. Keep monitoring large-room and crossing scenarios manually to confirm no visual ordering regressions after additional renderer extractions.

### Validation to run/confirm for this build

1. `npm run build`
2. `npm run lint` (pre-existing lint errors may still appear in unrelated files)

---

## BUILD 351 — Additional Monolith Refactor Follow-up

### What was completed in BUILD 351

1. **Extracted editor backdrop renderer from `gameScreen.ts`**
   - Added `src/screens/gameScreenEditorBackdrop.ts`.
   - Moved the editor-consuming render branch into `renderEditorBackdrop(...)`.
   - Kept rendering behavior and pass ordering unchanged while reducing `gameScreen.ts` size/complexity.

### Remaining / deferred from this pass

1. `gameScreen.ts` still contains large room-loading and frame-update control flow that can be split further (e.g., load phases, transition/sim tick orchestration), but this was deferred to avoid risky control-flow regressions.
2. `editorController.ts` remains a large candidate for future low-risk extraction.

---

## BUILD 352 — Dialogue setup extraction follow-up

### What was completed in BUILD 352

1. Extracted room-load dialogue visit initialization from `gameScreen.ts` into `prepareRoomDialogueVisitState(...)` in `src/screens/gameDialogueHandler.ts`.
2. Kept `checkDialogueTriggers(...)` hot-path contract intact by continuing to feed pre-converted cached conversations.

### Remaining / deferred from this pass

1. `gameScreen.ts` still contains a large transition + fixed-tick orchestration branch that can be split further.
2. `editorController.ts` remains a large module suitable for additional low-risk decomposition.

---

## BUILD 353 — Cloak update extraction follow-up

### What was completed in BUILD 353

1. Extracted per-frame procedural cloak animation from `gameScreen.ts` into `src/screens/gamePlayerCloakUpdate.ts` via `updatePlayerCloaks(...)`.
2. Both `PlayerCloak` and `PhantomCloakExtension` continue to receive the render-interpolated player position; behavior is unchanged.

### Remaining / deferred from this pass

1. `gameScreen.ts` still contains the crumble-block debris event scan inside the physics tick loop — a small but coherent chunk that could be extracted in a future pass.
2. `gameScreen.ts` transition + sim-tick orchestration blocks remain good candidates for future decomposition.

---

## BUILD 354 — Crumble debris event extraction follow-up

### What was completed in BUILD 354

1. Extracted the per-tick crumble-block debris event scan from the physics accumulator loop in `gameScreen.ts` into `src/screens/gameCrumbleDebrisEvents.ts` via `tickCrumbleDebrisEvents(...)`.
2. The function compares `prevCrumbleActive`/`prevCrumbleHits` snapshots against the post-tick world state, fires `notifyBlockHit` on the `CrumbleDebrisRenderer`, updates the prev-state arrays, and calls `crumbleDebris.update(dtMs)` — all originally done inline.
3. No behavioral change; the pair `[scan → update]` was preserved and is still called once per fixed timestep.

### Remaining / deferred from this pass

1. `gameScreen.ts` physics accumulator loop still owns: cluster prev-position capture, falling-block prev-offset capture, and player-input forwarding. These could be extracted in a subsequent pass.
2. Post-loop camera, transition-reveal, and HUD update blocks also remain as future extraction candidates.

---

## BUILD 355 — Interpolation buffer capture extraction follow-up

### What was completed in BUILD 355

1. Extracted render-interpolation buffer management from `gameScreen.ts` into `src/screens/gameInterpolationBuffers.ts`.
2. Added `createGameInterpolationBuffers()`, `captureClusterInterpolationState(...)`, and `captureFallingBlockInterpolationState(...)`.
3. `gameScreen.ts` now delegates both room-load cluster snapshot capture and per-fixed-tick interpolation-state capture through the helper without changing timing or data flow.

### Remaining / deferred from this pass

1. `gameScreen.ts` fixed-tick loop still owns player-input forwarding, slime split handling, and per-system post-tick updates.
2. Post-loop camera, transition-reveal, and HUD update blocks remain future extraction candidates.

---

## BUILD 356 — Transition orchestration extraction follow-up

### What was completed in BUILD 356

1. Added `src/screens/gameRoomTransitionOrchestrator.ts` and moved the per-frame room-transition orchestration block out of `gameScreen.ts`.
2. `orchestrateRoomTransitions(...)` now owns cooldown decrement, transition trigger processing, camera-transition setup, velocity carry-over, transition reveal notifications, and transition debug-state updates.
3. `gameScreen.ts` now delegates this transition block while preserving existing room-load/preload and reveal-reset behavior.

### Remaining / deferred from this pass

1. `gameScreen.ts` still has a large fixed-step simulation loop containing input forwarding + per-system post-tick orchestration; this remains a high-value next extraction target.
2. Dialogue trigger checks and nearby camera/reveal orchestration are still inline in `gameScreen.ts` and can be extracted in a future low-risk pass.
3. `src/editor/editorController.ts` remains monolithic and is still a major candidate for decomposition.

### Validation follow-up

1. Re-run:
   - `npm run build`
   - `npm run lint`
2. Expectation: lint still reports only the known pre-existing issues in:
   - `src/editor/editorRoomBuilder.ts`
   - `src/screens/gameRoomFallingBlocks.ts`
   - `src/screens/gameTransitions.ts`

---

## BUILD 360 — Celeste-like wall-jump intent filtering

### What was completed in BUILD 360

1. Added `src/sim/clusters/playerWallJump.ts` — new module containing the wall-jump candidate helper with quality and intent checks:
   - `isValidWallJumpFace(playerTop, playerBottom, wallTop, wallBottom)` — rejects walls with insufficient vertical overlap (`WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD = 8 wu`) or whose top edge is within ledge-suppression range of the player's feet (`WALL_JUMP_LEDGE_SUPPRESS_WORLD = 4 wu`).
   - `hasWallJumpIntent(cluster, world, wallSideDir, usedProximity)` — requires at least one intent signal: wall sliding, away-from-wall input, or (direct-touch / grace only) falling with `airborneTicks >= WALL_JUMP_MIN_AIRBORNE_TICKS = 4`.
   - `getWallJumpCandidate(cluster, world)` — single public entry point; scans walls, applies quality + intent filters, returns `WallJumpCandidateResult` with per-side `canJumpFrom*`, distance for tie-breaking, and `dbgLeft`/`dbgRight` rejection reason strings.

2. Added new constants to `movementConstants.ts`:
   - `WALL_JUMP_REQUIRE_INTENT = true` — master toggle.
   - `WALL_JUMP_MIN_AIRBORNE_TICKS = 4` — minimum consecutive airborne ticks before a touch/grace wall jump is allowed without explicit away input.
   - `WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD = 8` — rejects single-small-block (3 wu) and single-medium-block (6 wu) side faces, requiring merged/tall walls.
   - `WALL_JUMP_LEDGE_SUPPRESS_WORLD = 4` — suppresses wall jumps off block tops near foot level.
   - `WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT = true` — proximity-only wall jumps need away-from-wall input or active wall slide.

3. Added `airborneTicks: number` to `ClusterState`; tracked at the top of `tickPlayerMovement` — increments while airborne, resets to 0 when grounded.

4. Updated `playerVerticalMovement.ts` to call `getWallJumpCandidate` instead of the old raw proximity scan + touch-flag check. The actual wall-jump application logic (velocity, force-time, lockout, etc.) is unchanged.

5. Removed the stale `getNearbyWallForWallJump` import from `playerVerticalMovement.ts` (now unused there; the function remains in `movementAxisResolvers.ts` for any other callers).

### Acceptance test notes

The following scenarios should be verified in-game:

| Scenario | Expected result |
|---|---|
| Running and jumping up a staircase of medium blocks | Ground jump fires each step; no accidental backward launch |
| Brushing the side of a 1-block ledge while jumping upward | Jump continues as ground/coyote jump; wall jump suppressed |
| Sliding down a tall wall, pressing jump | Strong wall jump fires (wall sliding = intent) |
| Airborne, pressing away from a tall wall, pressing jump | Wall jump fires (away input = intent) |
| Near a tall wall with `airborneTicks >= 4`, falling, pressing jump | Wall jump fires (airborne + falling = intent) |
| Wall-jump chains (skilled play) | Still possible; each jump builds airborneTicks before reaching next wall |
| Proximity wall jump near a ledge | Suppressed by quality filter + proximity intent check |

### Tuning recommendations (follow-up playtesting)

- **`WALL_JUMP_MIN_AIRBORNE_TICKS`** (currently 4): If players report that running up to a tall wall and jumping feels delayed, lower to 3. If stair clips still occasionally fire, raise to 5.
- **`WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD`** (currently 8): If any intentional wall-jump scenario against a short wall (height < 12 wu) fails, lower to 6. The 8 wu threshold intentionally blocks single-medium-block (6 wu) walls.
- **`WALL_JUMP_LEDGE_SUPPRESS_WORLD`** (currently 4): If ledge transitions feel sticky or jumps are blocked near block edges, lower to 3 or 2.
- **`WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT`** (currently true): If proximity wall jumps feel inaccessible in narrow corridors where the player faces into the wall, consider a separate narrow-passage exception.

### Debug visibility

The `WallJumpCandidateResult.dbgLeft` / `dbgRight` strings are ready to display in a movement debug overlay. Possible rejection values: `'lockout'`, `'no-wall-in-range'`, `'grace/touch+no-quality-wall'`, `'touch/grace+no-intent'`, `'proximity+no-intent'`. Acceptance values: `'touch+intent'`, `'grace+intent'`, `'proximity+intent'`.

To surface these in the debug HUD, pass the result from `getWallJumpCandidate` to the overlay renderer (render layer, read-only snapshot required).

### Remaining / deferred

1. The `dbgLeft`/`dbgRight` strings are not yet wired to the on-screen debug overlay. This is a render-layer task.
2. ~~`getNearbyWallForWallJump` in `movementAxisResolvers.ts` is now unused by the main player-movement path. It can be removed or repurposed in a future cleanup pass.~~ **Done in BUILD 366.**
3. Tuning values above should be validated against the full room set before merging to main.

---

## BUILD 367 — Upward transition velocity fix + depleted mote spent-state visual

### What Was Completed in BUILD 367

1. **Reduced upward room-transition velocity boost to 50 %**
   (`src/screens/gameRoomTransitionOrchestrator.ts`):
   - Changed multiplier from `1.0` to `0.5` for the upward-transition velocity carry-over.
   - `newPlayer.velocityYWorld = dir === 'up' ? preTransVY - PLAYER_JUMP_SPEED_WORLD * 0.5 : preTransVY;`
   - Resolves the over-boosted launch into the new room reported during play-testing.

2. **Depleted mote particle "spent" visual** (BUILD 359 remaining item):
   - Added `particleMoteSlotState: Uint8Array` to `ParticleSnapshot` in
     `src/render/snapshotTypes.ts` — per-particle flag: 0 = available, 1 = depleted.
   - Populated each frame in `updateSnapshotInPlace` (`src/render/snapshot.ts`) by
     scanning `world.moteSlotParticleIndex` and `world.moteSlotState` — O(MAX_MOTE_SLOTS)
     per frame, no allocation.
   - Also populated in `createSnapshot` (`src/render/snapshotAllocating.ts`) for the
     editor preview path.
   - Canvas 2D renderer (`src/render/particles/renderer.ts`): applies `alpha *= 0.25`
     for particles with `particleMoteSlotState[i] !== 0`.
   - WebGL renderer (`src/render/particles/webglRenderer.ts` + `shaders.ts`):
     - Added 7th float attribute `a_isSpent` to vertex format (`FLOATS_PER_VERTEX` 6 → 7).
     - Fragment shader multiplies `alpha` by `0.25` when `v_isSpent > 0.5`.
   - As documented in BUILD 359, the physical/logical invariant means the particle is
     usually dead during the depletion period; the spent visual mainly covers the ~1-tick
     window after airborne landing.

### Remaining / deferred

1. Mote kind colors for sword blade segments (`swordWeaveRenderer.ts`) — requires adding
   `particleMoteSlotKind: Uint8Array` to `ParticleSnapshot` following the same pattern.
2. Tuning values from BUILD 360 (`WALL_JUMP_MIN_AIRBORNE_TICKS`, etc.) should be
   validated against the full room set before merging to main.


