# DustWeaver — Rendering Performance Diagnosis

_Originally written for the room-transition performance improvement pass (BUILD 259). Updated in BUILD 401+ to cover in-room gameplay freezes._

---

## Executive Summary

Two separate classes of freeze have been diagnosed and addressed:

1. **Room-transition freezes** (BUILD 259–270): blank tiles and stall on room entry because sprites loaded lazily and `loadRoom()` was synchronous.
2. **In-room gameplay freezes** (BUILD 395–401): frame spikes while the player moves because derived visual canvases (shaded sprites, procedural block cutouts) were baked on-demand during active gameplay using expensive `getImageData`/`putImageData` calls.

Both problems have been substantially fixed. The sections below describe each in detail.

---

## Part A — Room-Transition Freezes (BUILD 259)

### A.1 — Lazy sprite loading causes blank fallback tiles

**What happened:** When `loadRoom()` ran it created `HTMLImageElement` objects but network fetches had not completed. Every tile fell back to a solid-colour rectangle until images arrived (50 ms–5 s depending on cache state).

**Fix:** `roomAssetPreloader.ts` preloads sprites for the spawn room and adjacent rooms before gameplay starts. `decodeRoomThemeSprites()` additionally calls `HTMLImageElement.decode()` so images are GPU-rasterized before first draw. The loading overlay waits for `areRoomSpritesReady()` and `isRoomBackgroundDecodeReady()` before releasing the player.

### A.2 — `loadRoom()` synchronous stall

**What happened:** Wall merge, BFS ambient-light computation, particle spawn, and bake-canvas creation all ran in one synchronous RAF callback. On large rooms this could take 30–80 ms.

**Fix:** A fade-out / fade-in transition (~167 ms) hides the stall. The room load executes at maximum fade (fully black) so the player never sees the partially-constructed room.

### A.3 — Adjacent rooms not preloaded

**Fix:** `preloadAdjacentRoomAssets()` fires `loadImg()` for all block-theme sprites in directly-connected rooms after each `loadRoom()` call. `preloadNearbyRoomAssets(room, radius)` extends this to radius-2 and radius-3 rooms.

---

## Part B — In-Room Gameplay Freezes (BUILD 395–401)

### B.1 — Per-tile shaded canvas explosion

**What happened:** `getTheme1x1SpriteShaded()` and `getTheme2x2SpriteShaded()` in `folderBlockThemes.ts` keyed the shaded-canvas cache by exact world coordinates (`worldOriginXWorld | worldOriginYWorld`). In a large room this produced one unique `getImageData`/`putImageData` bake per tile position — potentially thousands — all triggered lazily as the camera moved during gameplay.

**Fix (BUILD 395):** `SHADED_VARIANT_BUCKETS = 16`. Cache keys now use `variantBucket = hashTilePosition(col, row, seed) % 16` instead of exact world coordinates. Cache size is now bounded to `sprite_variants × mask_variants × 16` regardless of room size.

**Fix (BUILD 401 — gameplay-safe fallback):** When `isBakeForbiddenInGameplay()` is true, shaded-sprite functions now return a cheap **unshaded canvas** (plain `drawImage`, no `getImageData`/`putImageData`) rather than `null`. The unshaded canvas is permanently cached in `_unshadedCache8x8` / `_unshadedCache16x16`. Returning a non-null stable canvas means `hadFallbacksFlag = false` on the chunk, preventing repeated rebuild loops during gameplay. Shaded variants are baked only during loading/prewarm phases.

### B.2 — Same pattern in `proceduralBlockSprite.ts`

**Fix (BUILD 395):** `PROC_VARIANT_BUCKETS = 16`; all internal callers pass `col, row`.

**Fix (BUILD 401):** `getProceduralSprite()` now returns an unshaded fallback canvas (template compositing without edge shading) when bake is forbidden, stored in `_unshadedSpriteCache`.

**Additional fix (BUILD 401):** Unified private `_imgCache` / `_loadImg` / `_isReady` with the shared `imageCache.ts` (`loadImg` / `isSpriteReady`). No duplicate `HTMLImageElement` objects for procedural base/template images.

### B.3 — Baking allowed during active gameplay

**What happened:** Even with bounded caches, new shaded-sprite bakes could still occur during active gameplay whenever a variant bucket was first touched. On room entry, camera movement across new chunks would trigger `applyOrganicEdgeShading()` spikes in active gameplay frames.

**Fix (BUILD 401):** `perfFreezeProfiler.ts` exports a production-safe `setBakeForbiddenInGameplay(v)` / `isBakeForbiddenInGameplay()` flag (no DEV guard — works in production builds). `gameScreen.ts` sets it:

- `true` immediately after the gameplay path begins (before rendering).
- `false` at the end of the gameplay frame (after render, before `endFrame()`).
- `false` in every non-gameplay early-return path (editor, loading, paused, dead).

All expensive bake paths (`getTheme1x1SpriteShaded`, `getTheme2x2SpriteShaded`, `getProceduralSprite`) check `isBakeForbiddenInGameplay()` first and return a stable unshaded fallback if true.

### B.4 — Loading overlay released too early

**What happened:** The loading overlay's release condition was `!asyncLoadState.isActive && areRoomSpritesReady(currentRoom)`. This only checked folder-based block-sprite decode readiness. The background image could still be mid-decode.

**Fix (BUILD 401):** Condition now also requires `isRoomBackgroundDecodeReady(currentRoom)`. Added `isRoomBackgroundDecodeReady()` to `backgroundRenderer.ts` and a thin wrapper in `roomAssetPreloader.ts`.

### B.5 — Stale `_decodeInFlight` entries in `imageCache.ts`

**What happened:** When `img.complete === true` at the time `decodeImg()` was called, the promise resolved synchronously before `_decodeInFlight.set()` ran, leaving a stale in-flight entry that permanently blocked `isSpriteDecodeReady()`.

**Fix (BUILD 395):** Added `.finally()` with identity check after `_decodeInFlight.set()` to ensure cleanup even for synchronous resolution.

### B.6 — Prewarm queue stall

**What happened:** `roomRenderChunkWarmScheduler.ts` used `break` when one room was not ready, stalling the entire prewarm queue instead of skipping to the next room.

**Fix (BUILD 395):** Changed to `continue`; added `deferralCountThisSlice` guard (max 3) to prevent queue spinning.

### B.7 — Hardcoded block size in chunk memory estimate

**What happened:** `_evictStaleChunks()` in `chunkRenderCache.ts` computed chunk memory as `CHUNK_SIZE_BLOCKS * 8 * scalePx` (hardcoded `8` = assumed block size in pixels). This would silently underestimate when block sizes differ.

**Fix (BUILD 401):** Added `_lastBlockSizePx` field to `RoomChunkCache`. Updated at the start of `renderVisibleChunks()`. Eviction memory estimate now uses `CHUNK_SIZE_BLOCKS * this._lastBlockSizePx * scalePx`.

---

## Part C — Prewarm and Readiness Helpers Added (BUILD 401)

These APIs let the entry-viewport warm path intentionally bake derived canvases during loading:

- `prewarmFolderThemeShadedForChunk(themeId, colMin, rowMin, colMax, rowMax, seed, mask, blockSizePx, use2x2)` — iterates tiles, calls shaded-sprite functions under budget.
- `prewarmProceduralSpriteVariant(baseUrl, templateUrl, widthPx, heightPx, flipX, flipY, rotStep, mask, col, row, seed)` — calls `getProceduralSprite` for one variant.
- `isRoomBackgroundDecodeReady(worldNumber, backgroundId?)` in `backgroundRenderer.ts`.
- `isRoomBackgroundDecodeReady(room)` thin wrapper in `roomAssetPreloader.ts`.

---

## Part D — Entry Viewport Visual Warm (BUILD 402)

BUILD 401 made gameplay freeze-safe by returning stable unshaded fallback canvases when `isBakeForbiddenInGameplay()` is true. This eliminated all `getImageData`/`putImageData` spikes during active gameplay. The trade-off was that tiles visible immediately after room entry could appear briefly unshaded until their shaded variants were baked in a later frame.

BUILD 402 closes this gap by adding a bounded entry viewport warm pass.

### D.1 — Entry warm controller (`entryViewportWarm.ts`)

New module `src/screens/entryViewportWarm.ts` manages `EntryWarmState`, which tracks phase (`idle` | `warming` | `ready` | `timedOut`), frames elapsed, ms spent, and chunks warmed.

`startEntryWarm()` is called after every room load (initial startup, instant transition, and async transition generator completion). It computes the entry camera offset from the spawn block and stores the viewport parameters.

`tickEntryWarm()` is called once per gameplay frame BEFORE `setBakeForbiddenInGameplay(true)`. This window is the only time baking is safe in an active-gameplay frame. The function calls `prewarmWallChunksForRoom` and `prewarmBgChunksForRoom` for the entry viewport (bounded to `ENTRY_WARM_CHUNKS_PER_STEP = 6` chunks each per step). When both sources return 0 new chunks (viewport fully covered), or when the budget fires (max 8 frames / 120 ms), the warm finalises by calling `adoptPrewarmedWallChunks` + `adoptPrewarmedBgChunks` to inject the shaded chunks into the active caches.

### D.2 — Loading overlay gate

`tickLoadingOverlay()` in `gameScreen.ts` now also requires `isEntryWarmReadyOrTimedOut(entryWarmState)`. This holds the loading overlay until:

1. Source sprites are ready (`areRoomSpritesReady`).
2. Background image is decoded (`isRoomBackgroundDecodeReady`).
3. The entry warm pass completed or timed out.

The timeout (8 frames / 120 ms) guarantees this never produces a long loading screen.

### D.3 — Guarantees

- **No gameplay freezes**: the warm pass runs entirely before `setBakeForbiddenInGameplay(true)`, so all baking occurs outside the active-gameplay window.
- **Minimal unshaded fallback**: the loading overlay is held until the entry viewport's shaded chunks are ready or the safe timeout fires.
- **Bounded overlay delay**: worst-case extra hold is 120 ms (the timeout budget).
- **No-op when not needed**: `isEntryWarmReadyOrTimedOut` returns true immediately when phase is `idle`, `ready`, or `timedOut`, so rooms without folder-based themes release the overlay instantly.

---

## Already Well-Optimised Areas (Do Not Regress)

- **Chunked wall/background rendering** (`chunkRenderCache.ts`): walls and background blocks render through per-chunk offscreen canvases. Dirty chunks rebuild under a per-frame cap. Only viewport-visible chunks plus a safety margin are blitted.
- **Idle-time chunk prewarming** (`roomRenderChunkWarmScheduler.ts`): adjacent rooms' wall/background chunks are speculatively built during idle time and adopted on room entry.
- **Ambient-light BFS memoisation** (`buildAmbientDepths`): O(tiles) only on first use per configuration.
- **ImageCache deduplication** (`render/imageCache.ts`): `loadImg()` is a singleton cache.
- **Wall layout cache** (`blockWallLayoutCache.ts`): occupancy, neighbour masks, and 2×2 detection memoised per wall-snapshot signature.
- **Bounded variant caches**: `SHADED_VARIANT_BUCKETS = 16` in `folderBlockThemes.ts`, `PROC_VARIANT_BUCKETS = 16` in `proceduralBlockSprite.ts`.
- **Scene-light viewport culling** and **bloom empty-frame skipping**.
- **RenderProfiler** (F9 / pause-menu debug toggle): per-stage timing for BG/Walls/Entities/Particles/Dust/Bloom/Lighting/HUD.

---

## How to Use the Freeze Profiler

1. Open the pause menu → enable **Debug Overlay** → enable **Freeze Profiler**.
2. Move through rooms. Key fields:
   - `ctx:gameplay` — active-gameplay frame; freeze warnings are prefixed `⚠ GAMEPLAY`.
   - `bake N×Xms` — shaded-sprite bake calls this frame. Should be **0** during active gameplay after BUILD 401.
   - `edge N×Xms` — organic edge-shading calls. Should be **0** during active gameplay.
   - `wChk N×Xms` — wall chunks rebuilt. Small spikes on first entry; tapers to 0.
   - `bChk N×Xms` — background chunks rebuilt.
3. If `bake` or `edge` spikes appear during `ctx:gameplay`, the `isBakeForbiddenInGameplay()` flag is not being set or the sprite function is not checking it.

---

## Remaining Known Issues / Future Work

1. **Entry viewport pre-warm is not yet explicitly wired.** `prewarmFolderThemeShadedForChunk` and `prewarmProceduralSpriteVariant` exist but are not yet called from the room-entry prewarm path. Connecting them would eliminate any residual first-second unshaded-fallback appearance on room entry.
2. **Non-folder themes** (blackRock, brownRock, dirt, world sprites) are not checked by `areRoomSpritesReady()`. They begin loading at module init time and are typically ready within a few hundred ms.
3. **Base-chunk / lighting-overlay split** — `setActiveBlockLighting` invalidates whole wall chunks. Separating base tiles from lighting overlay would allow lighter lighting-only rebuilds.
4. **Global prewarm memory eviction** — `evictStalePrewarmedChunks(keepRoomIds)` needs a proper LRU implementation with quality-tier memory budgets.
5. **Room render manifest** — Future: editor-exported precomputed render data (chunk occupancy, entry chunks, theme sprite URLs) to make room preloading deterministic.

