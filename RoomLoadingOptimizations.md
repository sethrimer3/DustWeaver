# Room Loading Optimizations

Last reviewed: 2026-07-01

This document consolidates the room-loading and room-transition optimization work that is currently visible in repository source comments, planning notes, and performance documentation. It is meant to prevent repeated work and to give future AI/code agents a single place to check before proposing another room-loading pass.

Scope caveat: this is a source-and-docs consolidation, not a full Git-history audit. If an older experiment was removed from the repository and not described in current docs, it may not be captured here.

---

## Current diagnosis in one paragraph

Room loading has already been attacked from several angles: asset decode readiness, phased/async loading, static per-room runtime caching, idle-time nearby-room preparation, worker offload for heavy static prep, baked wall templates, incremental wall-template merge fallback, render-chunk prewarming/adoption, entry-viewport warming, gameplay-safe bake suppression, resident/frozen room worlds, compact/lazy room-file loading, and transition profiling. The remaining work should be measurement-led. Do not assume the next bottleneck is `loadRoom()` as a whole; inspect transition phase timings, prewarm readiness, and first-entry resident build phases.

---

## Existing documents that already mention this area

- `PERFORMANCE_DIAGNOSIS.md` — historical and current rendering/transition diagnosis, especially BUILD 259, 395-405.
- `performanceOptimizationDecisions.md` — build-by-build performance decisions, including BUILD 350-368 and extraction/refactor safety notes.
- `nextSteps.md` — current performance priority list, especially BUILD 428 and large-room remaining work.
- `docs/CURRENT_STATUS.md` — high-level current status and known caveats.
- `docs/AI_REPO_MAP.md` — source map for agents.

This file does not replace those files. It summarizes the optimization attempts specifically around room loading and transition latency.

---

## Optimization attempts and current mechanisms

### 1. Sprite and background asset preloading / decode readiness

Problem addressed: rooms could show blank fallback tiles or freeze visually while block sprites/backgrounds loaded lazily after room entry.

Implemented mechanisms:

- `roomAssetPreloader.ts` preloads folder-theme block sprites for the current room and nearby rooms.
- `decodeRoomThemeSprites(room)` calls browser image decode so sprites are rasterized before first use when possible.
- `decodeRoomBackground(room)` and `isRoomBackgroundDecodeReady(room)` were added so the loading overlay can wait for the room background, not only tile sprites.
- Radius-1 rooms use stronger decode-aware preloading; radius-2 rooms use cheaper load-only preloading and decode later when needed.
- Current-room sprite/background decode is triggered during room-load Phase F.

Important caveat:

- Non-folder themes such as older world sprite themes are not fully covered by the folder-theme readiness checks. Current docs say they typically load at module init, but this is still a possible first-entry edge case.

### 2. Fade-covered synchronous load

Problem addressed: earlier `loadRoom()` work could run synchronously in one RAF callback and cause a visible 30-80 ms stall or partial room construction.

Implemented mechanism:

- A fade-out/fade-in room transition covers the synchronous load at maximum fade so the player does not see incomplete construction.

Current status:

- This was an early mitigation, not the final architecture. Later work split loading into phases, added cache/worker/prewarm paths, and added resident hot-swap work.

### 3. Phased room-load generator

Problem addressed: too much room initialization happened in one synchronous call.

Implemented mechanisms:

- `gameLoadRoomPhases.ts` defines `makeLoadRoomPhases(...)`, a generator that yields between phases.
- The documented phase split is:
  - Phase A: room metadata, renderer state, blocker/lighting setup, world reset.
  - Phase B: player spawn, player particles, mote queue.
  - Phase C: background wall grid and enemy spawn.
  - Phase D: background particles, grapple chains, wall template application/build.
  - Phase E: hazards, ropes, falling blocks, grasshoppers, dialogue, dust piles.
  - Phase F: environment effects, wall decorations, snapshot/interpolation, camera, sprite preloading, preload scheduling.
- `startTransitionLoad()` advances Phase A immediately so `currentRoom` is updated before active-room hooks fire, then the frame loop advances later phases behind the loading overlay when needed.

Current status:

- Cache-hit transitions can still be effectively instant.
- Cache-miss transitions use the async/loading overlay path rather than freezing the active gameplay frame.

### 4. Prepared room runtime cache

Problem addressed: static pure room data was rebuilt on every room visit.

Implemented mechanisms:

- `RoomRuntimeCache` caches per-room static runtime data:
  - merged `RoomWallTemplate`,
  - ambient-light blocker key sets,
  - dark-ambient blocker key sets,
  - static wall-decoration geometry.
- Cache default capacity is 16 rooms.
- Cache uses LRU-style `Map` promotion on `get()` and evicts the oldest entry when capacity is exceeded.
- `isEntryFullyPrepared(entry)` treats an entry as ready when blocker sets and wall decorations are computed; edge-extension data is intentionally excluded because it is legacy-only.
- Mutable visit state is not cached: enemies, hazard state, falling blocks, rope physics, particles, crumble hit counts, and dust-pile collected state must stay per-visit.

Current status:

- This is still central. A transition miss often means the relevant `RoomRuntimeEntry` was absent, partial, evicted, or still pending in worker/preload scheduling.

### 5. Prepared runtime build consolidation

Problem addressed: wall template, blocker sets, and decorations were prepared in separate places with repeated or inconsistent logic.

Implemented mechanisms:

- `preparedRoomRuntime.ts` centralizes `buildPreparedRoomRuntime(room)`.
- It resolves wall templates using baked data when present, otherwise falls back to runtime merge.
- It builds blocker key sets from ambient blockers and light-blocking background blocks.
- It builds static wall decoration geometry.
- It records timing breakdowns for wall, blocker, decoration, and total prep time.
- `resolveRoomWallTemplate(room, cache?)` centralizes the priority order:
  1. runtime cache,
  2. baked wall template,
  3. runtime fallback merge.

Current status:

- Future changes should avoid reintroducing duplicate blocker/wall/decor build paths unless there is a specific measured reason.

### 6. Idle-time BFS room preloader

Problem addressed: adjacent rooms were not prepared before the player crossed a boundary.

Implemented mechanisms:

- `roomPreloadScheduler.ts` schedules nearby-room runtime preparation after each room load.
- It BFSes through `RoomDef.transitions`, using manifest adjacency when available so it can discover radius-2 rooms even when lazy room data has not been hydrated yet.
- Radius-1 rooms are prioritized ahead of radius-2 rooms.
- Scheduling uses `requestIdleCallback` when available, with a `setTimeout(0)` fallback.
- Each idle callback processes at most one room and checks `timeRemaining()` before beginning work.
- Rooms already fully prepared in `RoomRuntimeCache` are skipped.
- The scheduler exposes `prioritize(roomId)` so proximity checks can move the likely target room to the front.

Current status:

- This avoids many cold transitions, but it is best-effort. If the player moves faster than the idle/worker/prewarm pipeline, the async loading overlay still handles the miss.

### 7. Heavy-room cost guards and worker offload

Problem addressed: heavy adjacent-room preloads could still freeze active gameplay when built synchronously in an idle callback or forced timeout.

Implemented mechanisms:

- `roomPreloadScheduler.ts` estimates build cost from wall count, background-block area, and decoration count.
- Radius-1 rooms above a low threshold are dispatched to a Web Worker instead of built synchronously.
- Radius-2 heavy rooms are also dispatched to the worker.
- If the worker is unavailable and the idle timeout fires, heavy speculative preloads are skipped instead of forced synchronously on the main thread.
- `preparedRoomRuntime.ts` also exposes `tryEnsureRoomPreparedIfCheap(...)`, which refuses unsafe urgent synchronous builds above `SAFE_SYNC_BUILD_COST_MS`.

Current status:

- This was intended to eliminate 1-5 second active-gameplay freezes caused by building large adjacent rooms synchronously.
- A skipped heavy preload means a later transition may show the loading overlay if the worker/cache path did not finish in time.

### 8. Off-main-thread room preparation worker

Problem addressed: heavy static preparation for wall templates, blocker sets, and decorations should not block gameplay.

Implemented mechanisms:

- `roomPreparationWorker.ts` builds room static runtime data in a dedicated worker.
- The worker runs:
  1. wall template resolution/build,
  2. blocker-set construction,
  3. wall-decoration geometry build.
- Wall template typed-array buffers are transferred back zero-copy.
- `roomPreparationWorkerManager.ts` lazily creates and reuses one worker for the session.
- Pending room IDs prevent duplicate dispatch.
- Worker results write into the shared `RoomRuntimeCache`.

Current status:

- Worker availability matters. If the worker fails or is unavailable, heavy speculative prep is skipped rather than forced onto the main thread.

### 9. Lazy Electron room-file cache and manifest adjacency

Problem addressed: loading all campaign rooms and all room data eagerly can be expensive, especially for large campaigns.

Implemented mechanisms:

- `roomFileLoader.ts` uses a source hierarchy:
  1. canonical campaign file,
  2. derived `ROOMS/manifest.json`,
  3. derived `ROOMS/<roomId>_room.json` files.
- In Electron file-cache mode, rooms not yet in `ROOM_REGISTRY` can be loaded asynchronously from individual room files.
- The active manifest includes adjacency data so preloading can discover nearby unloaded rooms.
- Room cache validation uses content hashes and file validation so stale cache data can be regenerated.

Current status:

- This reduces startup/registry pressure, but it adds another possible cold path: the target room may need data hydration before it can be prepared/warmed.

### 10. Baked wall templates in room JSON

Problem addressed: the wall merge pass is expensive and super-linear/O(n^2) for many authored wall rectangles.

Implemented mechanisms:

- Room JSON can carry `bakedWallTemplate` data.
- Runtime wall template priority is cache -> baked -> fallback merge.
- `scripts/bake-room-wall-templates.mjs` hydrates room solids/special walls, builds complete boundary walls, runs the merge pass, computes the source hash, and writes `bakedWallTemplate` back to room JSON.
- Rooms with valid baked templates skip the runtime merge pass.
- Baked templates preserve theme names for non-legacy indices.

Current status:

- A missing/stale baked template can still push a room into fallback merge. Future performance work should verify baked-template coverage and hash validity before inventing new runtime caching layers.

### 11. Incremental wall-template fallback

Problem addressed: when cache and baked wall template are both missing, the fallback merge could still create a large single-frame spike.

Implemented mechanisms:

- `buildRoomWallTemplateIncremental(...)` spreads the merge across time-budgeted slices.
- `gameLoadRoomPhases.ts` Phase D uses cache -> baked -> incremental fallback and yields between merge slices.
- `residentWorldBuilder.ts` generator also uses incremental wall merge for resident-world builds.
- The fallback path intentionally yields between lookup and the first merge slice so the expensive merge does not bundle with other load work.

Current status:

- This should reduce per-frame spikes, but first-entry total wait time can still be noticeable for very large rooms if no cache/baked/worker result exists.

### 12. Chunked wall/background rendering

Problem addressed: drawing or rebuilding whole-room wall/background canvases was too expensive for large rooms.

Implemented mechanisms:

- Wall rendering uses chunk canvases instead of a single room-sized canvas.
- Background blocks also render through chunk canvases.
- Dirty chunks rebuild under per-frame caps.
- Only visible chunks plus a safety margin are blitted.
- Chunk cache memory caps are adjusted only when quality/adaptive tier changes.
- Memory estimation now uses the actual block size rather than a hardcoded 8 px assumption.

Current status:

- This is a render-side optimization, but it directly affects room entry because the first visible chunks can otherwise be built after entering the room.

### 13. Idle-time render-chunk prewarming and adoption

Problem addressed: even if runtime room data is ready, the first frame in a new room can hitch while visible wall/background chunks are built.

Implemented mechanisms:

- `roomRenderChunkWarmScheduler.ts` pre-builds wall and background chunks during idle time.
- Priority order:
  1. radius-1 rooms, entry viewport first,
  2. radius-2 rooms when suitable,
  3. radius-3 rooms only on high quality and stable frame times.
- The scheduler backs off when recent frame times are poor.
- It checks idle deadline budget and limits chunks per idle callback.
- It defers rooms whose runtime data or sprites are not ready rather than baking incorrect fallback chunks.
- It supports velocity-direction ordering so the likely next room can be warmed first.
- It supports proximity/manual ensures via `ensureChunkPrewarmQueued(...)`.
- On room entry, `adoptPrewarmedChunksForRoom(...)` injects prebuilt chunks into active caches before the first render.
- Stale render-state keys are rejected rather than adopted incorrectly.
- Prewarm memory budgets are quality-tiered and stale/higher-radius rooms are evicted first.

Current status:

- If a transition is not hot, inspect `lastTransitionDiagnostic` for missing runtime data, missing wall chunks, missing background chunks, stale render state, empty adoption, or incomplete entry-viewport coverage.

### 14. Entry-viewport warm

Problem addressed: if prewarmed chunks were missing or incomplete, the first gameplay frame after room entry could still show pop-in or trigger bake/build work.

Implemented mechanisms:

- `entryViewportWarm.ts` tracks an entry warm phase: `idle`, `warming`, `ready`, or `timedOut`.
- `startEntryWarm()` runs after initial room load, instant transition, and async transition completion.
- `tickEntryWarm()` runs from a dedicated early RAF branch before player input, sim ticks, camera update, and gameplay frame context.
- While entry warm is running, the loading overlay covers the viewport and gameplay is held.
- The warm branch explicitly allows baking by setting bake-forbidden state to false.
- The overlay release gate waits for async load completion, sprite readiness, background decode readiness, and entry warm completion/timeout.
- Timeout is bounded so entry warm cannot produce a long loading screen.

Current status:

- This is a bridge between full hot transitions and cold loading. If prewarming is insufficient, entry warm should produce a short covered delay rather than an uncovered hitch.

### 15. Gameplay-safe baking suppression and stable unshaded fallbacks

Problem addressed: shaded sprite and procedural sprite baking used expensive pixel operations during active gameplay as the camera moved into new chunks.

Implemented mechanisms:

- `folderBlockThemes.ts` bounded shaded variant caches using `SHADED_VARIANT_BUCKETS = 16` rather than exact world-coordinate keys.
- `proceduralBlockSprite.ts` similarly uses bounded procedural variant buckets.
- `perfFreezeProfiler.ts` exposes `setBakeForbiddenInGameplay(...)` / `isBakeForbiddenInGameplay()`.
- During active gameplay render, expensive bake paths return stable cached unshaded fallback canvases rather than running `getImageData` / `putImageData` or returning `null`.
- Returning stable canvases prevents repeated fallback rebuild loops.
- Shaded variants are intended to bake during loading/prewarm/entry-warm phases, not during active gameplay.

Current status:

- Freeze profiler output should show zero `bake` / `edge` spikes during `ctx:gameplay`. Any gameplay bake spike indicates a missing guard or an uninstrumented bake path.

### 16. Resident/frozen room-world architecture

Problem addressed: even phased `loadRoom()` still rebuilds enemies/hazards/ropes/walls for rooms that could remain resident/frozen.

Implemented mechanisms:

- `residentWorldBuilder.ts` can build a complete `WorldState` for a room without a player cluster.
- Resident builds include enemies, hazards, ropes, falling blocks, grasshoppers, background fluid, dust piles, and walls.
- Player spawn and renderer/camera activation are applied later through resident activation logic.
- Resident builds use deterministic per-room RNG derived from campaign seed, room ID, and world number so background builds do not perturb active gameplay RNG.
- `createResidentBuildGenerator(...)` spreads resident-world construction across RAF frames.
- Wall merge in resident builds uses cache/baked/incremental fallback.
- Long resident build phases warn in DEV above the configured phase threshold.

Current status:

- Desired long-term direction appears to be zone/world residency: keep rooms in a world/zone resident and frozen, with longer loading primarily between zones.
- First-entry resident build of very large rooms can still be a candidate bottleneck if the resident world was not prepared before activation.

### 17. Large-room area-system audit

Problem addressed: large sparse rooms can look like they should be slow because of width x height grids.

Findings and changes:

- An O(W x H) ambient darkness lit-air pass was identified and fixed in earlier work.
- `buildAmbientDepths` omni-mode O(W x H) lit-air build was also fixed according to `nextSteps.md`.
- Dense `bgWallGrid` allocation remains in `gameLoadRoomPhases.ts` and `residentWorldBuilder.ts`, but the docs state V8 zero-initialized allocation is usually fast and not the multi-second freeze cause.
- A DEV-only full-grid `reduce(...)` scan was removed; occupied cells are now counted during painting.
- `snakeAi.ts` has a dense nav grid path; this is low priority unless snake enemies exist in very large rooms.

Current status:

- Sparse grid conversion may reduce memory in huge sparse rooms, but current docs do not identify it as the main room-loading freeze source.

### 18. Complete boundary walls and trigger strips

Problem addressed: transition geometry and room-edge handling had caused correctness problems and map-sketch regressions.

Implemented/retained mechanisms:

- Complete boundary walls are generated independently of transition triggers.
- Trigger strips are separate from solid boundary geometry.
- Baked wall-template generation includes complete boundary walls.

Current status:

- Do not alter transition trigger thresholds, spawn resolution rules, boundary-wall construction, or map-sketch rendering without evidence and targeted tests. These areas are explicitly marked as regression-prone.

### 19. Render-state key memoization

Problem addressed: repeated render-state key generation sorted/joined blocker sets and became measurable in transition/prewarm paths.

Implemented mechanisms:

- `computeRenderStateKey` is memoized with a WeakMap keyed by blocker-set identity plus primitive render arguments.
- Empty Sets use a shared sentinel so equivalent empty blocker cases hit the cache.
- `nextSteps.md` records a node-side microbenchmark showing a large speedup for repeated 200-blocker Set calls.

Current status:

- This helps adoption/prewarm/render-state checks, but in-browser end-to-end transition timing is still required before treating it as the dominant fix.

### 20. Profiling and diagnostics

Problem addressed: repeated optimization attempts were being made without enough measurement.

Implemented mechanisms:

- `perfFreezeProfiler.ts` tracks frame context and bake/chunk/load-phase work.
- `RenderProfiler` can be enabled through debug UI to inspect render stages.
- `transitionProfiler.ts` records per-transition total time, phase time, longest phase, room dimensions, content counts, and prewarm cache summary.
- DEV globals include:
  - `__dwTransitionStats(n)`,
  - `__dwLastTransition()`,
  - `__dwTransitionVerbose(on)`,
  - `__dwBenchTransition(roomId, opts?)`,
  - `__dwBenchPingPong(roomA, roomB, iterations)`.

Current status:

- The next optimization should start by capturing real browser/Electron transition timings. Node build/tests do not substitute for live transition measurements.

### 21. Scene-light and bloom optimizations

Problem addressed: room-entry and per-frame rendering could be polluted by lighting/bloom work.

Implemented mechanisms:

- Scene-light occluders are marked dirty on room-ID changes rather than every frame.
- Scene lights are viewport-culled.
- Bloom skips empty frames where possible.

Current status:

- These are adjacent optimizations. They should be preserved but are less likely to be the direct cause of multi-second room loads unless profiler data points there.

### 22. Maintainability refactors that preserved performance behavior

Problem addressed: large monolithic files made performance-sensitive paths risky to edit.

Implemented/preserved refactors include:

- `gameRenderQuality.ts` extraction while preserving allocation-free adaptive quality scratch/cache behavior.
- `gameRenderSceneLighting.ts` extraction while preserving room-change-only occluder invalidation.
- `gameScreenEditorBackdrop.ts` extraction while preserving one-pass editor backdrop rendering.
- `gameDialogueHandler.ts` extraction while preserving per-room pre-conversion of dialogue triggers.
- `gamePlayerCloakUpdate.ts`, `gameCrumbleDebrisEvents.ts`, `gameInterpolationBuffers.ts`, and `gameRoomTransitionOrchestrator.ts` extractions while preserving hot-path allocation profiles.

Current status:

- These are not all direct loading fixes, but they reduce the risk of reintroducing per-frame allocations or reordering transition logic.

---

## Optimizations intentionally avoided or constrained

These constraints matter because they prevent repeat attempts that are likely to break correctness.

1. **Do not cache mutable visit state.** Enemy state, hazards, ropes, particles, falling block offsets, crumble hit counts, and dust-pile collection state vary per visit unless handled through resident/frozen world state.
2. **Do not rebuild heavy speculative rooms synchronously when the worker is unavailable.** Current policy is to skip and let the async overlay cover a later miss.
3. **Do not adopt prewarmed chunks with stale render-state keys.** Incorrect visuals are worse than a short entry-warm/loading delay.
4. **Do not casually alter boundary walls, trigger strips, spawn resolution, or map-sketch rendering.** These are regression-prone and have been explicitly called out in repo notes.
5. **Do not re-enable legacy edge-extension cache building in normal gameplay.** Current runtime treats it as legacy-only.
6. **Do not optimize dense grids before measuring.** Current docs say dense `Uint8Array` allocation is probably not the multi-second freeze source, though it may still matter for memory.

---

## What likely remains to measure next

Use actual transition data before changing code. The most plausible remaining bottleneck categories are:

1. **Cold target room data path**
   - Room not yet hydrated from Electron room-file cache.
   - Manifest adjacency discovers the room, but data/worker/prewarm did not finish before crossing.

2. **Runtime cache miss or eviction**
   - `RoomRuntimeCache` entry missing/partial/evicted.
   - Worker still pending or skipped.
   - Baked template missing or stale, causing fallback incremental merge.

3. **Resident first-entry build**
   - Resident world not built before activation.
   - Large room still pays enemy/hazard/wall setup in resident generator phases.

4. **Sprite/background decode first-entry cost**
   - Folder sprites or background decode not finished.
   - Non-folder/world sprites not represented in readiness checks.

5. **Render chunk prewarm/adoption miss**
   - Wall chunks missing.
   - Background chunks missing.
   - Stale render state key.
   - Entry viewport not covered.
   - Prewarm evicted due to memory budget or not queued soon enough.

6. **Large-room special systems**
   - Dense background wall grid is likely memory, not time, but should still be watched on huge rooms.
   - Snake nav grid only matters where snake enemies are active.

---

## Recommended measurement workflow

1. Enable the debug overlay and freeze/transition profiler.
2. Run live browser/Electron transition tests, not just Node tests.
3. Use:

```js
__dwBenchPingPong('room_a_id', 'room_b_id', 10)
__dwTransitionStats(20)
__dwLastTransition()
```

4. For slow transitions, identify:
   - transition outcome: `residentWorldHot`, `hot`, `entryWarm`, `loading`, etc.;
   - longest phase;
   - whether runtime cache was ready;
   - whether wall/bg prewarm data existed;
   - whether adoption rejected stale data;
   - whether entry viewport coverage was complete;
   - whether sprites/backgrounds were decoded;
   - whether gameplay frames show `bake` / `edge` work.
5. Only then choose the next optimization target.

---

## Quick glossary

- **Runtime prepared room**: static room data cached in `RoomRuntimeCache` — wall template, blockers, decorations.
- **Baked wall template**: wall merge result persisted in room JSON so runtime can skip the O(n^2) merge pass.
- **Render chunk prewarm**: wall/background chunk canvases built in idle time before entering a room.
- **Entry warm**: short covered warm pass immediately after room load/transition before gameplay resumes.
- **Resident world**: frozen `WorldState` for a room, built without the player and activated later.
- **Hot transition**: transition where runtime data and entry render chunks are ready enough to avoid loading overlay.
- **Loading transition**: cache/prewarm miss handled by phased async load behind overlay.

---

## Bottom line

The repo has already tried broad, sophisticated room-loading optimizations. Future work should not be another generic "optimize room loading" pass. It should be a measurement-led fix targeted to the slowest observed transition phase or readiness miss reason.
