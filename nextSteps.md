# DustWeaver — Next Steps

## Current Documentation Status

This file is a prioritized planning document, not a raw changelog dump. Historical build notes are retained only where they still provide useful debugging context.

Current focus: large-room loading and rendering performance, especially room-transition smoothness, chunk prewarming, memory safety, and avoiding cold-entry pop-in.

---

## BUILD 428 — Per-Transition Profiler + computeRenderStateKey Memoization

**Why:** The audit pass (problem statement: "DustWeaver ultimate room loading and rendering optimization") confirmed that the major architectural fixes (resident hot-swap, baked walls, trigger strips, chunk prewarm, schema v3, zone loader, incremental wall merge, entry warm) are already in place. To choose the next genuine bottleneck instead of speculating, we need per-transition measurements.

**What was added:**

1. **`src/debug/transitionProfiler.ts`** — DEV-only per-transition aggregator.
   - `beginTransition` / `recordPhase` / `endTransition` capture mode + total ms + per-phase ms.
   - Auto-forwards from existing `FP.recordLoadPhaseStep` via `setLoadPhaseHook` (no call-site changes needed for the load phases that are already instrumented).
   - Emits **one compact summary line per transition** with mode, total ms, longest phase, room dims + content counts, and prewarm cache hit summary. Replaces the four scattered `[transition] …` console.log lines (now gated behind `__dwTransitionVerbose(true)`).
   - DEV-only globals: `__dwTransitionStats(n)`, `__dwLastTransition()`, `__dwTransitionVerbose(on)`.

2. **DEV bench helpers in `gameScreen.ts`** — `window.__dwBenchTransition(roomId, opts?)` and `window.__dwBenchPingPong(roomA, roomB, iterations)` for reproducible transition timing tests.

3. **`computeRenderStateKey` memoization** (`roomRenderCacheStore.ts`). WeakMap keyed by `blockerKeys` Set identity + primitive-args signature. Empty-Set sentinel ensures freshly-constructed empty Sets still hit.
   - **Measured speedup: 18.1× on a 200-blocker Set, N=50 000 calls** (cold 25.5 µs/call → warm 1.4 µs/call, `bench` test, node --import tsx). The dominant cost was the Set sort+join inside the key builder; this is now skipped on the common hot path where the same room's blocker Set is re-queried (render passes, entry-warm probes, repeated adoption checks).

4. **Test coverage** — `src/tests/renderStateKeyMemo.test.ts` (5 tests, all passing) verifies cache stability, distinctness across different Sets, empty-Set sentinel sharing, and primitive-arg invalidation.

**Verification status:**
- `npm run build` — clean, 0 errors.
- `npm test` — 10/10 passing.
- The 18× memoization speedup is a measured node-side micro-benchmark. In-browser end-to-end transition timings have NOT been captured in this pass (no browser available in CI environment).

**Next profiling target (once in-browser timings are captured):**
Use the new `__dwTransitionStats()` / `__dwBenchPingPong()` helpers to capture compact summaries for the 13 verification scenarios listed in the problem statement. The dominant per-phase costs will then identify whether the next fix should target:
- `Resident:phaseD_walls_*` (large-room wall merge — already incremental but the **first** entry to a 1M-cell room still does the full build during background resident construction),
- `A:blockers+lighting` (now de-duplicated by render-state-key memoization),
- `D:wallTemplate*` on cold loads,
- or sprite/background decode at first room entry.

**Do not touch without evidence:** `mapSketchRenderer.ts`, `buildCompleteBoundaryWalls`, transition trigger geometry. These have caused regressions before; the problem statement explicitly flags them.

---

## Editor Palette Previews — Remaining / Future Work

Palette previews were added for all current `specialBlocks`, `enemies`, `triggers`,
`collectables`, `environment`, `objects`, `lighting`, `liquids`, `ropes`, and `guidePaths`
palette entries.  The following items have limitations or require future effort:

### `lighting` category — preview cards added (rich controls preserved)

Individual lighting items (`ambient_light_blocker`, `dark_ambient_light_blocker`,
`light_source`, `sunbeam`, `scene_light`) now show procedural preview cards in a
2-column grid below the rich lighting controls (sliders and dropdowns).
Selection highlighting and `onPaletteItemSelect` callbacks work the same as
other categories.

### Kinetic block previews — sprite-based

Kinetic blocks now use the first alphabetically-sorted sprite from
`ASSETS/SPRITES/specialBLOCKS/kineticBlock/` with a directional arrow overlay.
If no sprites are discovered at build time, the preview falls back to the
previous CSS/procedural style.

### DEV palette audit

`auditPalettePreviews(PALETTE_ITEMS)` runs once at editor init in DEV mode.
It logs a single success line if all items have previews, or groups missing
items with their id / label / category.  The helper functions
`hasPalettePreview(item)` and `getPalettePreviewKind(item)` are exported from
`editorPalettePreview.ts` for use in future tooling.

### Enemy types that currently use procedural previews (no sprite asset)

The following enemies use CSS/canvas shapes because no sprite asset exists in
`ASSETS/SPRITES/ENEMIES/`.  To upgrade them to sprite-based previews, add the
asset and register the URL in `ITEM_SPRITE_URL` inside `editorPalettePreview.ts`:

- `enemy_flying_eye` — procedural diamond
- `enemy_slime`, `enemy_slime_large` — procedural rounded shape
- `enemy_wheel` — procedural circle
- `enemy_water_bubble`, `enemy_ice_bubble` — procedural bubble circle
- `enemy_square_stampede` — procedural square
- `enemy_golden_mimic`, `enemy_golden_mimic_xy` — procedural gold diamond
- `enemy_bee_swarm` — procedural hex
- `enemy_web_spider` — procedural circle
- `enemy_dust_constellation`, `enemy_dust_constellation_large` — procedural star
- `enemy_orbital_dust_core`, `enemy_orbital_dust_core_large` — procedural orb
- `enemy_dust_block_mimic`, `enemy_dust_block_mimic_large` — procedural block
- `enemy_dust_weaver_architect`, `enemy_dust_weaver_architect_large` — procedural diamond
- `enemy_void_singularity`, `enemy_void_singularity_pair` — procedural void
- `enemy_dust_leech` — procedural oval
- `enemy_radiant_web` — procedural circle

### Crumble blocks and falling blocks (PaletteItem slots not yet in PALETTE_ITEMS)

`PaletteItem` declares `isCrumbleBlockItem` and `isFallingBlockItem` flags, and
`makeBlockPreviewShapeCss` in `editorUIHelpers.ts` already has switch-cases for
`crumble_block`, `crumble_block_2x2`, `crumble_ramp_*` IDs.  However, no
corresponding entries exist in `PALETTE_ITEMS` in `editorDropdownData.ts`.
When crumble / falling-block palette items are eventually added, their preview
shapes are already implemented — just add the item to `PALETTE_ITEMS` and the
blocks grid will pick them up automatically.


---

## Large-Room Performance — Remaining Area-Based Systems

The main freeze cause (`buildAmbientDarknessAlphas` Phase 1 dead O(W×H) litAir loop) and `buildAmbientDepths` omni-mode O(W×H) litAir build were fixed. The speedrun timer no longer charges loading/warm frame time.

The following area-based systems remain and were not changed in this pass:

### 1. `bgWallGrid` dense allocation — `residentWorldBuilder.ts`, `gameLoadRoomPhases.ts`

- **Pattern:** `new Uint8Array(room.widthBlocks * room.heightBlocks)` + fill, on every room load and resident build.
- **Impact:** `new Uint8Array(N)` in V8 uses zero-initialized memory (calloc/mmap) and is very fast (<1 ms even for 1M cells). Not the 18-second freeze. For rooms > 65536 cells a sparse `Set<number>` (key = `col + row * width`) would reduce memory from ~1 MB to a few KB for sparse rooms, but the allocation itself is not a bottleneck.
- **DEV scan fixed:** The DEV-only `bgWallGrid.reduce((n, v) => n + v, 0)` full-grid pass has been removed. `occupiedCells` is now counted during the painting loop (increment only when the target cell was previously 0), avoiding a second full-grid scan in the debug path.
- **Constraint:** `src/sim/clusters/snakeAi.ts` reads `world.bgWallGrid[idx]` directly (line ~215). Any sparse path requires a compatibility adapter.
- **Recommended next step:** If memory pressure from very large rooms becomes a concern, wrap `bgWallGrid` behind a `BgWallGridView` interface that picks dense vs. sparse based on a `DENSE_BG_GRID_MAX_CELLS = 65536` threshold. Gate behind the `65536` area check already logged in DEV.

### 2. `rebuildNavSolidGrid` in `snakeAi.ts`

- **Pattern:** `new Uint8Array(width * height)` for enemy snake pathfinding, then iterates occupied walls to fill.
- **Impact:** Same fast-allocation story as `bgWallGrid`. The fill loop iterates only occupied wall entries (not all cells). Not a bottleneck for sparse rooms. For a 1M-cell room with 100 walls, the grid is allocated but only 100 entries are written.
- **Recommended next step:** Low priority. Only matters if snake enemies exist in very large rooms.

### 3. `buildRoomWallTemplate` — **DONE (BUILD 424)**

- **File:** `gameRoomWalls.ts`, `residentWorldBuilder.ts`, `gameLoadRoomPhases.ts`.
- **What was done:** Added `buildRoomWallTemplateIncremental` generator (4 ms time-budget per `yield`).  `buildRoomWallTemplate` is now a thin synchronous wrapper around it (unchanged semantics for worker/editor/sync callers).  `residentWorldBuilder.ts` `phaseD_walls_build` iterates the generator yielding `'phaseD_walls_merge'` per slice.  `gameLoadRoomPhases.ts` Phase D wall-template block now inlines cache → baked → incremental-fallback logic with an extra `yield` between the lookup and the first merge slice, and caches `blockerKeys`/`darkBlockerKeys` at entry creation time (no post-hoc backfill needed).
- **Result:** The O(n²) merge pass is spread across frames; no single frame exceeds the 8 ms `LONG_PHASE_WARN_MS` threshold on large rooms.  Cache and baked paths are unchanged (fast O(n) copy).

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
   - BUILD 453: active caches now have explicit room/render-state/scale ownership.
     Room activation clears outgoing canvases before partial prewarm adoption,
     and budget-skipped dirty chunks use a neutral placeholder instead of
     presenting old room, old scale, or pre-mutation artwork.

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

### BUILD 421 — Room schema v3: compressed 1×1 wall storage (COMPLETED)

**Problem:** `dehydrateRoom()` routed all 1×1 and 2×2 walls to `exactWalls[]` (one JSON object per tile), bypassing the tile-grid compressor. The largest rooms had 5,000+ such objects, making files 160–973 KB.

**Fix:** Introduced schema version 3 with `solids.v1ByTheme` — a runs+points-only compressed format for walls with `hBlock === 1`. Walls with `hBlock > 1` continue to use the existing `byTheme` rect/run/point compressor.

**Key invariant:** walls in `v1ByTheme` hydrate with `hBlock = 1`, so `_buildSolid2x2Map` in `blockWallLayoutCache.ts` never promotes them to 2×2-sprite rendering. The 1×1 visual grain is preserved after every round-trip.

**Files changed:**
- `src/levels/tileGridCompressor.ts` — `extract1x1LayerFromGrid()` (runs + points only)
- `src/levels/roomSavedTypes.ts` — `Saved1x1Layer`, `SavedSolids.v1ByTheme`, `ROOM_SCHEMA_VERSION = 3`, `SavedRoomV2.v: 2 | 3`
- `src/levels/roomSchemaV2.ts` — `dehydrateSolidsByTheme` splits hBlock=1 → v1ByTheme; `dehydrateRoom` no longer writes `exactWalls` for ordinary solid walls
- `src/levels/roomSchemaHydrator.ts` — `hydrateSolidsByTheme` reads both `byTheme` and `v1ByTheme`; `isSavedRoomV2` accepts v=2 and v=3
- `scripts/migrate-rooms-v2-to-v3.mjs` — migration script (run once to update existing room files)
- `src/levels/roomFileAudit.ts` — dev-only per-room audit/report utility
- `src/levels/roomRoundTripValidator.ts` — dev-only dehydrate→hydrate correctness validator
- All 15 active room files migrated to v3

**Results (room file size reduction after v3 wall compression):**

| Room | Before | After v3 | Reduction |
|------|--------|-----------|-----------|
| underwater_lake_room.json | 973 KB | 388 KB | 60% |
| chasm_room.json | 483 KB | 84 KB | 83% |
| seal_chamber_room.json | 236 KB | 29 KB | 88% |
| the_fall_room.json | 197 KB | 40 KB | 80% |
| w1_room1_room.json | 178 KB | 17 KB | 90% |
| tall_shaft_room.json | 161 KB | 34 KB | 79% |
| lobby_room.json | 155 KB | 9.5 KB | 94% |

**Backward compatibility:** Old v2 files still load (their `exactWalls` array is still read by the hydrator). `isSavedRoomV2` accepts both v=2 and v=3.

---

### BUILD 432 (continued) — Water/lava zone, ambient blocker, and bgBlock compression (COMPLETED)

**Problem:** After v3 wall compression, several rooms still had bloated JSON due to:
- `underwater_lake_room.json`: 4,185 individual `[x,y,1,1]` water-zone rectangles + 3,455 per-cell ambient blocker entries → 388 KB
- `seal_chamber_room.json`: 307 per-cell dark ambient blocker entries → 29 KB
- `interesting_room_room.json`: 32 individual `[x,y,4,4]` lava-zone rectangles → 9 KB

**Fix:** Extended the v3 schema with new compact fields (purely additive — schema version stays at 3):
- `waterLayer` / `lavaLayer` — `SavedSolidLayer` (rects + runs + points) replacing `waterZones` / `lavaZones`
- `ambientBlockersClear` / `ambientBlockersDark` — `Saved1x1Layer` (runs + points), one per isDark value, replacing `ambientBlockers`
- `bgLayers` — `SavedBgLayer[]` grouped by `(themeKey, lb)`, each using `SavedSolidLayer`, replacing `bgBlocks`

**Key invariants:**
- Water and lava are stored in separate fields — never merged.
- Clear and dark ambient blockers are stored in separate fields — `isDark` identity is always preserved.
- Background block groups are never merged across theme or light-blocking differences.
- Zone rectangles can be merged freely because the runtime only does cell-coverage checks.
- Ambient blockers use runs+points (never 2D rects) since they are per-cell, not spatial extents.
- Legacy `waterZones`, `lavaZones`, `ambientBlockers`, `bgBlocks`, `exactWalls` fields are marked `@deprecated` in `SavedRoomV2` and remain readable for backward compat.

**Files changed:**
- `src/levels/tileGridCompressor.ts` — `expandLayerToRects()`, `expandBlockerLayerToCells()` (hydrate direction)
- `src/levels/roomSavedTypes.ts` — `SavedBgLayer`; new fields `waterLayer`, `lavaLayer`, `ambientBlockersClear`, `ambientBlockersDark`, `bgLayers`; deprecated old fields
- `src/levels/roomSchemaV2.ts` — `dehydrateZoneLayer()`, `dehydrateBlockerLayer()`, `dehydrateBgLayers()` helpers; `dehydrateRoom()` writes new compact fields
- `src/levels/roomSchemaHydrator.ts` — reads new compact fields with fallback to legacy fields for old v2/v3 files
- `src/levels/roomFileAudit.ts` — updated `RoomFileAuditEntry` with compact-field counters; updated `printRoomAuditTable()`
- `src/levels/roomRoundTripValidator.ts` — added water/lava/blocker/bgBlock coverage validation
- 3 room files migrated (underwater_lake, seal_chamber, interesting_room)

**Results (room file size after water/lava/blocker compression):**

| Room | After v3 walls | After full compression | Reduction |
|------|---------------|----------------------|-----------|
| underwater_lake_room.json | 388 KB | 7.7 KB | 98% |
| seal_chamber_room.json | 29 KB | 3.1 KB | 89% |
| interesting_room_room.json | 9.3 KB | 1.5 KB | 84% |

**soundHardness:** Per-wall `soundHardness` compatibility has been removed from active room wall, editor wall, and JSON wall types. Sound hardness at runtime derives from the room-level override or block theme.

**exactWalls:** All v3 rooms have zero `exactWalls`. The field is deprecated in types; the writer never emits it for ordinary terrain; the hydrator still reads it from old v2 files.

**Dev editor audit controls:** Completed. In dev/editor mode, the left editor panel now shows **Dev Room Checks** with:
- **Room Audit** — logs `printRoomAuditTable()` for the active campaign room set and warns for non-v3 rooms, v3 `exactWalls`, v3 legacy `waterZones` / `lavaZones` / `ambientBlockers` / `bgBlocks`, or any room that cannot be audited.
- **Round-trip Validate Rooms** — hydrates the active compact room set, runs the dehydrate -> hydrate validator through `printRoundTripReport()`, and logs a clear all-passed or failed-room summary.



#### Part A: Transitions are now trigger strips, not boundary holes

- **Boundary walls are complete solid edge rectangles.** All four boundary edges
  (top, bottom, left, right) are fully solid invisible walls with no gaps. Transitions
  no longer cut openings into boundary geometry.

- **Transitions are independent trigger strips** inside the boundary. The trigger fires
  when the player enters the strip 0.5 blocks past the near edge (`zoneLeft + 0.5BS`
  for right transitions, etc.), before the boundary wall stops movement.

- **Old room JSON remains compatible.** Fields `positionBlock`, `depthBlock`,
  `openingSizeBlocks`, `xBlock`, `yBlock`, `gradientWidthBlocks` are still interpreted
  as trigger-zone geometry. No existing campaign files need to be rewritten.

- **Shared boundary wall builder.** `src/levels/roomBoundaryWalls.ts` exports
  `buildCompleteBoundaryWalls(widthBlocks, heightBlocks): RoomWallDef[]` — the single
  source of truth for boundary wall generation used by both the runtime loader and
  the editor room builder. Do NOT reintroduce wall holes in this function.

- **Files changed:**
  - `src/levels/roomBoundaryWalls.ts` — NEW: shared complete boundary wall builder
  - `src/levels/roomJsonLoader.ts` — uses `buildCompleteBoundaryWalls`, removed old hole-cutting helpers
  - `src/editor/editorRoomBuilder.ts` — uses `buildCompleteBoundaryWalls`, removed old hole-cutting helpers
  - `src/screens/gameTransitions.ts` — trigger fires on zone entry (near side), not far edge

#### Part B: Baked runtime wall templates

- **Baked wall templates are now persisted through the compact `SavedRoomV2` format.**
  The persistence gap has been fixed: `dehydrateRoom()` now copies `json.bakedWallTemplate`
  into the compact saved room output, and `hydrateV2Room()` restores it into the verbose
  `RoomJsonDef` so `roomJsonDefToRoomDef()` receives and validates it normally.
  `SavedRoomV2` gains an optional `bakedWallTemplate?` field (type `RoomJsonBakedWallTemplate`).
  Old v2/v3 files without the field continue to load safely (field is optional).

- **Baked wall templates** are saved in exported room JSON under `bakedWallTemplate`.
  The editor's `editorRoomDataToJson()` runs `buildRoomWallTemplate()` once at export
  time and stores the result as flat JSON arrays alongside a `sourceHash` and
  `schemaVersion`.

- **Runtime prefers baked templates.** On room load, the runtime checks (in order):
  1. `RoomRuntimeCache` (fastest — already-merged from a prior visit)
  2. `room.bakedWallTemplate` (hydrated from JSON — skips `buildRoomWallTemplate()`)
  3. `buildRoomWallTemplate()` fallback (old/stale/missing baked data)

- **Source hash** (`computeWallTemplateSourceHash()`) covers: schema version,
  `BLOCK_SIZE_MEDIUM`, room dimensions, room `blockTheme`/`soundHardness`, and all
  interior wall properties. It does NOT cover transitions — boundary walls are
  independent of transitions.

- **Safe fallback.** If `bakedWallTemplate` is absent, has a wrong `schemaVersion`,
  has a stale `sourceHash`, or has mismatched array lengths, a DEV warning is logged
  and `buildRoomWallTemplate()` runs normally. Old campaign files without baked data
  continue to work.

- **Diagnostics.** All three paths emit a `[wallTemplate] roomId=... source=...` log
  in DEV mode.

- **`RoomWallTemplate` interface moved** from `gameRoomWalls.ts` to `roomDef.ts` so
  `RoomDef.bakedWallTemplate` can reference it without a circular dependency.
  `gameRoomWalls.ts` re-exports `RoomWallTemplate` for backward compatibility.

- **Files changed:**
  - `src/levels/roomDef.ts` — `RoomWallTemplate` interface moved here; `bakedWallTemplate?` added to `RoomDef`
  - `src/levels/roomWallTemplateHash.ts` — NEW: `BAKED_WALL_SCHEMA_VERSION`, `computeWallTemplateSourceHash`, `hydrateAndValidateBakedWallTemplate`
  - `src/editor/roomJsonSchema.ts` — `RoomJsonBakedWallTemplate` interface; `bakedWallTemplate?` on `RoomJsonDef`
  - `src/editor/roomJsonSerializer.ts` — bakes wall template during export
  - `src/editor/roomJson.ts` — re-exports `RoomJsonBakedWallTemplate`
  - `src/levels/roomSavedTypes.ts` — `SavedRoomV2` gains optional `bakedWallTemplate?: RoomJsonBakedWallTemplate`
  - `src/levels/roomSchemaV2.ts` — `dehydrateRoom()` deep-copies `json.bakedWallTemplate` into compact output
  - `src/levels/roomSchemaHydrator.ts` — `hydrateV2Room()` restores `saved.bakedWallTemplate` into `RoomJsonDef`
  - `src/levels/roomFileAudit.ts` — audit reports baked-template presence, wall count, schema version, and estimated size; warns for v3 rooms missing baked templates
  - `src/levels/roomRoundTripValidator.ts` — round-trip validation checks baked-template preservation (schema version, source hash, wall count, array lengths)
  - `src/screens/gameRoomWalls.ts` — re-exports `RoomWallTemplate` from `roomDef.ts`
  - `src/screens/gameLoadRoomPhases.ts` — Phase D uses baked template before falling back
  - `src/screens/residentWorldBuilder.ts` — uses `resolveRoomWallTemplate` from `preparedRoomRuntime.ts`; generator baked-hit path skips `phaseD_walls_build`
  - `src/screens/preparedRoomRuntime.ts` — `resolveRoomWallTemplate` (centralized cache→baked→fallback); DEV aggregate diagnostics (`getWallTemplateDiagnostics`, `logWallTemplateDiagnosticsSummary`); `buildPreparedRoomRuntime` reports `wallSource`; `_estimateRoomBuildCostMs` treats baked rooms as zero wall cost
  - `src/screens/roomPreparationWorker.ts` — worker uses baked template (copy typed arrays, skip merge pass); posts `wallSource` field
  - `src/screens/roomPreparationWorkerProtocol.ts` — `WorkerSuccessMessage` gains `wallSource: 'baked' | 'fallback'`
  - `src/screens/roomPreparationWorkerManager.ts` — logs `[wallTemplate] source=worker:…` in DEV after successful cache store

#### Cleanup hardening (BUILD 420 follow-up)

- **Active-load path inlines cache → baked → incremental fallback.** `gameLoadRoomPhases.ts` Phase D
  intentionally does NOT call the central `resolveRoomWallTemplate()`.  It inlines the
  cache → baked → `buildRoomWallTemplateIncremental()` fallback logic directly so it can
  `yield` between the lookup and the first merge slice (and between merge slices), keeping
  each frame under 8 ms.  The central resolver remains used in the resident-build and
  worker paths where yielding is handled differently.

- **Preload cost heuristic treats baked rooms as cheap.** `roomPreloadScheduler.ts`
  `estimateRoomBuildCostMs()` now returns zero wall cost when `room.bakedWallTemplate`
  is present, matching the `_estimateRoomBuildCostMs` logic in `preparedRoomRuntime.ts`.
  Baked rooms no longer get unnecessarily dispatched to the worker.

- **Aggregate diagnostics are now emitted.** `logWallTemplateDiagnosticsSummary('startup')`
  is called in `gameScreen.ts` after the initial radius-2 resident build completes,
  showing cache-hit/baked-hit/fallback counts and slowest fallback rooms in DEV.

- **Stale transition comments removed.** `RoomTransitionDef` in `roomDef.ts` no longer
  describes transitions as "openings in boundary walls" or "corridors beyond the edge".
  `openingSizeBlocks` is now documented as the trigger-strip span/length.
  `roomJsonSchema.ts` `interiorWalls` comment updated: boundary walls regenerate from
  room dimensions alone (not dimensions + transitions).
  `roomPreparationWorker.ts` top comment updated to reflect the baked-template fast path.

- **Fast-movement transition robustness.** `checkRoomTransitions()` in `gameTransitions.ts`
  now estimates the player's previous-tick position from `velocityXWorld`/`velocityYWorld`
  and fires the trigger if the player was approaching the strip and their velocity-estimated
  previous position was before the threshold.  This prevents fast grapple/zip movement from
  skipping the 0.5-block trigger strip in a single frame.

#### Remaining limitations

- All 15 active campaign room JSON files now have a valid `bakedWallTemplate` (baked by
  `scripts/bake-room-wall-templates.mjs`).  Rooms that are re-exported from the editor via
  "Export Campaign" will automatically receive an updated baked template via
  `editorRoomDataToJson()` → `dehydrateRoom()`.
- The hash does not cover per-wall ice/ultraIce flags (these fields do not exist in
  `RoomJsonWall`; ice theme is covered by `blockTheme`/`blockThemeId`).
- `phaseD_walls_build` is skipped for rooms with valid baked templates on their first
  load; subsequent visits always use `RoomRuntimeCache`.
- **`themeNames` remap logic** in `hydrateAndValidateBakedWallTemplate` is covered by
  `src/tests/roomWallTemplateHash.test.ts` (5 cases via Node's built-in test runner,
  `npm test`): dynamic remap with out-of-order registration, legacy no-themeNames
  passthrough, stale-hash fallback, array-length mismatch fallback, and empty-themeNames
  identity passthrough.

---

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
  - `evictDistant(currentRoomId)` — LRU-evicts rooms beyond `MAX_RESIDENTS = 16`; shells (never activated) evicted before rooms with frozen state.

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
| `residentWorldHot` | TRUE hot-swap: resident WorldState activated, `loadRoom` NOT called (BUILD 416+) |
| `residentRestore` | Instant path + snapshot restore (`loadRoom` ran, snapshots patched back); formerly `residentHot` |
| `residentFallback` | Instant path, first visit — fresh enemy spawn, no snapshot to restore |
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

#### What was implemented (Phase 4 — BUILD 416: True resident WorldState hot-swap)

1. **`residentWorldBuilder.ts` (new).** Pure function `buildResidentWorldState(room, campaignSeed, roomRuntimeCache): WorldState` builds a fully-initialised frozen WorldState without a player cluster. Equivalent to Phases A/C/D/E of `makeLoadRoomPhases` (no player, no renderer state, no camera). Module-level singleton resets are deferred to activation time.

2. **`ResidentRoomInstance.world: WorldState | null`.** Each resident instance now carries a full loaded `WorldState`. `runtimeReady: boolean` gates the hot-swap path. New methods: `setResidentWorld`, `invalidateResidentWorld`, `setResidentBuildQueueLength`, `setRadiusReadyCounts`.

3. **`applyResidentRoomActivation()` in `gameLoadRoomPhases.ts` (new export).** Applies Phase-A renderer state + Phase-B player spawn (`world.clusters.unshift(playerCluster)`) + Phase-F env effects/camera/schedules to the already-switched world. Carries HP from the outgoing room. All imports were already present in `gameLoadRoomPhases.ts`.

4. **True hot-swap path in `startTransitionLoad()`.** Before the existing instant path: if `targetResident.runtimeReady && targetResident.world !== null`, removes player from outgoing world, freezes outgoing world (enemies only), switches `world = targetResident.world`, calls `applyResidentRoomActivation()`, applies transition velocity. **`loadRoom` is never called on this path.** Records `'residentWorldHot'`.

5. **`residentRestore` renaming.** Snapshot-restore path now records `'residentRestore'` instead of `'residentHot'`. `TransitionOutcome` still includes `'residentHot'` for backward compatibility.

6. **Resident world stored after every load.** `setResidentWorld(room.id, world, true)` called after: startup load, instant-path (snapshot-restore), async load completion.

7. **Idle-frame background world building.** When `renderProfiler.getLastFrameMs() < 10`, one resident WorldState is built per frame for the highest-priority adjacent room missing `runtimeReady`. One build per frame keeps the budget bounded (~5–15 ms each).

#### BUILD 416 correctness audit (Phase 4 hardening)

**Verified:**
- True hot-swap path (`residentWorldHot`) does NOT call `loadRoom` — confirmed in `gameScreen.ts:597–681`.
- `world = targetResident.world` is the active-world swap; `loadRoomCtx.world = world` propagates it immediately.
- Frozen rooms are not ticked — `tick()`, enemy AI, hazards, ropes, grasshoppers, particles, and all sim systems are called only against the active `world`.
- `applyResidentRoomActivation` inserts exactly one player cluster via `world.clusters.unshift(playerCluster)`.
- Player HP is carried via `carryHealthPoints`; velocity is set after activation.
- `resetReusableSnapshot` + `captureClusterInterpolationState` are called in `applyResidentRoomActivation` before returning.
- `environmentalDust`, `sunbeamRenderer`, `atmosphericLightDust`, `guideDustPathRenderer` are re-initialised per Phase F.
- `playerCloak`, `phantomCloak`, `decorationWaveState` are reset.
- Renderer theme, lighting, blockers, seam blending are applied via Phase A.
- Prewarm chunk adoption via `adoptPrewarmedChunksForRoom` is called as part of Phase A.
- `cancelCameraTransition` clears stale camera state.
- Legacy fallback (`isPrepared` path) and async path (`loadRoom` path) remain intact and safe.

**Bugs found and fixed:**

1. **Critical: Stale typed-array references in `reusableSnapshot` after hot-swap.**
   `createReusableSnapshot(world)` stores direct TypedArray references from the initial WorldState. After `world = targetResident.world`, the snapshot still pointed at the old room's buffers (particles, walls, ropes, grasshoppers, enemies, projectiles, etc.). `updateSnapshotInPlace` only updates scalars, not TypedArray references; `resetReusableSnapshot` only reset the cluster pool before calling `updateSnapshotInPlace`. Fixed by adding `refreshSnapshotWorldArrayRefs(snap, world)` to `snapshot.ts` (exported), which re-points all ~90 typed-array fields at the new world. Called as the first step in `resetReusableSnapshot` so it applies on every room load (hot-swap or legacy).

2. **Stale `world` reference in `gameOverlayController` after hot-swap.**
   `createGameOverlayController` received `world: WorldState` as a direct object reference captured at construction time. `openSkillTombMenu()` and `openMapOnly()` used this captured reference to read `world.clusters[0]` and mutate particle durabilities — reading the old room's data after hot-swap. Fixed by changing the parameter to `getWorld: () => WorldState` and calling `getWorld()` at the top of each function that needs the live world.

3. **Incorrect diagnostic: `'hot'` recorded when `loadRoom` ran (`residentFallback` path).**
   `recordTransitionOutcome` was called with `'hot'` when `residentMode === 'residentFallback'` (instant path, loadRoom ran, no frozen state to restore). `'hot'` implies no loadRoom. Fixed by adding `'residentFallback'` to `TransitionOutcome` (in `roomRenderChunkWarmScheduler.ts`) and passing `residentMode` directly to both the `recordTransitionOutcome` call and the `outcome` field.

4. **DEV duplicate-player diagnostics (new).**
   Added two DEV-only checks in `residentRoomManager.ts`:
   - `freezeRoom`: asserts no cluster with `isPlayerFlag === 1` exists in the outgoing world **when called with `{ playerDetached: true }`**. On the hot-swap path the player must be removed before freeze; this catches any regression.
   - `setResidentWorld` (active): asserts exactly one player cluster is present after activation.

#### BUILD 416 player transfer hardening (Phase 4 pass 2)

**What was implemented:**

1. **Explicit player transfer functions** (`src/screens/playerTransfer.ts`):
   - `capturePlayerTransferState(world)` — snapshots health, facing direction (`isFacingLeftFlag`), and all non-transient player-owned particles before detach.
   - `detachPlayerFromResidentWorld(world)` — kills all player-owned particles (clearing `respawnDelayTicks` so frozen world won't regen them), removes player cluster, clears all grapple flags.
   - `restoreTransferredPlayerParticles(world, snapshot, entityId, spawnX, spawnY)` — writes captured particles into the target world anchored to the new spawn position. Resets combat fields (behaviorMode, attackModeTicksLeft) to orbit. Returns `{restored, skipped}`.

2. **Player particle carry-over** — non-transient player-owned dust particles (kind, durability, regen delay, weave slot, noise seed, orbit anchor, lifetime/age) transfer across hot-swap. Transient particles (stone shards, lava embers etc.) are intentionally not carried.

3. **Sprite facing direction preserved** — `isFacingLeftFlag` from the captured snapshot is applied to the new cluster before insertion so the player does not snap to right-facing on room entry.

4. **Ownership invariant scan** — `ResidentRoomManager.scanOwnershipInvariant()` (DEV-only): checks all resident worlds for correct player counts (1 in active, 0 in frozen), no live non-transient player-owned particles in frozen worlds, and no duplicate player entity ids across worlds. Called automatically after every hot-swap in DEV mode.

5. **Particle transfer diagnostics** — `ResidentRoomDiagnostics` gains `lastPlayerParticlesCaptured`, `lastPlayerParticlesRestored`, `lastPlayerParticlesSkipped`. Debug overlay shows `pt:restored/captured (skip:N)` on the "Last xtn:" line when particles were transferred.

6. **Stale world capture audit** — All major controllers and renderers confirmed safe: `gameOverlayController` already fixed; `gamePlayerCloakUpdate`, `gamePlayerSfx`, `gamePauseController`, `combatText`, `gameHudDebugState`, HUD renderers all receive `world` as a per-call parameter and hold no long-lived captures.

**What is preserved across transitions:**
- Player health (`healthPoints`)
- Sprite facing direction (`isFacingLeftFlag`)
- Transition velocity (applied after activation, unchanged)
- Non-transient player-owned dust particles (kind, durability, regen state, orbit parameters)
- Weave slot assignments per particle

**What is intentionally reset on transition:**
- All room-local collision flags (`isGroundedFlag`, `isTouchingWallLeftFlag`, etc.) — zeroed by `createClusterState`
- Grapple state — cleared by `detachPlayerFromResidentWorld` / `applyResidentRoomActivation`
- Particle positions — reanchored to the new spawn point using preserved orbit angle/radius
- Particle velocities — zeroed; particle settles into orbit naturally
- Particle behavior mode — reset to orbit (0); previous room's attack state is stale
- Transient particles — room-local effects, not carried

#### BUILD 417 resident lifecycle hardening (Phase 4 pass 3)

**Three correctness issues fixed:**

1. **Outgoing resident world preserved after true hot-swap (was: discarded).**
   After `detachPlayerFromResidentWorld(world)` the outgoing `WorldState` is clean — no player cluster, enemies/hazards/ropes/blocks intact exactly as the player left them.  The previous BUILD 416 code called `invalidateResidentWorld(currentRoom.id)` immediately after switching to the target world, destroying this valid frozen state.
   Fixed: `setResidentWorld(outgoingRoomId, outgoingWorld, false)` is called instead of `invalidateResidentWorld`, storing the detached world as a `runtimeReady = true`, `lifecycle = 'frozen'` resident.  Immediate backtracking (A→B then B→A) now hot-swaps without `loadRoom`.

2. **False duplicate-player DEV error on legacy/snapshot paths eliminated.**
   `freezeRoom()` previously logged a DEV error whenever any player cluster was found in the outgoing world.  This was correct for the hot-swap path (player must be detached first) but wrong for the legacy `isPrepared` and async paths that call `freezeRoom` before `loadRoom` while the player is still present.
   Fixed: `freezeRoom` gains an optional `opts.playerDetached` boolean.  The DEV check fires only when `opts.playerDetached === true`.  The hot-swap call site passes `{ playerDetached: true }` (strict); legacy call sites omit the option (permissive, no false alarm).

3. **Resident builds no longer consume the shared `levelRng` (RNG isolation).**
   `buildResidentWorldState` previously accepted `levelRng: RngState` — the same instance used by active gameplay — and consumed it for enemy and background fluid spawning.  Depending on idle timing and room-load order this could perturb active gameplay randomness.
   Fixed: the signature changes from `(room, levelRng, cache)` to `(room, campaignSeed, cache)`.  A dedicated `createResidentRoomRng(room, campaignSeed)` function derives a stable per-room RNG by hashing `campaignSeed ^ _hashRoomId(room.id) ^ (room.worldNumber * 2654435761)`.  This RNG is local to each build call; the active `levelRng` is never touched.  The call site passes `RESIDENT_CAMPAIGN_SEED = 0xd457_0417` (decoupled constant, distinct from the levelRng seed `12345`).
   Note: enemy placement and background fluid in resident builds will differ cosmetically from a fresh `loadRoom` call for the same room.  This is intentional and documented.

**Diagnostic improvements:**
- `ResidentRoomDiagnostics` gains `lastOutgoingRoomId` and `backtrackHot`.
- `backtrackHot` is `true` when the room the player just came from is still `runtimeReady` (frozen world preserved), meaning an immediate B→A transition can hot-swap.
- Debug overlay "Resident Rooms" panel gains a "Backtrack:" line: `hot ✓` (green) or `cold ✗` (orange) depending on outgoing room state.
- `ResidentRoomManager.recordOutgoingRoom(roomId)` called on every true hot-swap.

#### What remains deferred (Phase 4 limitations)

1. **Complex enemy module-level state.** RadiantTether, DustConstellation, OrbitalDustCore etc. carry module-level singleton state not inside `WorldState`. On hot-swap activation, these singletons are reset (via `resetRadiantTetherState` / `resetRadiantWebState`), discarding the frozen AI chain state. Full fix requires serializing these singletons into `WorldState`.

2. **Per-room renderer context.** Module-level renderer state is re-applied on every activation. Future work: store renderer state per resident and apply atomically.

3. **Projectiles crossing room boundaries.** Not handled; any in-flight projectile at a boundary is lost on transition.

4. **Player particle carry-over — IMPLEMENTED (BUILD 416).** Non-transient player-owned dust particles are now captured before room detach and restored in the target world after the player cluster is inserted. Transferred fields: kind, anchor angle/radius, durability, regen delay, weave slot, noise seed, mass, lifetime, age, isAliveFlag. Reset on entry: position (reanchored to spawn), velocity, behavior mode, attack timer, disturbance factor. If the particle buffer is full, skipped particles are logged as a DEV warning. The fresh-spawn loadout path remains for first visit or legacy load. Diagnostics: `pt:restored/captured` shown in the debug overlay.

5. **Memory footprint.** Each WorldState ~570 KB; 16 residents = ~9 MB additional. Acceptable but should be monitored.

6. **RNG determinism — FIXED (BUILD 417).** `buildResidentWorldState` now uses a stable per-room RNG derived from `campaignSeed`, `room.id`, and `room.worldNumber`.  Active gameplay `levelRng` is never consumed by background resident builds.  Enemy and fluid placement in resident builds is deterministic but intentionally decoupled from the active gameplay RNG stream.

7. **Idle resident builds — incremental multi-phase scheduler (BUILD 418+).** Each background world build is split into generator phases (`phaseA`, `phaseC`, `phaseD_fluid`, `phaseD_chains`, `phaseD_walls_lookup`, optional `phaseD_walls_build`, `phaseE_sim`, `phaseE_dust`) via `createResidentBuildGenerator()` in `residentWorldBuilder.ts`. The scheduler processes one phase per RAF frame (not one full build) so no single frame bears the full build cost. A stale-build guard (`_roomVersions` map) discards in-flight sessions if the room was edited after the session started. At most one session is active at a time. Priority-1/2 tasks can start regardless of last-frame time; priority-3/4/5 starts remain gated on previous frame < 10 ms. Build duration (full session) and current phase are shown in the debug overlay.

   Queue priorities (now actually wired):
   - Priority 1: hot-swap transition target (enqueued when player is within URGENT_PRELOAD_PROXIMITY_BLOCKS of a boundary)
   - Priority 2: velocity-direction target (enqueued based on player movement direction each frame)
   - Priority 3: radius-1 adjacent rooms
   - Priority 4: radius-2 adjacent rooms
   - Priority 5: rebuild-after-edit

   Deduplication by room id with priority upgrades (lower number wins). Queue length by priority shown in debug overlay.

8. **Initial radius-2 residents — incremental pre-gameplay phase with overlay (BUILD 418+, BUILD 419).** The loading overlay is shown unconditionally before the RAF loop. The initial build phase runs inside the RAF loop (not before it): two "yield" frames allow the overlay to paint, then `createResidentBuildGenerator()` is used for each room — one generator phase per RAF frame — so no single startup frame bears the full synchronous build cost. Gameplay, sim, input, and transitions remain blocked for the entire initial build phase. Diagnostics (`initialRadius2Built/Total/Failed/LoadMs`) shown in the debug overlay and logged to console. `runtimeReady` is only set when the generator returns the completed `WorldState` (never on an intermediate yield).

9. **Editor invalidation — hardened (BUILD 418+).** On editor room changes:
   - Edited room's `_roomVersions` counter is incremented (stale-build guard).
   - `roomRuntimeCache.invalidate` called for the **edited room only** — neighbor wall templates are built purely from their own room geometry and do not depend on adjacent rooms, so their cache entries remain valid.
   - `invalidateRoomChunkPrewarm` called for edited room AND all radius-1 neighbours (render chunks can reference shared-boundary geometry).
   - `invalidateResidentWorld` called for edited room and radius-1 neighbours; all re-enqueued at priority 5.
   - After `loadRoom()`, `setResidentWorld(roomId, world, true)` updates the active resident record with the freshly-loaded world so subsequent hot-swaps do not see the null/stale state.

#### Resident-runtime verification checklist

These checks confirm correct behaviour for the resident-room runtime. Run manually in DEV mode:

- [ ] `npm run build` passes (tsc exits 0; pre-existing TS2688 vite/client warning is harmless).
- [ ] Startup: loading overlay is visible before any resident builds begin; console shows `[startup] initial resident N/T: roomId done` for each room; game does not become interactive until all initial builds complete; no single startup frame spends > ~10 ms on a full synchronous build.
- [ ] Normal adjacent transition: console shows `residentWorldHot` mode; `loadRoom` is NOT called; overlay does not reappear.
- [ ] Immediate backtracking (A→B then B→A): second transition also uses `residentWorldHot`; debug overlay shows `Backtrack: hot ✓`.
- [ ] Legacy/fallback path: `residentFallback` or `legacyLoad` mode; no false duplicate-player DEV errors logged.
- [ ] Player dust transfer: `pt:N/M` in debug overlay; restored count matches captured count; no DEV skipped-particle warnings under normal conditions.
- [ ] Runtime incremental scheduler: debug overlay shows `Building: roomId (reason phaseD_walls_build)` (with phase label) while a session is active; no single frame shows 15+ ms from a full synchronous build; console shows `[resident] incremental build done:` messages; `Building:` line clears when build finishes.
- [ ] Priority boosting: when player approaches a boundary, debug overlay Q breakdown shows p1 entry; velocity-direction entry shows p2 with reason `velocityDirection`; p3/p4 for radius-1/2 adjacents.
- [ ] Editor invalidation: editing a room then immediately transitioning into it does NOT hot-swap stale pre-edit state; debug overlay shows the edited room's resident rebuilding; stale chunk caches evicted.

#### BUILD 419 hardening pass

**What was verified:**
- Hot-swap guard (`targetResident.runtimeReady && targetResident.world !== null`) confirmed in `startTransitionLoad`; instant path (`residentWorldHot`) skips `loadRoom`.
- Initial build phase (`_initialResidentBuildPhase`) confirmed to block gameplay/sim/input/transitions until all radius-2 builds complete or fail.
- Editor invalidation: `invalidateResidentWorld` called for edited room + radius-1 neighbours, re-enqueued at priority 5; stale-build version guard discards any in-flight session for the same room.
- Priority queue and deduplication confirmed: `_enqueueResidentBuild` uses a min-heap keyed on priority; duplicate enqueue with lower priority number wins; equal priority de-duplicates silently.
- `backtrackHot` confirmed: outgoing world is stored via `setResidentWorld(outgoingRoomId, outgoingWorld, false)` so an immediate B→A transition hot-swaps.

**What was changed (BUILD 419):**

1. **Per-phase 8 ms timing warnings.** `createResidentBuildGenerator` gains an optional `diagContext: ResidentBuildDiagContext` parameter (exported interface). Each of the 8 generator phases captures wall-clock time; `_warnLongPhase()` emits a `[resident] long phase` console warning in DEV when any phase exceeds `LONG_PHASE_WARN_MS = 8` ms. `diagContext.onLongPhase(phase, ms, roomId)` is called so the manager can record the last long phase.

2. **`lastLongPhase` diagnostics.** `ResidentRoomDiagnostics` gains `lastLongPhase`, `lastLongPhaseMs`, and `lastLongPhaseRoomId`. `ResidentRoomManager.recordLongPhase()` updates these. The debug overlay now shows a `Last long phase:` line in orange when a long phase was recorded.

3. **Priority upgrade for active sessions — FIXED.** Previously, re-enqueuing an already-active session at higher priority set `_activeBuildSession = null`, restarting the entire generator from scratch. Fixed: `_enqueueResidentBuild` now updates `_activeBuildSession.task.priority` and `.reason` in-place when the active session's room matches the new task. `setCurrentBuildInfo` is called immediately so the debug overlay reflects the upgrade without a generator restart.

4. **`initialRadius2Built` off-by-one — FIXED.** The `built` counter now increments only when a generator actually completes a fresh build. The already-`runtimeReady` early-exit path no longer increments `built` (it only advances `total` when the room needed building). `total` reflects rooms that required a build; `built` reflects rooms where the build ran to completion this startup.

5. **Resident miss reason specificity.** `_hotSwapMissReason` computed in `startTransitionLoad` distinguishes:
   - `'residentMissing'` — no resident record exists for the target room.
   - `'buildInProgress:<phase>'` — a generator session is actively running; includes the current phase label.
   - `'buildQueued'` — a build task is queued but not yet started.
   - `'runtimeNotReady'` — resident exists but `runtimeReady = false` (build not yet complete or failed).
   - `'worldNull'` — `runtimeReady = true` but `world` is null (should not occur; indicates a bug).
   - `''` (empty) — hot-swap was used; no miss.
   Passed to `recordTransitionMode` so the resident diagnostics panel shows the specific miss reason.

6. **Renamed `_isCurrentPhaseHeavyWalls` → `_isAboutToRunHeavyWallsBuild`.** The deferral check triggers when the current phase label is `'phaseD_walls_lookup'` (meaning the *next* generator step will run `buildRoomWallTemplate()`). The old name implied the heavy step was the *current* step, which was misleading.

7. **`diagContext` wired at both call sites.** Both the runtime scheduler and the initial build phase now pass `diagContext` (with `roomId` captured in a `const` ref) to `createResidentBuildGenerator`. Long-phase callbacks correctly identify the room even after `_activeBuildSession` or `_adjRoom` is reassigned.

**`phaseD_walls_build` status (BUILD 424):** Now incremental. `buildRoomWallTemplateIncremental()` spreads the O(n²) merge pass across frames (4 ms budget per yield), emitting `'phaseD_walls_merge'` labels. The deferred note from BUILD 419 is resolved.

**Runtime phase budget policy:** Unchanged from BUILD 418. One generator phase per RAF frame, executed post-render before endFrame. The heavy-walls deferral gate (`_isAboutToRunHeavyWallsBuild`) skips `phaseD_walls_build` when last-frame time ≥ 10 ms. Priority-1/2 heavy phases are not deferred.

#### Remaining limitations (BUILD 419)

1. ~~**`phaseD_walls_build` is still a single synchronous step.**~~ **FIXED in BUILD 424.** `buildRoomWallTemplateIncremental()` spreads the merge pass across frames (4 ms budget per yield).

2. **Build phases execute pre-paint (post-render, pre-endFrame).** A `requestIdleCallback`-style path would advance build phases after the browser paints the frame, reducing their contribution to frame latency. This requires synchronising the idle callback with the RAF loop to prevent concurrent mutations to `roomRuntimeCache` or the active `WorldState`. Deferred; the per-phase debug overlay provides sufficient visibility into individual phase costs in the interim.

3. **Priority 1/2 enqueue is per-frame, not edge-triggered.** The proximity and velocity checks run every gameplay frame. `_enqueueResidentBuild` de-duplicates by id with priority upgrade, so this is safe (no queue explosion) but does generate small per-frame overhead. An edge-triggered alternative (enqueue on direction change or crossing proximity threshold) could be cleaner — deferred.

4. **Active-session priority upgrade — FIXED in BUILD 419 (in-place, no generator restart).** Priority and reason are updated on the active session without restarting the generator. If the room definition changed (different version), a restart would be correct but is not currently triggered by a priority upgrade alone; that case relies on the stale-build version guard completing the session and discarding the result.

5. **Only urgent starts bypass frame gate.** Priority-1/2 entries now bypass the `<10 ms` start gate to avoid starvation under sustained load, but background Priority-3/4/5 entries still wait for a fast prior frame. If frame time remains consistently high, non-urgent resident builds can still lag behind.

6. **Complex enemy module-level state** (RadiantTether, DustConstellation, etc.) still not serialized. Hot-swap resets these singletons on activation. Full fix requires serializing them into WorldState.

7. **Per-room renderer context** not yet stored per-resident. Module-level renderer state is re-applied on every activation.

8. **`lastLongPhase` overlay line persists for the session.** Once set, it is never cleared. This is intentional for diagnostic visibility (captures the worst phase that occurred) but may be confusing if the issue was transient.

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
- BUILD 453: wall/background cache ownership boundary; cross-room and dirty-canvas blits rejected; partial adoption clears incompatible active entries.

#### What is validated at adoption time (Phase A)

- `adoptPrewarmedChunksForRoom` in `gameLoadRoomPhases.ts` computes `adoptRenderStateKey` using all 14 render-affecting fields (expanded in BUILD 414).
- Both `adoptPrewarmedWallChunks` and `adoptPrewarmedBgChunks` compare this key against `snapshot.renderStateKey` and return `{ status: 'staleRenderState' }` on mismatch.
- `_finishWarm` in `entryViewportWarm.ts` forwards the current key so entry-warm adoption is guarded the same way.
- The scheduler captures the structured result and `startTransitionLoad` translates it to a specific `missReason`.

#### Remaining limitations

1. **Very fast crossings can outpace idle prewarming.** Grapple and zip traversal can move the player across a room boundary before the idle scheduler has completed the target room's prewarm pass. `ensureChunkPrewarmQueued` is called on proximity, but proximity detection depends on normal-speed movement. No fix planned for now — entry-warm handles the fallback.

2. **Partial prewarm still causes `entryWarm`.** If the idle scheduler only completed the wall pass (not bg) before the player crossed, `bgPrewarmPresent: false` will show in the diagnostic and outcome will be `entryWarm`. The entry-warm path handles this correctly but the player sees a brief textless cover.

3. **Prewarm eviction on mid-session settings changes.** If `setActiveBlockLighting`, `setActiveBlockSpriteTheme`, or related settings change mid-session via the pause menu, existing warmed snapshots keep their stale key until the next `scheduleChunkPrewarms` or adoption attempt. Adoption rejects them, and active dirty canvases now render neutral placeholders, so this is a wasted-work/performance gap rather than a stale-artwork correctness gap. Explicit cache-bust calls would still reclaim the data earlier.

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
# Momentum Turret manual validation

- Run an editor playtest with multiple wall-mounted Momentum Turrets and verify ring/beam alignment, roughly 1.5-second standstill lock timing plus grace, paused lock visuals behind terrain, independent tracking, authored-position stability, and normal momentum-collision death. Automated simulation/schema coverage and the production build pass; this live visual/input pass was not available in the current non-interactive validation run.
