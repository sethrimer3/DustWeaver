# DustWeaver — Next Steps

## Current Documentation Status

This file is a prioritized planning document, not a raw changelog dump. Historical build notes are retained only where they still provide useful debugging context.

Current focus: large-room loading and rendering performance, especially room-transition smoothness, chunk prewarming, memory safety, and avoiding cold-entry pop-in.

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

### 1. Fix no-blocker rooms in the render prewarm queue

`RoomRuntimeCache` documents `blockerKeys` as:

- `null` = not yet computed
- `undefined` = computed, and this room has no blockers
- `Set` = computed and populated

The prewarmer must treat `undefined` as ready. Only `null` should defer wall prewarming. If this is not fixed, rooms without ambient blockers can fail to prewarm wall chunks and may block later tasks in the queue.

Required checks:

- In `roomRenderChunkWarmScheduler.ts`, accept `entry.blockerKeys === undefined` as a valid ready state.
- Use the existing `_makeWallPrewarmCtx` fallback to convert `undefined` to an empty `Set`.
- Ensure `wallDone` is set correctly for rooms with no walls, no chunks to build, or no blockers.
- Add debug stats for deferred/skipped prewarm reasons if practical.

### 2. Add real global/LRU eviction for prewarmed chunks

`evictStalePrewarmedChunks(keepRoomIds)` currently exists conceptually but must actually enforce a global prewarm memory budget.

Recommended behavior:

- Track per-room prewarm metadata: roomId, radius, lastTouched time/frame, wall memory KB, background memory KB.
- Add APIs to enumerate and evict prewarmed room caches from `blockSpriteRenderer.ts` and `backgroundBlockRenderer.ts`.
- Use quality-tier memory budgets, for example:
  - low: 4096 KB
  - medium: 12288 KB
  - high: 32768 KB
- Evict radius-3 rooms first, then radius-2, then older radius-1 rooms.
- Never evict active room chunks.
- Prefer keeping recently visited or recently scheduled rooms.
- Run eviction after schedule creation, after adoption, and whenever prewarm memory exceeds budget.

### 3. Unify background image decode/preload with actual rendering

`backgroundRenderer.ts` has `preloadBackgroundImageDecoded(id)`, and `roomAssetPreloader.ts` has `decodeRoomBackground(room)`. However, the renderer should draw the same shared cached image that was decoded.

Required change:

- Refactor `renderWorldBackground()` to use the shared `imageCache.ts` image object path as much as possible.
- Avoid duplicate `HTMLImageElement` instances for the same background URL.
- Preserve fallback colors while the image is not ready.
- Preserve procedural backgrounds such as `crystallineCracks` and Thero backgrounds.
- Keep all background preloading fire-and-forget.
- Add optional debug stats for background cache hit/miss, decode-ready state, or fallback draw.

### 4. Add per-chunk buckets for background blocks

Foreground walls already use a cached layout with per-chunk buckets. Background blocks are chunk-cached, but their chunk build path can still scan all background block definitions and AABB-cull each block for every rebuilt chunk.

Recommended new file:

```typescript
src/render/walls/backgroundBlockLayoutCache.ts
```

Suggested shape:

```typescript
interface BackgroundBlockCell {
  col: number;
  row: number;
  themeId: string | null;
}

interface CachedBackgroundBlockLayout {
  signature: string;
  cellsByChunkKey: Map<string, BackgroundBlockCell[]>;
  roomId: string;
  blockTheme: string | null;
}
```

Goals:

- Build the per-cell background-block draw list once per room/layout/theme signature.
- Bucket cells by chunk key.
- During chunk rebuild, draw only `cellsByChunkKey.get(chunkKey)`.
- Preserve per-block theme overrides, folder-based sprites, fallback fill, alpha behavior, prewarming, and adoption.
- Share the same build logic between live rendering and prewarming.

### 5. Runtime cache capacity check

`RoomRuntimeCache` defaults to 16 entries, but any explicit `new RoomRuntimeCache(10)` call should be changed to a named constant with value 16 unless there is a specific reason not to.

Suggested:

```typescript
const ROOM_RUNTIME_CACHE_CAPACITY = 16;
const roomRuntimeCache = new RoomRuntimeCache(ROOM_RUNTIME_CACHE_CAPACITY);
```

---

## Still Intentionally Deferred

These are still valid future refactors and should not be treated as accidental omissions.

1. **Base-chunk / lighting-overlay architectural split**
   `setActiveBlockLighting` and `setActiveBlockSpriteTheme` can invalidate baked wall chunks. Separating base wall tiles from lighting/seam overlay chunks would let lighting-only changes rebuild only a lighter overlay layer. This requires splitting the current chunk build path into base and overlay passes, so it should be done as a dedicated renderer refactor.

2. **Legacy/world-number sprite decode tracking**
   Decode-aware room preloading currently focuses on folder-based block themes. Legacy world-number sprites such as brownRock, dirt, and world 0-9 block sets still start loading at module init time and are not tracked through the same decode-ready set. This is lower priority unless legacy rooms still show visible sprite pop-in.

3. **`proceduralBlockSprite.ts` shared image-cache unification**
   `proceduralBlockSprite.ts` still maintains its own `_imgCache` and `_loadImg` path. Unifying it with `render/imageCache.ts` would avoid duplicate image objects and improve readiness/decode reporting for procedural sprites.

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
