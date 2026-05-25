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

### What Was Fixed in This Pass (current optimization pass)

1. **`imageCache.ts` — decode-aware sprite preloading added**
   Added `decodeImg(src)` which calls `HTMLImageElement.decode()` after the
   image finishes downloading, ensuring the GPU has rasterized the texture
   before the first drawImage call.  Added `isSpriteDecodeReady(img)` which
   returns `true` when decode is confirmed or falls back to `isSpriteReady`
   for images not preloaded via `decodeImg`.  Both functions are safe in
   environments without decode() (Safari older, Node): they fall back to the
   plain load-complete check.  Rejected decode() Promises are swallowed
   gracefully — failed images still fall back to solid-colour tiles.

2. **`roomAssetPreloader.ts` — decode support and improved readiness check**
   Added `decodeRoomThemeSprites(room)` which fires `decodeImg()` for all
   folder-based block-theme sprite URLs of a room. Returns a Promise that
   resolves when all sprites are decode-ready (or loaded, as a fallback).
   Updated `areRoomSpritesReady()` to use `isSpriteDecodeReady()` instead of
   `isSpriteReady()`, so the loading overlay stays up until sprites are both
   downloaded and decoded when `decodeRoomThemeSprites` has been called for
   the room.

3. **`roomPreloadScheduler.ts` — radius-1 sprite preloading now uses decode**
   Changed radius-1 rooms (directly adjacent) from `preloadRoomThemeSprites`
   (loadImg only) to `void decodeRoomThemeSprites` so that sprites for the
   most likely next rooms are GPU-rasterized, not just downloaded, by the time
   the player reaches the boundary. Radius-2 rooms keep the cheaper
   `preloadRoomThemeSprites` (loadImg only); they get decode triggered later
   if the player approaches their boundary.

4. **`gameScreen.ts` — current room decoded on Phase F; proximity fires decode**
   Phase F now fires `void decodeRoomThemeSprites(room)` alongside the existing
   `preloadRoomThemeSprites` call, ensuring the current room's sprites are
   decode-queued as soon as the room loads.
   The proximity-based priority preload block now also calls
   `void decodeRoomThemeSprites(targetRoom)` when the player is within
   `URGENT_PRELOAD_PROXIMITY_BLOCKS` of an unprepared transition boundary —
   giving sprites the maximum lead time for decode before the crossing fires.
   Both calls are fire-and-forget and never block the gameplay frame.

5. **`blockSpriteRenderer.ts` — equality guards on theme/world setters**
   Added early-return guards to `setActiveBlockSpriteTheme` and
   `setActiveBlockSpriteWorld`: if the new value is identical to the current
   active value, `_invalidateBakedWallCanvas()` is skipped, preventing
   spurious full-chunk invalidation when a room has the same theme as the
   previous room.

6. **`roomRuntimeCache.ts` — default capacity increased from 10 → 16**
   The larger capacity covers: current room (1) + all direct neighbours (~5) +
   next-hop rooms (~8) + buffer for rapid backtracking — without evicting
   recently visited rooms too aggressively.  Memory impact is negligible
   (each entry is a few KB of typed arrays and Sets).

### What Was Fixed in Previous Passes (BUILD 390)

1. **`roomPreloadScheduler.ts` — worker-unavailable heavy-room path**
   Previously, when the Web Worker was unavailable (Safari Private, strict CSP)
   and a heavy room's idle timeout fired, the scheduler built the room synchronously
   on the main thread — potentially freezing gameplay for hundreds of milliseconds.

   Changed: when `deadline.didTimeout` fires for a room above the cost threshold
   and the worker is still unavailable, the speculative preload is **skipped**
   rather than forced.  The existing async loading overlay will cover any
   resulting cache miss if the player actually transitions to that room.

2. **`preparedRoomRuntime.ts` — safe urgent-build variant added**
   Added `tryEnsureRoomPreparedIfCheap(roomId, cache, maxCostMs?)` which
   applies the build-cost heuristic before deciding whether to build
   synchronously.  Returns `false` (without building) if the estimated cost
   exceeds `maxCostMs` (default: `SAFE_SYNC_BUILD_COST_MS = 8 ms`).

3. **`blockEdgeShading.ts` — budget guard documentation**
   Added a prominent ⚠️ warning noting that callers must check
   `FP.isBakeBudgetExhausted()` before invoking it.

### Remaining Risks

1. **Sprite/chunk warm-up lag on cold entry**
   With caps of 8 bakes/frame and 4 chunks/frame, a fresh room converges over
   ~10–20 frames.  Decode-aware preloading reduces pop-in for folder-based
   themes; legacy world-number sprites (brownRock, dirt, world 0–9) are not
   tracked by the decode set and still rely on the load-complete check.
   If residual pop-in is visible, increase `spriteBakeMaxPerFrame` or
   `_maxChunksPerFrame` from the console.

2. **Worker unavailable — heavy rooms no longer freeze, but also not preloaded**
   Heavy adjacent rooms are skipped when the worker is unavailable.  Cache-miss
   transitions use the async loading overlay.  Correct tradeoff for gameplay
   smoothness, but users on Safari Private or strict CSP see the overlay more
   often for large rooms.

3. **`applyOrganicEdgeShading` direct callers**
   Any future code that calls `applyOrganicEdgeShading` directly must add its
   own `FP.isBakeBudgetExhausted()` guard.

4. **Phase D wall template build timing**
   `buildRoomWallTemplate()` on a large room is O(n²) and may exceed 16 ms.
   It runs in Phase D (one phase per RAF frame behind the loading overlay), so
   it does not block normal gameplay, but Phase D itself may be a slow frame
   visible in the Freeze debug panel.  Worker-preloaded rooms bypass this entirely.

### Intentionally Deferred

1. **Entry-area chunk pre-baking for the target room**
   The chunk render cache (`chunkRenderCache.ts`) is a module-level singleton
   tied to the currently active room's wall layout, theme, and lighting globals
   in `blockSpriteRenderer.ts`.  Pre-baking chunks for a different (target)
   room would require either:
   - A second independent `RoomChunkCache` instance with snapshot of target
     room theme/lighting state, OR
   - Splitting `blockSpriteRenderer.ts` so theme/lighting state can be swapped
     per-cache without affecting the active room.
   Both require architectural refactoring that is out of scope for a safe
   incremental pass.  The decode preloading in this pass addresses the largest
   source of pop-in (GPU rasterize stall) without this risk.

2. **Base-chunk / lighting-overlay architectural split**
   `setActiveBlockLighting` (and `setActiveBlockSpriteTheme`) call
   `_invalidateBakedWallCanvas()` which rebuilds all chunks.  Separating
   "base wall tiles" chunks from "lighting/seam overlay" chunks would let
   lighting-only changes rebuild only the lighter overlay layer.  This would
   require adding a second `RoomChunkCache` for overlays and splitting the
   `buildChunkFn` callback into base and overlay passes.  Deferred to a
   dedicated refactor pass.

3. **Legacy/world-number sprite decode tracking**
   `decodeImg` and `decodeRoomThemeSprites` only cover folder-based themes
   (those in `FOLDER_BLOCK_THEMES`).  Legacy world-number sprites (brownRock,
   dirt, world 0–9 block/edge/corner/end sets) start loading at module init
   time via `blockSpriteSets.ts` and are not tracked by `_decodedUrls`.
   `isSpriteDecodeReady` falls back to `isSpriteReady` for these, so
   readiness reporting is accurate but decode-awareness is absent.  To address
   this, the init-time `loadImg` calls in `blockSpriteSets.ts` would need to
   be replaced with `decodeImg` calls.

4. **`proceduralBlockSprite.ts` private image cache**
   `proceduralBlockSprite.ts` maintains its own `_imgCache` separate from
   `render/imageCache.ts`.  Unifying these caches would give more accurate
   readiness reporting for procedural sprites and avoid the risk of two
   `HTMLImageElement` objects for the same URL.

### How to Verify

1. `npm run build` — must pass with no type errors.
2. Enter a room with folder-based block themes and observe that wall tiles
   render without pop-in (no brief solid-colour fallback for decoded sprites).
3. Move quickly across several connected rooms — transitions should remain
   instant on the prepared path.
4. Backtrack between rooms — recently visited rooms should be served from
   cache without re-preparation.
5. Test with worker available (normal Chrome): transitions should be instant or
   use the loading overlay with no gameplay freeze.
6. Test with worker unavailable if feasible (Safari Private / DevTools → Block
   Workers): large rooms should use the async loading overlay on first visit.
7. Check the Freeze debug panel (pause menu → Debug → Freeze) — no `preload`
   entries >8 ms during normal gameplay.
8. Confirm no stale `EdgeExtensionCache` runtime references remain in active
   comments.
---

## Priority 1-A — Scene-Light Occluder and Bloom Optimization (this pass)

### What Was Fixed

1. **`lightingSystem.ts` — stopped marking occluders dirty every frame**
   `initLightingSystem()` previously set `_isOccludersDirty = true`
   unconditionally.  Because it was called every frame from
   `gameRenderSceneLighting.ts`, this caused a full room-level occluder
   rebuild on every frame — O(walls × 4 segments each), discarding the
   previously-built cache.

   Fixed: `initLightingSystem()` now only sets the dirty flag when the
   canvas dimensions actually change (virtual resolution change).
   `markOccludersDirty()` still marks the cache dirty on room change,
   editor wall modification, or geometry destruction.

2. **`lightingSystem.ts` — per-light spatial occluder culling**
   The previous room-level occluder pre-build used `radiusWorld = 1e9`
   (effectively no culling), then passed all ~N×4 segments to every
   shadow-casting light's visibility polygon.  In a large room with 1000+
   walls and multiple shadow lights, this was very wasteful.

   Fixed: the global pre-build is replaced with a per-light call to
   `buildWallOccluders(_cachedWalls, light.xWorld, light.yWorld,
   visRadiusWorld, _lightOccluders)`.  Only walls within the light's radius
   contribute occluder segments, reducing both the segment count fed to
   `computeVisibilityPolygon` and the O(n²) sweep cost inside it.

   The `_lightOccluders` scratch buffer is pre-allocated (2048 slots, same
   as before) and reused across lights each frame — no per-frame allocation.

3. **`glowPass.ts` / `bloomSystem.ts` — bloom empty-frame skip**
   `GlowPass` now tracks `hasGlow: boolean`, reset in `clear()` and set to
   `true` by any draw method that passes the intensity threshold.
   `BloomSystem.compositeToDevice()` returns immediately (skipping the
   canvas filter and compositing cost) when `this.glowPass.hasGlow` is
   `false`.  The profiler records `bloomSkippedNoGlow = true` for debug
   visibility.

4. **`perfFreezeProfiler.ts` / `renderProfiler.ts` — new debug stats**
   The Freeze Profiler debug panel now shows per-frame scene-lighting stats:
   - `lit tot=N vis=N shd=N segs=N` — total lights, viewport-visible lights,
     shadow-casting lights, and total occluder segments processed.
   - `bloom skip(no glow)` — when bloom composite was skipped this frame.
   These are visible only in `DEV` builds via the existing Freeze debug panel.

### Remaining Optimizations (Future Passes)

#### Background image decode-aware preloading (Priority 3)

`backgroundRenderer.ts` maintains a private `_bgImageCache` (`Map<string,
HTMLImageElement>`) and `_bgLoadStarted` set, with lazy load-on-first-use in
`_getBgImageByUrl()`.  Neither is exported, so callers cannot prime decode.
`backgroundIdToImagePath()` (line 34) is also private.  This means background
images may not be GPU-decoded when a room is first entered, causing a one-frame
grey flash.

Recommended changes — three small files, no existing tests broken:

1. **`backgroundRenderer.ts`** — export a `preloadBackgroundImageDecoded(id:
   BackgroundId): void` function that resolves the image URL via the existing
   `backgroundIdToImagePath()` helper and calls `decodeImg(url)` from
   `imageCache.ts`.  Returns immediately (fire-and-forget) for procedural
   backgrounds (`null` URL).  This is the only change to this file.

2. **`roomAssetPreloader.ts`** — add `decodeRoomBackground(room: RoomDef):
   void` (no return value, fire-and-forget).  Calls
   `preloadBackgroundImageDecoded(room.backgroundId ?? 'brownRock')`.  Export
   alongside the existing `decodeRoomThemeSprites`.

3. **`roomPreloadScheduler.ts`** (line 466) — in the radius-1 loop where
   `void decodeRoomThemeSprites(r)` is already called, also call
   `decodeRoomBackground(r)` so background images for adjacent rooms are
   GPU-rasterized alongside sprites.

4. **`gameScreen.ts`** — in Phase F (where `void decodeRoomThemeSprites(room)`
   is already called for the current room) also call `decodeRoomBackground(room)`.

All four calls are fire-and-forget; no await, no blocking.

#### Static/slow procedural background caching (Priority 4)

`gameRenderBackgroundPass.ts` calls `renderWorldBackground()` and three
procedural effect renderers every frame.  `renderWorldBackground()` is already
cheap (single `drawImage` tile-repeat when the image is loaded).  The
procedural effects are the expensive path:
- `renderTheroBackgroundEffect()` — calls `effect.update(nowMs)` and
  `effect.draw(ctx)` every frame for `thero_ch1` through `thero_ch6`.
- `renderTheroShowcaseEffect()` — same for specific showcase room IDs.
- `renderCrystallineCracksBackground()` — `SubstrateEffect.update(nowMs)`
  + `draw(ctx)` every frame for `crystallineCracks`.

These effects are slow-moving (particle/fluid simulations).  Caching approach:

1. **`gameRenderBackgroundPass.ts`** — add an offscreen `OffscreenCanvas`
   (or `HTMLCanvasElement`) keyed on `(backgroundId, virtualWidthPx,
   virtualHeightPx)`.  On each frame, render the effect to the offscreen
   canvas only every `BG_CACHE_UPDATE_INTERVAL = 4` frames (configurable),
   then `drawImage` the cached canvas to the main context.
   Invalidate (force full redraw) when `virtualWidthPx` or `virtualHeightPx`
   changes or when the room's `backgroundId` changes.

2. **`renderProfiler.ts`** — add a `STAGE_BACKGROUND_PROC` stage so the
   profiler can report time spent on procedural effects separately from the
   static image drawImage.  `gameRenderBackgroundPass.ts` wraps the effect
   calls between `stageBegin` / `stageEnd`.

The update interval of 4 is a good starting point; consider exposing it in
the pause-menu Debug panel alongside `spriteBakeMaxPerFrame` for tuning.

#### Liquid rendering micro-optimizations (Priority 5)

**Wave step cap** (`liquidRenderer.ts` lines 350 and 384):
Both `drawWaveLine()` and `drawWavePath()` compute
`const steps = Math.max(2, Math.floor(rw / 2))`, where `rw` is the run width
in screen pixels.  At 2× zoom a 20-tile run produces ~300 steps — far more
than visible.  Add at the top of the file:
```
const MAX_WAVE_STEPS = 64; // quality-tier override possible
```
Then change both step computations to
`Math.min(MAX_WAVE_STEPS, Math.max(2, Math.floor(rw / 2)))`.
For quality tiers, expose `setMaxWaveSteps(n)` and call it from
`gameRenderQuality.ts` (low=32, med=64, high=128).

**Bubble spawn allocation** (`liquidBodyCache.ts` line 190):
`tickLiquidBubbles()` calls `Array.from(bottomByColumn.keys())` inside the
inner spawn loop — one transient array per body per spawn tick.  Replace with
a pre-built `_columnKeys: number[]` member on `LiquidBody`, populated when
the body is constructed (in `buildLiquidBody()`) and updated whenever the body
is reshaped.  The spawn loop then iterates `body._columnKeys` directly.

**Pre-computed visible surface runs** (`liquidBodyCache.ts`):
Add a `surfaceRuns: Array<{ xWorld: number; wWorld: number; yWorld: number }>`
field to `LiquidBody`, built from `topByColumn` at construction time.  The
renderer (`liquidRenderer.ts`) currently reconstructs surface run extents by
scanning columns each frame.  With pre-built runs the renderer iterates a flat
array and performs only viewport-cull + draw.  Invalidate runs whenever
`buildLiquidBodies()` is called (room tile change).

#### Static hazard chunk caching (Priority 6)

`hazards.ts` `renderHazards()` issues per-frame `fillRect` / `strokeRect`
calls for every hazard instance even when nothing has changed.  Static hazards
(breakable block faces, crumble block faces, spike triangles, dust-boost jar
bodies, firefly jar bodies) are geometric shapes that never move and rarely
change state.

Caching approach — two-pass split within `renderHazards()`:

1. **Static layer offscreen canvas** — allocate one `OffscreenCanvas` sized
   to the virtual viewport on first use.  Render these elements onto it:
   - Breakable block fills and outlines (active only,
     `world.isBreakableBlockActiveFlag[i]`)
   - Crumble block fills, outlines, and crack overlay
     (`world.crumbleBlockHitsRemaining[i]`)
   - Spike triangles (direction + position fully static)
   - Dust-boost jar body rects and neck/rim rects (position static; glow
     is animated and lives in the live pass)
   - Firefly jar body rects (position static; glow + fireflies are live)

   Cache key: `(roomId, virtualWidthPx, virtualHeightPx)` — reset whenever
   the room changes or resolution changes.  Dirty-flag the cache on any
   breakable/crumble block state change (use the existing
   `world.breakableBlockCount` + `isBreakableBlockActiveFlag` change events).

2. **Animated live pass** — keep drawing every frame:
   - Bounce pad animated glow/pulse
   - Kinetic block pulsing blue stroke
   - Dust-boost jar glow fill
   - Firefly jar glow fill
   - Firefly positions and glow

3. **Integration** — `renderHazards()` calls `drawImage(staticCanvas, 0, 0)`
   then runs the live pass.  A helper `_markHazardCacheDirty()` is called
   by the existing room-change and hazard-break paths.

#### Render-system early exits (Priority 8)

`gameRender.ts` currently calls `renderHazards()` unconditionally (line 453).
The existing early-exit pattern is demonstrated by the falling-block guard at
line 505 (`if (world.fallingBlockGroups.length > 0)`).
`renderSceneLightingPass` already has its own guard (`if (!sceneLights ||
sceneLights.length === 0) return` in `gameRenderSceneLighting.ts` line 20).
Apply the same pattern to the remaining hot paths:

1. **`gameRender.ts` — hazard guard**
   Wrap `renderHazards(...)` with a combined early-exit:
   ```
   if (world.spikeCount > 0 || world.waterZoneCount > 0 ||
       world.lavaZoneCount > 0 || world.breakableBlockCount > 0 ||
       world.crumbleBlockCount > 0 || world.bouncePadCount > 0 ||
       world.kineticBlockCount > 0 || world.dustBoostJarCount > 0 ||
       world.fireflyJarCount > 0 || world.fireflyCount > 0) {
     renderHazards(...);
   }
   ```
   All count fields are already on `WorldHazardState` in
   `src/sim/worldHazardState.ts` (lines 129–588).

2. **`liquidRenderer.ts` — water/lava guards**
   `renderWaterZones()` (line 66) and `renderLavaZones()` (line 127) iterate
   even when their counts are zero.  Add `if (world.waterZoneCount === 0)
   return;` and `if (world.lavaZoneCount === 0) return;` at the top of each
   function.

3. **`liquidBodyCache.ts` — liquid body early exit**
   `tickLiquidBubbles()` (line 131) iterates `_bodies` every tick.  Add
   `if (_bodies.length === 0) return;` at the top.

4. **`gameRender.ts` — liquid renderer guard**
   `getLiquidBodies()` is only called inside the profiler stats block (debug
   only), but `renderWaterZones`/`renderLavaZones` are called through
   `renderHazards`.  The hazard guard above covers this case implicitly when
   both `waterZoneCount === 0` and `lavaZoneCount === 0`.

5. **Quality-tier review** — audit `atmosphericLightDust.render()` and
   `environmentalDust.render()` to confirm they already skip when their
   particle counts are zero; if not, add an early-exit in each.

#### Room render manifest (Priority 10)

Phase D of room loading calls `buildRoomWallTemplate()` in
`preparedRoomRuntime.ts` (line 60), which is an O(n²) wall-merge pass.  For
published rooms this data is static and could be pre-computed at editor export
time.

Recommended architecture — new file `src/levels/roomRenderManifest.ts`:

```typescript
export interface RoomRenderManifest {
  /** Merged wall template — skips buildRoomWallTemplate() in Phase D. */
  wallTemplate?: SerializedWallTemplate;
  /** Theme sprite URLs for up-front decode preloading. */
  themeSpriteUrls?: readonly string[];
  /** Background image URL (null for procedural). */
  backgroundImageUrl?: string | null;
  /** Per-chunk static occupancy bitmasks for initial chunk warmup hints. */
  chunkOccupancy?: Uint8Array;
  /** Pre-built occluder segments keyed by chunk index. */
  occluderChunks?: Float32Array;
  /** Recommended entry-area chunk indices to prewarm first. */
  entryChunks?: readonly number[];
}
```

**Editor/exporter changes** (`src/editor/editorExport.ts`):
- After finalizing a room, compute `RoomRenderManifest` by running
  `buildRoomWallTemplate()`, collecting theme sprite URLs from
  `getRoomThemeSpriteUrls()` (from `roomAssetPreloader.ts`), and resolving
  `backgroundIdToImagePath()`.
- Embed the serialized manifest in the exported room JSON under
  `"renderManifest"`.

**Loader changes** (`src/levels/roomJsonLoader.ts` /
`src/levels/roomSchemaHydrator.ts`):
- Parse `renderManifest` if present; store on `RoomDef` as
  `renderManifest?: RoomRenderManifest`.

**Runtime changes** (`src/screens/preparedRoomRuntime.ts`):
- In `buildPreparedRoomRuntime()`, check `room.renderManifest?.wallTemplate`.
  If present, deserialize instead of calling `buildRoomWallTemplate()`.
  This eliminates Phase D cost entirely for rooms exported with a manifest.

**Preload changes** (`src/screens/roomPreloadScheduler.ts`):
- If `room.renderManifest?.themeSpriteUrls` is populated, iterate and call
  `decodeImg(url)` directly rather than (or in addition to) the existing
  `decodeRoomThemeSprites()` call.
- If `room.renderManifest?.backgroundImageUrl` is set, call `decodeImg(url)`.

This is a multi-file feature that touches the editor, exporter, loader,
hydrator, and runtime — defer to a dedicated manifest pass after the simpler
Priority 3–8 items are landed.

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

✅ **Completed items:**

1. **Hit-flash visual on the Architect core** — `dustWeaverArchitectHitFlashTicks`
   is now set in `forces.ts` when the Architect takes particle damage, and the
   renderer uses it to draw a bright expanding glow ring over the core for
   `DWA_HIT_FLASH_TICKS` (8) ticks, decaying smoothly.

2. **Dust Nail secondary attack** — Fires one Dust Nail toward the player after
   the player stays outside `DWA_NAIL_MIN_RANGE_WORLD` for
   `DWA_NAIL_RANGE_PRESSURE_TICKS` ticks (2 s), then resets with a
   `DWA_NAIL_COOLDOWN_TICKS` (3 s) cooldown. Nails use flat typed arrays in
   `worldHazardState.ts` and are rendered as a small glow + 2×2 pixel dot.
   Construction pressure remains the primary identity.

3. **Large-variant patterns** — `DWA_PATTERNS` now has 11 entries (0–4 normal,
   5–10 large). `DWA_LARGE_PATTERN_INDICES` weights indices 5–10 heavily while
   keeping 0–4 for variety; normal Architects draw only from indices 0–4.
   All large patterns leave an escape gap and respect safety rules.

4. **Wall-jump behavior near Architect Blocks** — Confirmed: wall-jump only
   scans `world.wallCount` (real tiles). Architect Blocks are intentionally
   excluded. Documented with a comment in `playerWallJump.ts`.

5. **Per-Architect block-count cap enforcement** — Added an explicit
   `_ownedBlockCount()` pre-check in `DWA_STATE_IDLE` before transitioning to
   Telegraph. If the Architect is already at `DWA_MAX_BLOCKS_PER_ARCHITECT`,
   it skips the build cycle and retries after a short delay. The global
   `MAX_ARCHITECT_BLOCKS` remains as a safety fallback.

**Remaining limitations / tuning values worth revisiting:**

- `DWA_NAIL_MIN_RANGE_WORLD = 80` (10 small blocks) — may need adjustment
  per room size. Larger rooms may warrant a higher threshold.
- `DWA_NAIL_SPEED_WORLD = 1.6` world-units/tick — currently dodge-able;
  increase if playtesting shows nails are too easy to ignore.
- `DWA_NAIL_RANGE_PRESSURE_TICKS = 120` (~2 s at 60 fps) — increase to 180
  if nails fire too frequently in small rooms.
- Multiple simultaneous Architects share the `MAX_ARCHITECT_BLOCKS` pool
  (cap = 40). If 4+ Architects are active, the global cap may be reached
  before individual caps; consider reducing `DWA_MAX_BLOCKS_PER_ARCHITECT`
  or raising `MAX_ARCHITECT_BLOCKS` in that scenario.

---

## Verification Checklist

- [ ] `npm run build` passes
- [ ] Enter large adjacent rooms repeatedly in all four directions
- [ ] Test with worker available
- [ ] Test with worker unavailable if feasible
- [ ] Check Freeze debug panel — no unexpected `preload` spikes during gameplay
- [ ] Cache-hit transitions remain instant
- [ ] Cache-miss transitions use the async loading overlay
- [ ] Scene lights render correctly in rooms with `sceneLights`
- [ ] Shadow-casting lights still cast shadows correctly
- [ ] Freeze panel shows `lit` row with correct counts when scene lights are present
- [ ] Freeze panel shows `bloom skip(no glow)` when no glow is submitted
- [ ] No stale occluder rebuild every frame (verify via profiler — `lit segs` stays constant across frames when walls don't change)
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

