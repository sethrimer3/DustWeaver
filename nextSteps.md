# DustWeaver — Next Steps

## Current Documentation Status

This file is a prioritized planning document, not a raw changelog dump. Historical build notes are retained only where they still provide useful debugging context.

Current focus: large-room loading and rendering performance, especially room-transition smoothness, chunk prewarming, memory safety, and avoiding cold-entry pop-in.

---

## Electron Desktop Build Notes

### Failure reproduced and fixed

**Environment:** Node v24.15.0, npm 11.12.1, Electron 42.2.0, Linux (container/WSL/non-root).

**What worked:**
- `npm ci` — clean install, no errors.
- `npm run build` (tsc && vite build) — TypeScript compiles cleanly; Vite bundles 706 modules; `dist/index.html` produced.

**Failure:** `npm run electron` and `npm run desktop` crashed immediately on Linux with:

```
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now. You need to make sure that
node_modules/electron/dist/chrome-sandbox is owned by root and has mode 4755.
/node_modules/electron/dist/electron exited with signal SIGTRAP
```

**Root cause:** Electron's OS-level Chromium sandbox requires `chrome-sandbox` to be owned by root
with SUID (`chmod 4755`). This is never set up in containers, WSL, or ordinary user-owned
development trees. Electron 42 aborts rather than silently downgrading.

**Fix applied:**
- `package.json` `electron` and `desktop` scripts now pass `--no-sandbox`.
  This disables the OS-level process sandbox but does **not** affect the renderer-process
  security model (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in
  `webPreferences` all remain in effect). For a local desktop game this is the standard approach.
- `.nvmrc` added pinning Node `22` (Electron 42 requires ≥ 22.12.0).

**Node version requirement:** Electron 42.2.0 requires Node ≥ 22.12.0.
Run `nvm use` in the repo root to select the correct version automatically.

### Remaining / not completed

- **Packaged/distributed builds on Linux:** A properly packaged Electron app (`.deb`, AppImage)
  needs either a correctly configured `chrome-sandbox` SUID binary or an
  `--no-sandbox` flag in the launcher. The current fix covers development only.
  A future packaging step (e.g. `electron-builder`) should handle this automatically.
- **Windows/macOS:** The sandbox issue does not occur there; the added `--no-sandbox` flag
  is harmless on those platforms.
- **CI smoke test:** No automated `npm run build` check exists in CI yet. Adding a GitHub
  Actions workflow to run `npm ci && npm run build` would catch TypeScript/Vite regressions
  before they reach developers.

---

## Priority 1 — Performance and Transition Safety

### Current Status

The core freeze-fix infrastructure is complete and production-safe. The renderer now has chunked wall/background caches, decode-aware preloading for folder-based block sprites, async room preparation, scene-light occluder optimizations, bloom empty-frame skipping, and idle-time render-chunk prewarming.

Important correction: entry-area wall/background chunk prewarming is no longer deferred. It is implemented through `roomRenderChunkWarmScheduler.ts`, `prewarmWallChunksForRoom`, `prewarmBgChunksForRoom`, and `adoptPrewarmedChunksForRoom`. Remaining work is polish and hardening: queue correctness, memory eviction, shared background image caching, and better background-block chunk layout.

### Recently Completed Performance Work

1. **Decode-aware sprite preloading**
   - `imageCache.ts` added `decodeImg(src)` and `isSpriteDecodeReady(img)`.
   - `roomAssetPreloader.ts` added `decodeRoomThemeSprites(room)`.
   - The loading overlay now waits for decode-ready folder-based sprites when decode was requested.
   - Radius-1 rooms use decode-aware sprite preloading.
   - Current-room decode starts during Phase F of room loading.

2. **Chunked wall/background rendering**
   - Walls render through chunk canvases instead of a single room-sized canvas.
   - Background blocks also use chunk canvases.
   - Dirty chunks rebuild under a per-frame cap to avoid freezes.
   - Visible chunks plus a small safety margin are blitted each frame.

3. **Idle-time render-chunk prewarming**
   - `roomRenderChunkWarmScheduler.ts` schedules speculative wall/background chunk builds during idle time.
   - Directly adjacent rooms are prioritized first.
   - Radius-2 and radius-3 rooms can be warmed when frame time and quality settings allow.
   - Prewarmed chunks are adopted on room entry before the first render frame.

4. **Room runtime preparation and preload safety**
   - `RoomRuntimeCache` defaults to 16 entries.
   - Room wall templates, ambient blocker keys, dark blocker keys, and wall decorations are cached.
   - Worker-unavailable heavy-room preload no longer performs a forced synchronous main-thread build.
   - Safe urgent sync preparation uses a build-cost heuristic.

5. **Scene-light and bloom optimization**
   - `initLightingSystem()` no longer marks occluders dirty every frame.
   - Scene lights are viewport-culled before rendering.
   - Shadow-casting lights build spatially radius-filtered occluder lists.
   - Bloom now skips blur/composite work when no glow was submitted.
   - Freeze/debug stats expose scene-light and bloom skip information.

6. **Liquid and hazard micro-optimizations**
   - Water/lava renderers early-return when counts are zero.
   - Liquid wave steps are capped.
   - Liquid bubble spawning uses prebuilt `columnKeys` instead of allocating `Array.from(...)` in the hot path.
   - `tickLiquidBubbles()` early-returns when no bodies exist.
   - `gameRender.ts` skips `renderHazards()` when there are no hazard-type entities.

---

## Active Priority 1 Tasks

### 0. In-room runtime freeze elimination pass (COMPLETED — BUILD 395 + BUILD 401)

This pass targeted repeated freezes **inside** rooms during active gameplay, distinct from the earlier room-transition loading work.

#### What was found

- **Per-tile shaded canvas explosion** — `_shadedCacheKey()` in `folderBlockThemes.ts` included exact `worldOriginXWorld | worldOriginYWorld` coordinates. In large rooms this created one unique `getImageData`/`putImageData` bake per tile position (potentially thousands), all happening lazily as the camera moved during gameplay.
- **Same pattern in `proceduralBlockSprite.ts`** — `_cacheKey()` also embedded world coordinates, causing the same O(room_tiles) bake explosion for procedural block/platform/ramp sprites.
- **Stale `_decodeInFlight` entries** — When `img.complete === true` and `_hasDecode()` is false, `performDecode()` resolved synchronously before `_decodeInFlight.set()` was called, leaving stale entries that permanently block `isSpriteDecodeReady()`.
- **Prewarm queue stall** — `roomRenderChunkWarmScheduler.ts` used `break` (instead of `continue`) when one room was not ready, stalling the entire prewarm queue rather than skipping to the next room.
- **No frame-context in freeze profiler** — The profiler could not distinguish active-gameplay freezes from loading or editor frames, making it hard to prioritize freeze sources.
- **Baking allowed during active gameplay** — Even with bounded caches, new shaded-sprite bakes could occur in active-gameplay frames whenever a bucket was first touched.
- **Loading overlay released too early** — `tickLoadingOverlay()` only checked `areRoomSpritesReady()`, not background image decode readiness.
- **Hardcoded block size in chunk memory estimate** — `_evictStaleChunks()` used hardcoded `8` for block pixel size.
- **Procedural sprites used a private image cache** — `proceduralBlockSprite.ts` maintained its own `_imgCache`/`_loadImg`/`_isReady` instead of shared `imageCache.ts`.

#### What was fixed (BUILD 395)

1. **Bounded variant cache for `folderBlockThemes.ts`** (`SHADED_VARIANT_BUCKETS = 16`).
2. **Bounded variant cache for `proceduralBlockSprite.ts`** (`PROC_VARIANT_BUCKETS = 16`).
3. **Stale `_decodeInFlight` fix** in `imageCache.ts` via `.finally()` identity check.
4. **Prewarm queue `break` → `continue`** in `roomRenderChunkWarmScheduler.ts`.
5. **`frameContext` tracking** in `perfFreezeProfiler.ts` (`setFrameGameContext`, `FrameContext`).

#### What was fixed (BUILD 401)

6. **Gameplay-bake-forbidden flag** — `perfFreezeProfiler.ts` exports production-safe `setBakeForbiddenInGameplay(v)` / `isBakeForbiddenInGameplay()`. `gameScreen.ts` sets `true` at gameplay frame start, `false` at all other paths and at frame end.

7. **Stable unshaded fallback in `folderBlockThemes.ts`** — `getTheme1x1SpriteShaded` and `getTheme2x2SpriteShaded` return a cached unshaded canvas (no `getImageData`/`putImageData`) instead of `null` when bake is forbidden or budget is exhausted. `hadFallbacksFlag` stays false → no rebuild loop.

8. **Stable unshaded fallback in `proceduralBlockSprite.ts`** — `getProceduralSprite` returns a cached unshaded canvas (template compositing without edge shading) when bake is forbidden.

9. **Unified image cache in `proceduralBlockSprite.ts`** — Private `_imgCache`/`_loadImg`/`_isReady` removed. Now uses shared `loadImg`/`isSpriteReady` from `imageCache.ts`.

10. **Loading overlay waits for background decode** — `tickLoadingOverlay()` now requires `isRoomBackgroundDecodeReady(currentRoom)` in addition to `areRoomSpritesReady()`. Added `isRoomBackgroundDecodeReady()` to `backgroundRenderer.ts` and `roomAssetPreloader.ts`.

11. **Chunk memory estimate uses actual block size** — `_lastBlockSizePx` field added to `RoomChunkCache`; updated in `renderVisibleChunks()`, used in `_evictStaleChunks()`.

12. **Prewarm helpers added** — `prewarmFolderThemeShadedForChunk()` in `folderBlockThemes.ts`; `prewarmProceduralSpriteVariant()` in `proceduralBlockSprite.ts`.

#### Trade-offs made

- **Slight tile-shading noise repetition** — With 16 buckets, organic noise patterns repeat across tile groups. Imperceptible in practice; far preferable to gameplay freezes.

#### How to use the profiler to diagnose future freezes

1. Open the pause menu → enable **Debug Overlay** → enable **Freeze Profiler**.
2. Move through rooms. The freeze panel shows `ctx:gameplay` for active-gameplay frames.
3. Key fields to watch:
   - `bake N×Xms` — sprite bake count (should stay **0** during `ctx:gameplay` after BUILD 401).
   - `edge N×Xms` — organic edge-shading calls (should stay **0** during `ctx:gameplay`).
   - `wChk N×Xms` — wall chunks rebuilt.
   - `bChk N×Xms` — background chunks rebuilt.
4. Long-frame warnings are tagged `⚠ GAMEPLAY` when `frameContext === 'gameplay'`.

---

### 1. Entry viewport visual warm wiring (COMPLETED — BUILD 402 + BUILD 403 + BUILD 404 + BUILD 405)

`entryViewportWarm.ts` wires a bounded room-entry visual warm phase that runs while the loading overlay is active.

#### What was done (BUILD 402 + BUILD 403 + BUILD 404 + BUILD 405)

- New `src/screens/entryViewportWarm.ts` module: `EntryWarmState`, `createEntryWarmState()`, `startEntryWarm()`, `tickEntryWarm()`, `isEntryWarmReadyOrTimedOut()`.
- `startEntryWarm()` called after: initial `loadRoom()`, instant transition `loadRoom()`, and async-load generator completion.
- **BUILD 403 lifecycle fix**: `tickEntryWarm()` now runs in a dedicated `'entryWarm'` early branch in `gameScreen.ts`, BEFORE `processPlayerCommands`, before sim ticks, before camera update, and before `FP.setFrameGameContext('gameplay')`.  Player cannot move, simulate, or receive input while `entryWarmState.phase === 'warming'`.
- `'entryWarm'` added as an explicit `FrameContext` value in `perfFreezeProfiler.ts`.  Freeze warnings show `(entryWarm)` instead of `⚠ GAMEPLAY` for these frames.
- **BUILD 404 instant-transition fix**: the eager `tickEntryWarm()` call inside `startTransitionLoad()` has been removed.  Instant cache-hit transitions now call `startEntryWarm()` then `loadingOverlay.showEntryWarm()` (a lightweight textless black cover, `minShowMs=0`, `checkIntervalMs=0`, `fadeMs=80`) and return immediately.  All warm work happens in the RAF loop's `entryWarm` branch — never synchronously inside the transition callback.  This eliminates the hidden hitch on the room-boundary frame.
- **BUILD 404 room entry hold guard**: a guard after the `entryWarm` branch holds simulation and input while the overlay remains visible and sprites/background are still decoding, preventing gameplay advancing behind a still-visible overlay.
- **BUILD 405 readiness probe**: `canSkipEntryWarm(room, spawnXBlock, spawnYBlock, vpWPx, vpHPx, scalePx)` added to `entryViewportWarm.ts`.  Called in `startTransitionLoad()` before `startEntryWarm()`.  If the active chunk caches already cover the entry viewport (e.g. the room was prewarmed before the player arrived), both `startEntryWarm()` and `loadingOverlay.showEntryWarm()` are skipped — no overlay flash, no warm work.  Implemented via `RoomChunkCache.isViewportCovered()` (pure read, no canvas allocation).
- **BUILD 406 readiness probe hardening**: `RoomChunkCache.isViewportCovered()` now uses the same chunk-range formula as `renderVisibleChunks()`, including `CHUNK_MARGIN = 1`.  Previously the probe checked only the core visible viewport, so `canSkipEntryWarm()` could return `true` even when safety-margin chunks were absent — causing a first-frame hitch as the renderer built them during gameplay.  A shared `_fillChunkRange()` helper (module-level, allocation-free via a scratch object) is the single source of truth for both the probe and the renderer.  `RoomChunkCache.isViewportCoreCovered()` (no margin) is added for DEV diagnostics.  `canSkipEntryWarm()` logs the miss reason (margin vs core) in DEV on each transition where it returns `false`.
- `loadingOverlay.showEntryWarm()` and `loadingOverlay.isVisible()` added to `GameLoadingOverlay`.
- `tickLoadingOverlay()` condition extended to require `isEntryWarmReadyOrTimedOut(entryWarmState)`, holding the overlay until the entry viewport is covered or the timeout fires.
- Warm budget: max 8 frames or 120 ms; 6 wall + 6 background chunks per step.
- On completion or timeout: warmed chunks are adopted into the active cache via `adoptPrewarmedWallChunks`/`adoptPrewarmedBgChunks`.
- DEV console logs warm result: phase, chunks built, frames elapsed, ms spent, and whether the overlay was skipped.
- Entry warm state shown in the Prewarm debug panel (`renderProfiler.ts`): phase, frames, chunks, ms, timeout flag.

#### Guarantee

No gameplay freezes: `tickEntryWarm` runs in the `'entryWarm'` context, entirely outside the active-gameplay window.  No chunk building occurs before the overlay is visible.  Player simulation and input are blocked while warming.  The timeout ensures no long loading screens.  When the room is already warm, no overlay is shown at all.



Confirmed in code: `roomRenderChunkWarmScheduler.ts` line 666 checks `entry.blockerKeys !== null` (defers only `null`; treats `undefined` as ready). `_makeWallPrewarmCtx` converts `undefined` to `new Set<string>()`. No action required.

---

### 3. Add real global/LRU eviction for prewarmed chunks (PARTIALLY DONE — BUILD 405)

Quality-tier memory budgets (`PREWARM_MEMORY_BUDGET_KB`) and radius-based eviction exist in the scheduler.

**BUILD 405 hardening**: `_keepIds` is now persisted as module-level state in `roomRenderChunkWarmScheduler.ts` and set whenever a new schedule starts.  After each idle slice that builds chunks, if total prewarm memory exceeds the quality-tier budget, `evictStalePrewarmedChunks(_keepIds, quality)` is called.  This ensures budget enforcement runs continuously rather than only at schedule start.  Completed-but-still-nearby rooms (removed from `_queue` but still in `_keepIds`) are retained.

Also in BUILD 405:
- `prewarmWallChunksForRoom` and `prewarmBgChunksForRoom` now return `PrewarmChunkResult { rebuilt, skipped, totalChunks, dirtyChunks }` instead of a raw `number`.  Done detection in both the scheduler and `tickEntryWarm` now checks `rebuilt === 0 && skipped === 0`.
- `PrewarmStats` gains `chunksSkippedLastSlice` and `memoryBudgetKB` for debug panel visibility.

What remains deferred:

---

### 0b. Resident Room Runtime — Phase 1 (BUILD 413) + Phase 2 (BUILD 414)

This pass introduces `ResidentRoomManager` to preserve enemy state across room transitions.  The existing preload/prewarm system remains unchanged as the render-cache preparation layer.

#### What was implemented (Phase 1 — BUILD 413)

**New file: `src/screens/residentRoomManager.ts`**

- `ResidentRoomInstance` — per-room record tracking lifecycle (`active` | `frozen` | `evictable`), frozen enemy snapshots, and LRU timestamps.
- `FrozenEnemyEntry` — shallow copy of a `ClusterState` plus the `RoomEnemyDef` reference needed to respawn particles at the correct HP.
- `ResidentRoomManager` — plain class (not a singleton) instantiated in `gameScreen.ts`:
  - `tickFrame()` — advances internal frame counter; call once per RAF.
  - `ensureResident(roomDef)` — registers a room shell; idempotent.
  - `setActiveResidentId(roomId)` — promotes a room to `active`, demotes the prior active room to `frozen`.
  - `freezeRoom(world, roomId, room)` — snapshots `world.clusters[1..]` into `frozenEnemies` before `loadRoom` destroys them.
  - `getFrozenEnemies(roomId)` — returns the frozen snapshot, or `null` on first visit.
  - `restoreFrozenEnemies(world, frozen, levelRng)` — after `loadRoom`, kills fresh-spawn particles for restorable enemies, replaces clusters with frozen snapshots, and respawns particles at the frozen HP.  Re-initialises grapple-hunter chain particles.
  - `recordTransitionMode(mode, missReason, ms)` — captures last transition outcome for the debug overlay.
  - `getDiagnostics()` — returns `ResidentRoomDiagnostics` snapshot.
  - `evictDistant(currentRoomId)` — LRU-evicts rooms beyond `MAX_RESIDENTS = 8` (raised to 16 in BUILD 415).

**Integration in `src/screens/gameScreen.ts`**

- `residentRoomManager` instantiated alongside `world` and `levelRng`.
- `tickFrame()` called at the top of every RAF frame.
- **Instant transition path** (`isPrepared` branch):
  1. `freezeRoom()` snapshots the outgoing room before `loadRoom`.
  2. After `loadRoom`, `restoreFrozenEnemies()` restores the target room's enemy state.
  3. Transition mode set to `'residentHot'` when enemies were restored, `'residentFallback'` on first visit.
  4. `recordTransitionOutcome` records `'residentHot'` in the viewport-covered branch when applicable.
  5. Adjacent rooms pre-registered as resident shells.
  6. `evictDistant()` called after each transition.
- **Async transition path** (`loading` branch):
  - `freezeRoom()` called before the async generator starts.
  - On generator completion: `ensureResident`, `setActiveResidentId`, `evictDistant`, adjacent-room registration.
  - `recordTransitionMode('legacyLoad')`.
- **Initial load**: start room registered as active; adjacent rooms registered as shells.
- **Debug stats**: `renderProfiler.updateResidentDiagnostics()` called each frame in debug mode.

**New `TransitionOutcome` value: `'residentHot'`** in `roomRenderChunkWarmScheduler.ts`.

**New debug panel: `'resident'`** in `debugPanelManager.ts`, `debugPanel.ts`, and `renderProfiler.ts`.

- Panel shows: active room ID, resident count, frozen count, last transition mode (colour-coded), miss reason, activation ms, total evictions.

#### Enemy restoration policy

- **Restorable** (shallow-copy safe): all enemy types except the 8 complex types listed below.
- **Not restorable in Phase 1** (complex global state): RadiantTether, RadiantWeb, DustConstellation, OrbitalDustCore, DustBlockMimic, DustWeaverArchitect, VoidSingularity, DustLeech.  These respawn fresh on revisit.
- Dead restorable enemies stay dead.
- Alive restorable enemies respawn at their frozen HP (partial health preserved).
- Grapple hunter chains are re-initialised at fresh buffer indices after restoration.

#### What was implemented (Phase 2 — BUILD 414)

**Extended `src/screens/residentRoomManager.ts`** — Phase 2 simulation-state snapshot types and methods:

- `FrozenFallingBlockState` — per-group state machine snapshot (state, timer, offsets, velocity, shake, crumble timer).  Only non-`FB_STATE_IDLE_STABLE` groups are stored.
- `FrozenRopeSnapshot` — Verlet position/prev-position arrays for all ropes in a room (flat layout: `ropeCount × MAX_ROPE_SEGMENTS`).
- `FrozenBreakableBlockState` — `isBreakableBlockActiveFlag` copy (index-parallel with `room.breakableBlocks`).
- `FrozenCrumbleBlockState` — `isCrumbleBlockActiveFlag` + `crumbleBlockHitsRemaining` copy.
- `FrozenGrasshopperSnapshot` — per-grasshopper position, velocity, hop timer, and alive flag.
- `FrozenFluidSnapshot` — per-background-fluid-particle position, velocity, disturbance factor, and age ticks.
- `FrozenSimState` — top-level container for all six categories above; stored on `ResidentRoomInstance.frozenSimState`.
- `freezeSimState(world, roomId)` — snapshots all six categories before `loadRoom`.
- `getFrozenSimState(roomId)` — returns the snapshot, or `null` on first visit.
- `restoreSimState(world, frozenState)` — applied after `loadRoom`:
  - Falling blocks: per-group field overwrite + wall-slot sync (mirrors `updateWallSlot` in `fallingBlockSim.ts`; removed groups zero `wallWWorld/wallHWorld`).
  - Ropes: overwrites `ropeSegPosXWorld/Y` and `ropeSegPrevXWorld/Y` (only when `ropeCount` matches, preventing mismatched-layout corruption).
  - Breakable blocks: sets `isBreakableBlockActiveFlag[i]=0` and zeros the wall slot for each broken block.
  - Crumble blocks: destroys wall slot for destroyed blocks; restores hit count for cracked-but-intact blocks.
  - Grasshoppers: bulk-sets position/velocity/hop-timer/alive arrays.
  - Fluid particles: scan-order 1-to-1 match of `ParticleKind.Fluid + ownerEntityId=-1` particles in the freshly-loaded buffer; overwrites position/velocity/disturbance/age.

**Integration in `src/screens/gameScreen.ts`**

- **Instant transition path**: `freezeSimState()` called alongside `freezeRoom()` before `loadRoom`; `getFrozenSimState()` captures the target room's snapshot; `restoreSimState()` called after `restoreFrozenEnemies()` (guarded by try/catch with DEV warning).
- **Async transition path**: `freezeSimState()` called alongside `freezeRoom()` before the async generator (no restore — the async path always uses fresh `loadRoom` state for the target room on its first instant-path visit).

#### Fallback behaviour

- On first visit to a room: `getFrozenEnemies()` / `getFrozenSimState()` return `null`; fresh spawn from `loadRoom` is used.
- On `restoreFrozenEnemies` / `restoreSimState` exception: caught, logged in DEV, fresh spawn is kept — no crash.
- Count-mismatch guards (rope count, breakable/crumble/grasshopper count) skip restoration rather than corrupt state when the room definition changes between visits.
- Async load path uses the full `loadRoom`/phase generator as before; resident registration happens after completion.

#### Transition modes tracked

| Mode | Meaning |
| --- | --- |
| `residentHot` | Instant path, enemy state restored from frozen snapshot |
| `residentFallback` | Instant path, first visit — fresh enemy spawn |
| `legacyLoad` | Async path (cache miss), full destructive load |
| `entryWarm` | Instant path but viewport not covered, entry-warm overlay shown |
| `none` | No transition yet |

#### What was implemented (Phase 3 — BUILD 415)

1. **Radius-2 resident shell pre-registration.** All three pre-registration sites in `gameScreen.ts` (instant-transition path, initial-load path, async-completion path) now call `bfsNearbyRooms(room.id, ROOM_REGISTRY, 2)` to register shells for rooms up to 2 hops away.  This ensures that rooms the player might visit after a single intermediate hop are already tracked before the first freeze.
   - `bfsNearbyRooms` imported from `roomPrewarmNeighborhood.ts` (already used by `roomRenderChunkWarmScheduler.ts`).

2. **`MAX_RESIDENTS` increased from 8 → 16.** The old limit was sized for radius-1 only (active + ≤ 4 neighbours). Radius-2 BFS can produce up to ~12 additional shells, so the budget was raised to 16 to prevent eviction of valuable frozen state.

3. **Shell-first eviction in `evictDistant`.** The LRU eviction now evicts rooms with `hasEverBeenActivated: false` (pre-registered shells with no frozen state) before rooms carrying actual frozen enemy/sim snapshots.  Within each priority tier, order is still oldest-first by `lastTouchedFrame`.  This ensures that radius-2 pre-registration does not displace frozen state from previously visited rooms.

4. **`renderStateKeyMatches` correctly populated.** Previously the field was always `null` unless a stale-key rejection occurred.  It is now:
   - `true`  — at least one of wall/bg adopted successfully and neither was stale.
   - `false` — either wall or bg returned `staleRenderState`.
   - `null`  — both caches were `missing` (no prewarmed chunks existed).

#### What remains deferred (Phase 3 and beyond)

1. **True hot-swap without `loadRoom`** — requires per-room `WorldState` instances so the live simulation state is never destroyed on transition.  A larger architectural change.
2. **Complex enemy restoration** — RadiantTether, DustConstellation, OrbitalDustCore, etc. carry module-level singleton state (e.g. `_chainState` in `radiantTetherAi.ts`) that is not inside `WorldState`.  Requires dedicated serialization paths.
3. **Per-room renderer context** — currently module-level renderer state (theme, lighting, blocker keys, chunk caches) is applied on each `loadRoom`.  A per-room render context object would make true hot-swap possible without re-applying renderer state.
4. **Projectiles crossing room boundaries** — not handled; projectiles that reach a boundary are lost.

---

### 0c. Predictive Adjacent-Room Prewarm Pipeline (HARDENED — BUILD 413 polish pass)

The goal was to eliminate the brief loading overlay on first-time room entry by ensuring the target room's chunk caches are ready before the player crosses the boundary.

**Status:** The pipeline is substantially hardened and diagnostics are much more precise, but the no-loading goal is NOT fully guaranteed. See "Remaining limitations" below. Normal single-tile crossings are consistently hot when the idle scheduler has had time to complete. Very fast crossings (grapple, zip) and GPU warm-up behaviour remain browser-dependent.

#### What was implemented (BUILD 413 — correctness and diagnostics hardening)

1. **`computeRenderStateKey` expanded.** The key now includes all known render-affecting fields:
   - block theme, world number, lighting effect, ambient direction, seam blending, ambient blocker keys (pre-existing)
   - `roomWidthBlocks`, `roomHeightBlocks` (affect ambient depth calculations)
   - `directionalBias`, `sideExposureStrength`, `minimumWallLight`, `falloffPower` (wall lighting shape)
   - `backgroundLightSpill`, `solidLightSoftness` (background blending parameters)
   - All numeric fields are `.toFixed(4)`-normalised for key stability.
   - Callsites updated: wall prewarm, Phase A adoption (`gameLoadRoomPhases.ts`), entry-warm adoption (`entryViewportWarm.ts`), fallback key in `backgroundBlockRenderer.ts`.

2. **Background readiness semantics corrected.** Rooms with no background blocks are now treated as bg-ready, not bg-missing.
   - `getRoomPrewarmReadiness(roomId, room)` now accepts a `RoomDef` and returns `bgRequired: boolean`.
   - `ensureChunkPrewarmQueued` skips the bg-ready gate (and does not recreate bg tasks) when the room has no background blocks.
   - Transition diagnostics include `bgPrewarmRequired: boolean`. `bgChunksMissing` is no longer reported for bg-free rooms.

3. **Structured adoption results (`PrewarmAdoptResult`).** Adoption functions now return a discriminated union instead of `boolean`:
   ```ts
   type PrewarmAdoptResult =
     | { status: 'adopted'; chunks: number }
     | { status: 'missing' }
     | { status: 'staleRenderState'; snapshotKey: string; currentKey: string }
     | { status: 'empty' };
   ```
   Applied to `adoptPrewarmedWallChunks`, `adoptPrewarmedBgChunks`, and `adoptPrewarmedChunksForRoom`.
   The scheduler captures the last result via `_lastAdoptionResult` / `getLastAdoptionResult()`.

4. **`staleRenderState` miss reason.** `TransitionReadinessDiagnostic['missReason']` now includes `'staleRenderState'`, `'wallAdoptEmpty'`, and `'bgAdoptEmpty'`. `startTransitionLoad` records `staleRenderState` when adoption rejected chunks because the snapshot key did not match the current key. This was previously hidden as a generic miss.

5. **Sprite / background decode fields in diagnostics.** `TransitionReadinessDiagnostic` now carries:
   - `spritesDecoded: boolean | null` — from `areRoomSpritesReady`
   - `backgroundDecoded: boolean | null` — from `isRoomBackgroundDecodeReady`
   These are diagnostic-only; they do not gate hot transitions unless readiness is already gated elsewhere.

6. **Debug overlay improved.** The prewarm panel now shows:
   - `xtn: <roomId>` — target room
   - `miss: <missReason> KEY_MISMATCH` — stale-key indicator appended when applicable
   - `W:ready/miss B:ready/n/a bgReq:y/n rdy:y/n` — wall, bg, bg-required flag, runtime
   - `spr:y/n/? bgDec:y/n/? vpc:y/n` — sprite decode, background decode, viewport coverage

7. **"Atomic adoption" wording corrected in `wallChunkPrewarmStore.ts`.** Header comment now says adoption is staged (wall then bg) and NOT atomic. `roomRenderCacheStore.ts` was already corrected in BUILD 413.

#### What was implemented earlier (BUILD 402–412)

- BUILD 402: `entryViewportWarm.ts` entry-warm controller (8 frames / 120 ms budget).
- BUILD 404: textless entry-warm overlay (80 ms minShow); `isVisible()` on overlay; hold guard after entry-warm.
- BUILD 406: `isViewportCovered()` includes `CHUNK_MARGIN`; DEV diagnostics for margin-vs-core miss.
- BUILD 411: `roomRenderCacheStore.ts` unified snapshot store; `renderStateKey` for invalidation; velocity-direction queue ordering in `scheduleChunkPrewarms`.
- BUILD 412: `prewarmWallChunksForRoom` ordering fix; `adoptPrewarmedWallChunks`/`Bg` accept optional `currentRenderStateKey`; DEV warning for cache-without-layout.
- BUILD 413: Resident Room Runtime (see below).

#### What is validated at adoption time (Phase A)

- `adoptPrewarmedChunksForRoom` in `gameLoadRoomPhases.ts` computes `adoptRenderStateKey` using all 14 render-affecting fields (expanded in BUILD 414).
- Both `adoptPrewarmedWallChunks` and `adoptPrewarmedBgChunks` compare this key against `snapshot.renderStateKey` and return `{ status: 'staleRenderState' }` on mismatch.
- `_finishWarm` in `entryViewportWarm.ts` forwards the current key so entry-warm adoption is guarded the same way.
- The scheduler captures the structured result and `startTransitionLoad` translates it to a specific `missReason`.

#### Remaining limitations

1. **Very fast crossings can outpace idle prewarming.** Grapple and zip traversal can move the player across a room boundary before the idle scheduler has completed the target room's prewarm pass. `ensureChunkPrewarmQueued` is called on proximity, but proximity detection depends on normal-speed movement. No fix planned for now — entry-warm handles the fallback.

2. **Partial prewarm still causes `entryWarm`.** If the idle scheduler only completed the wall pass (not bg) before the player crossed, `bgPrewarmPresent: false` will show in the diagnostic and outcome will be `entryWarm`. The entry-warm path handles this correctly but the player sees a brief textless cover.

3. **Stale cache invalidation on mid-session settings changes.** If `setActiveBlockLighting`, `setActiveBlockSpriteTheme`, or related settings change mid-session via the pause menu, existing warmed snapshots will have a stale key. Eviction and re-key correction only fires at the next `scheduleChunkPrewarms` or at adoption time. Adding explicit cache-bust calls to settings-change handlers would close this gap.

4. **First-draw / GPU warm-up is browser-dependent.** Off-screen chunk canvases are built during the idle pass, but whether the GPU rasterizer uploads the texture at that point or defers until the first on-screen `drawImage` is browser-specific. A forced 1×1 offscreen warm-draw per chunk would ensure GPU upload, but the per-chunk cost is unknown. Deferred pending measurement.

5. **`hot` for revisited rooms may not always hold.** If a room's snapshot was evicted under memory pressure, chunk caches will be empty on re-entry, yielding `entryWarm`. Proximity boost will normally have re-queued the room before the player reaches the boundary; very fast crossings may still lose the race.

6. **Sprite / background decode fields are diagnostic-only.** `spritesDecoded` and `backgroundDecoded` are recorded but do not gate hot transitions. If decode latency is found to cause visible pop-in, they should be promoted to readiness conditions.

#### What was NOT implemented

- Explicit settings-change cache-bust callbacks (limitation 3 above).
- Forced GPU warm-up draw per chunk (limitation 4 above).
- Explicit settings-change handlers that call `invalidateRoomChunkPrewarm` for all affected rooms.
- `renderStateKeyMatches` populated in `TransitionReadinessDiagnostic`.

#### What is still deferred (from earlier builds)

1. **Cache invalidation on block-theme or lighting-setting changes outside the editor**
   If `setActiveBlockLighting`, `setActiveBlockSpriteTheme`, or similar settings change mid-session (e.g. via the pause menu's quality settings), prewarm chunks for adjacent rooms may be stale. The `renderStateKey` computed by `roomRenderCacheStore.ts` now encodes theme and lighting so newly-scheduled prewarm tasks will evict any stale snapshot. Already-in-progress warm tasks finish against the current key. **BUILD 412** adds adoption-time key comparison via the optional `currentRenderStateKey` parameter; **BUILD 413** extends this to the entry-warm path. Limitation: no explicit global invalidation call on settings change.

---



These are still valid future refactors and should not be treated as accidental omissions.

1. **Base-chunk / lighting-overlay architectural split**
   `setActiveBlockLighting` and `setActiveBlockSpriteTheme` can invalidate baked wall chunks. Separating base wall tiles from lighting/seam overlay chunks would let lighting-only changes rebuild only a lighter overlay layer. This requires splitting the current chunk build path into base and overlay passes, so it should be done as a dedicated renderer refactor.

2. **Legacy/world-number sprite decode tracking**
   Decode-aware room preloading currently focuses on folder-based block themes. Legacy world-number sprites such as brownRock, dirt, and world 0-9 block sets still start loading at module init time and are not tracked through the same decode-ready set. This is lower priority unless legacy rooms still show visible sprite pop-in.

3. **True LRU eviction for prewarmed chunks**
   Quality-tier memory budgets and radius-based eviction exist. What remains is true last-touched ordering (evict oldest rather than largest/farthest). Low priority while memory budget enforcement is already in place.

4. **Room render manifest**
   Published rooms could eventually export precomputed render data: wall templates, theme sprite URLs, background image URLs, chunk occupancy hints, occluder chunks, and recommended entry chunks. This touches editor export, schema hydration, runtime loading, and preload systems, so it should be a dedicated pass.

---

## Future Performance Tasks

### Static/slow procedural background caching

`gameRenderBackgroundPass.ts` still updates and draws some procedural background effects every frame. For slow-moving backgrounds, cache the expensive base/effect layer to an offscreen canvas and redraw it only every few frames, then blit the cached result each frame.

Candidate effects:

- `renderTheroBackgroundEffect()`
- `renderTheroShowcaseEffect()`
- `renderCrystallineCracksBackground()`

Suggested starting interval: redraw cached procedural background every 4 frames, invalidating on background ID or virtual resolution change.

### Static liquid interior caching

Liquid rendering now uses merged rectangles and capped wave steps. A future optimization would cache static liquid interiors and redraw only exposed top-edge waves, bubbles, caustics, lava sparks, and other animated overlays.

### Static hazard chunk caching

Split `renderHazards()` into static cached geometry and animated overlays.

Static candidates:

- spike triangles
- jar bodies
- breakable block base faces
- crumble block base faces
- springboard base geometry
- kinetic block base geometry

Live overlay candidates:

- bounce pad glow/pulse
- kinetic block pulse
- dust-boost jar glow
- firefly jar glow and fireflies
- liquid surfaces

### Decoration sway micro-optimization

Add a zero-decoration early return in `DecorationWaveState.update()`:

```typescript
const count = Math.min(this._count, decorations.length);
if (count === 0) return;
```

### Liquid body BFS allocation cleanup

If `liquidBodyBuilder.ts` still creates a temporary four-item `neighbours` array inside the BFS loop, replace it with four direct neighbor checks.

---

## Priority 2 — Block Seam Blending Polish

### Implemented

1. **Custom sprite asset support**
   `seamBlending.ts` loads artist-authored PNGs from `ASSETS/SPRITES/BLOCKS/transitions/generic/{profile}/edge_{N|E|S|W}_01.png`, plus optional corner and diagonal sprites. Missing sprites are cached as misses after the first 404. Procedural stamps remain the fallback.

2. **Explicit profile overrides**
   `EXPLICIT_PROFILES` can override keyword heuristics when a block theme ID does not match the desired transition profile.

3. **Editor live preview**
   `editorController.ts` calls `setActiveSeamBlending(mode)` immediately on dropdown change so the backdrop updates without a playtest cycle.

4. **Corner and diagonal seam accents**
   Inner corners and diagonal-only contacts receive sparse deterministic accent stamps.

5. **Per-mode density tuning**
   Subtle, organic, and heavy modes differ in stamp density, not just opacity.

### Remaining Limitations

1. Artist-authored transition sprites still need to be created.
2. `EXPLICIT_PROFILES` is empty by default and should be populated as new themes need manual profile mapping.

---

## Priority 3 — Dust Weaver Architect Polish

### Completed

1. **Hit-flash visual on the Architect core**
   `dustWeaverArchitectHitFlashTicks` is set in `forces.ts` when the Architect takes particle damage, and the renderer draws a bright expanding glow ring.

2. **Dust Nail secondary attack**
   Fires one Dust Nail toward the player after the player stays outside `DWA_NAIL_MIN_RANGE_WORLD` for `DWA_NAIL_RANGE_PRESSURE_TICKS`, then respects `DWA_NAIL_COOLDOWN_TICKS`.

3. **Large-variant patterns**
   `DWA_PATTERNS` has normal and large variants. Large variants are weighted heavily for large Architects while normal Architects use the normal pattern subset.

4. **Wall-jump behavior near Architect Blocks**
   Wall-jump only scans real room walls, so Architect Blocks are intentionally excluded.

5. **Per-Architect block-count cap enforcement**
   Architects skip their build cycle when already at their per-Architect block cap.

### Tuning Values Worth Revisiting

- `DWA_NAIL_MIN_RANGE_WORLD = 80`
- `DWA_NAIL_SPEED_WORLD = 1.6`
- `DWA_NAIL_RANGE_PRESSURE_TICKS = 120`
- `MAX_ARCHITECT_BLOCKS = 40` shared across simultaneous Architects

---

## Architecture Refactoring — Completed and Remaining Candidates

### Completed (2026-05-26)

1. **`gameSpawn.ts` 909 → 259 lines**: Enemy cluster initialization extracted to
   `gameEnemySpawn.ts` (669 lines). Particle-spawn utilities remain in
   `gameSpawn.ts`. No circular dependencies introduced; only `gameScreen.ts`
   needed an import-site update.

2. **`seamBlending.ts` 829 → 420 lines**: Pure procedural drawing helpers
   (`draw*`, `intensityAlpha`, `intensityDensity`, `TransitionProfileKind`,
   `BlockTransitionProfile`, `DIR_*` constants) extracted to
   `seamProfileDrawers.ts` (439 lines). `seamBlending.ts` now orchestrates
   profile resolution, sprite loading, and `renderSeamOverlayPass`.
   `TransitionProfileKind` and `BlockTransitionProfile` re-exported from
   `seamBlending.ts` for backward compatibility.

3. **`snapshot.ts` 916 → 548 lines**: Cluster initialization helpers
   (`_MutableCluster` type, `_makeEmptyCluster`, `_fillCluster`) extracted to
   `snapshotClusterInit.ts` (277 lines). `snapshot.ts` retains the reusable
   snapshot lifecycle (`createReusableSnapshot`, `updateSnapshotInPlace`,
   `resetReusableSnapshot`). No allocations added to the per-frame hot path.

4. **`blockSpriteRenderer.ts` 927 → 881 lines**: Prewarm store state
   (`_prewarmWallCaches`, `_prewarmWallLayouts`, `_prewarmDummyCtx`) and store
   management functions (`evictPrewarmedWallChunks`, `hasPrewarmedWallChunks`,
   `listPrewarmedWallRoomIds`, `getPrewarmWallRoomStats`, `getPrewarmWallStats`)
   extracted to `wallChunkPrewarmStore.ts` (112 lines). Internal accessors
   (`getPrewarmWallLayout`, `getOrCreatePrewarmWallCache`, `deletePrewarmEntry`,
   `getPrewarmDummyCtx`) used by `blockSpriteRenderer.ts` internally. Public
   management API re-exported for backward compatibility.

### Completed additions (BUILD 411)

10. **`folderBlockThemes.ts` 643 → ~460 lines**: Theme discovery and catalogue
    (190 lines) extracted to `folderThemeCatalogue.ts`. New module owns the
    two `import.meta.glob` calls, `FolderThemeData` interface, `_folderToLabel`,
    `_folderToShortId`, `_buildFolderThemes`, `FOLDER_BLOCK_THEMES`,
    `isFolderBasedTheme`, and `folderThemeShortId`. All four exports re-exported
    from `folderBlockThemes.ts` for backward compatibility. Sprite loading and
    the 8×8 downscale cache remain in the original file.

11. **`roomPreloadScheduler.ts` 728 → ~595 lines**: Web Worker management
    (135 lines) extracted to `roomPreparationWorkerManager.ts`. New module owns
    `_worker`, `_workerCallbacks`, `_pendingWorkerRoomIds`, `_getOrCreateWorker`,
    `_reconstructRoomRuntimeEntry`, and exposes `dispatchRoomToWorker` and
    `isRoomPendingWithWorker` as named exports. Scheduler's `prioritize()` uses
    `isRoomPendingWithWorker`; its inner `processNext()` uses `dispatchRoomToWorker`.

### Completed additions (BUILD 410)

8. **`editorUI.ts` 823 → 647 lines**: Lighting panel DOM construction and
   per-frame sync logic (180 lines) extracted to `editorUILightingPanel.ts`.
   Exposes `createEditorLightingPanel(getCallbacks)` returning an
   `EditorLightingPanel` with `syncOnRebuild`, `syncInPlace`, and `resetState`.
   Six slider rows, two dropdowns (lighting effect, ambient direction), seam
   blending, and void-edge controls now live in the new module. Pre-existing
   default-value inconsistency between rebuild path (0.45/0.18) and in-place
   sync path (0.35/0.15) preserved exactly.

9. **`roomRenderChunkWarmScheduler.ts` 820 → 750 lines**: Pure BFS helpers
   (`_bfsNearby`, `_computeEntranceOffset`, ~70 lines) extracted to
   `roomPrewarmNeighborhood.ts` as named exports `bfsNearbyRooms` and
   `computeEntranceOffset`. Scheduler now imports from the new module.
   `BLOCK_SIZE_MEDIUM` retained in the scheduler for its separate usage in
   the chunk-build slice.

### Completed additions (BUILD 409)

5. **`roomFileLoader.ts` 689 → 607 lines**: Room-file-cache lifecycle state
   (`_activeManifest`, `_activeCampaignId`, `_activeIsOfficialCampaign`,
   `_activeWorldMap`, `_pendingLoadIds`) and 7 management/query functions
   extracted to `roomFileCacheState.ts` (154 lines). All 7 public functions
   re-exported from `roomFileLoader.ts` for backward compatibility. Loading
   functions now use getter accessors instead of direct state access.

6. **`snapshotTypes.ts` 709 → 409 lines**: `ClusterSnapshot` interface
   (306 lines of pure per-entity render types) extracted to
   `clusterSnapshotTypes.ts` (314 lines). Re-exported and imported into
   `WorldSnapshot` via `import type`. No runtime changes.

7. **`gameScreen.ts` (stale import cleanup)**: 30 unused import specifiers
   left over from BUILD 408's `gameLoadRoomPhases.ts` extraction removed.
   Restored clean `tsc` pass (`noUnusedLocals: true`).

### Remaining refactor candidates

1. **`gameScreen.ts` (~1483 lines)**: Most logic lives inside a deep module
   closure, making it risky to extract without careful re-threading of shared
   state. Not further reduced in this pass. Defer unless a specific closure
   variable can be cleanly isolated (e.g. `updateRoomBounds`, `cameraState`
   helpers already moved in prior passes).

2. **`editorController.ts` (~993 lines after prior passes)**: The main
   `update()` closure captures ~40 variables from the outer scope. Any further
   extraction risks shadowing bugs. Defer until a clear seam is identified.

3. **`roomRenderChunkWarmScheduler.ts` (~750 lines after BUILD 410)**: Pure BFS
   helpers extracted to `roomPrewarmNeighborhood.ts` in BUILD 410. Remaining
   content is tightly coupled scheduler/task state that is difficult to split
   further without introducing complex state-passing. Deferred.

4. **`snapshotTypes.ts` (~409 lines after BUILD 409)**: `ParticleSnapshot`
   and `WallSnapshot` could each move to their own files for symmetry, but
   both are short and frequently co-imported with `WorldSnapshot`. Deferred.

5. **`roomSchemaV2.ts` (~813 lines after prior passes)**: Further extraction
   possible for hydration helpers, but schema logic is tightly interleaved with
   type assertions. Requires careful audit before splitting.

6. **`roomPreloadScheduler.ts` (~595 lines after BUILD 411)**: Worker management
   extracted to `roomPreparationWorkerManager.ts`. Remaining content is the idle
   scheduler loop, BFS helpers, and the main `scheduleRoomPreloads` function.
   Further reduction possible (e.g. extract BFS into its own file), but the
   scheduler loop itself is tightly coupled to the BFS results. Defer.

---

## Verification Checklist

- [ ] `npm run build` passes.
- [ ] Enter large adjacent rooms repeatedly in all four directions.
- [ ] Test with worker available.
- [ ] Test with worker unavailable if feasible.
- [ ] Check Freeze debug panel for unexpected `preload` spikes during gameplay.
- [ ] Cache-hit transitions remain instant.
- [ ] Cache-miss transitions use the async loading overlay.
- [ ] Rooms with no ambient blockers still prewarm wall chunks.
- [ ] Prewarm queue does not stall behind no-blocker rooms.
- [ ] Prewarm memory does not grow without bound after walking through many rooms.
- [ ] Background images still render correctly.
- [ ] Already decoded backgrounds do not show a fallback flash on entry.
- [ ] Large rooms with many background blocks spend less time in background chunk rebuilds after per-chunk bucketing.
- [ ] Scene lights render correctly in rooms with `sceneLights`.
- [ ] Shadow-casting lights still cast shadows correctly.
- [ ] Freeze panel shows `lit` row with correct counts when scene lights are present.
- [ ] Freeze panel shows `bloom skip(no glow)` when no glow is submitted.
- [ ] No stale occluder rebuild every frame.
- [ ] No legacy fancy transition or edge-extension code is reactivated.

---

## Historical Notes

These are condensed build notes for debugging context only. They are not current active tasks.

### BUILD 392 — Golden Dust Guide Path Fixes + Timer Persistence

Key fixes: `guideDustPaths` loaded at runtime, per-point speed control added, arc-length path rendering improved, duplicate FP lifecycle removed from `gameRender.ts`, and timer persistence ordering fixed.

### BUILD 389 / 390 — Freeze Fix Infrastructure

Infrastructure added:

- `src/debug/perfFreezeProfiler.ts`
- wall/background chunk rebuild cap
- sprite bake cap
- faster wall-layout signature hashing
- radius-1 heavy room worker dispatch
- worker-unavailable heavy-room preload skip instead of forced sync build

Known tradeoff: worker-unavailable heavy rooms may use the async loading overlay more often, but gameplay should not freeze.

### BUILD 388 — Legacy Transition Cleanup

Fancy transition systems were removed from active gameplay. Active code uses simple room transitions. Legacy files are isolated under `src/render/transitions/legacy/`.

### BUILD 387 — Web Worker Migration for Room Preloading

`roomPreparationWorker.ts` and `roomPreparationWorkerProtocol.ts` added. Heavy radius-2 rooms can be prepared in a reusable Worker with typed-array transfer.

### BUILD 386 — Room Loading & Preload Freeze Fixes

Fixed official campaign cache destruction on returning to menu, deduplicated missing-target transition recovery, added `estimateRoomBuildCostMs`, and introduced radius-2 heavy-room throttling.

### BUILD 376 — Non-Blocking Room Preloading

Replaced synchronous proximity preloading with async prioritization. Increased idle timeout and added deadline budgeting.

### BUILD 374 — Campaign Spawn Starting Options

`CampaignSpawnData` extended with starting health, dust containers, dust types, and starting weaves. Some folder-based and official campaign starting-option applications remain deferred.

### BUILD 359 — Combat/Dust Integration Polish

Storm Weave gating, mote/particle sync invariant, hot-path allocation fixes, and legacy combat path documentation.

Deferred from that pass:

- mote kind colors for sword blade and arrows
- visual spent-state for depleted mote particles
- vestigial player attack/block input path cleanup

### BUILD 356 — Simple Room Transitions Confirmed

Simple room transitions confirmed correct in all four crossing directions. `cancelCameraTransition` hardened.

### BUILD 319 — Performance & Seamless Crossing Improvements

Shadow occluder allocation reduction, decoration bloom allocation reduction, environmental dust wall spatial partitioning, staged room background rendering, and camera settling work. Seamless-crossing path is dormant while `ENABLE_TWO_ROOM_CAMERA_CROSSING = false`.

### BUILD 318 — Campaign Spawn Trigger & Fade From Black

Campaign spawn data model, editor placement, official campaign spawn from registry, and fade-from-black on campaign start.
