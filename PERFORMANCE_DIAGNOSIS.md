# DustWeaver — Room Transition & Rendering Performance Diagnosis

_Written as part of the room-transition performance improvement pass (BUILD 259)._

---

## Executive Summary

Room transitions can appear to freeze for 1–5 seconds because:
1. Block-sprite images start loading lazily the moment a room is first entered, but rendering
   proceeds immediately with solid-colour fallback tiles until images arrive.
2. `loadRoom()` executes entirely in one synchronous frame — particle spawning, wall merging,
   ambient-light BFS, and bake-canvas creation all run back-to-back with no budget control.
3. Nothing preloads adjacent rooms in the background, so every transition is cold.

The rendering pipeline itself is already well-optimised in several areas (bake cache,
ambient-depth memoisation, imageCache deduplication), but lacked any preloading or graceful
transition UX.

---

## Bottleneck 1 — Lazy sprite loading causes blank fallback tiles

**What happens:** When `loadRoom()` is called it calls `setActiveBlockSpriteTheme()` /
`setActiveBlockSpriteWorld()`, which invalidates `_bakedWallCanvas` in
`blockSpriteRenderer.ts`.  The next frame tries to bake a new canvas.  At that point the
sprite `HTMLImageElement` objects exist (they were created by `loadImg()`) but their `onload`
has not fired — `img.complete === false`.  Every tile falls back to a solid-colour rectangle.
Once images finish loading the bake redraws with sprites.  On a warm browser cache this takes
~50–200 ms; on first load it can take several seconds.

**Where:** `src/render/walls/blockSpriteRenderer.ts` — `_doRenderWallTilesDirect()`,
`_getOrCreate8x8()` in `folderBlockThemes.ts`, `getBlockSprite1x1/2x2` in
`proceduralBlockSprite.ts`.

**Fix applied:** `roomAssetPreloader.ts` now calls `loadImg()` on all sprite URLs for the
spawn room and adjacent rooms **before** gameplay starts.  This starts network fetches early
enough that sprites are typically ready by the time the player triggers the first transition.

---

## Bottleneck 2 — `loadRoom()` is fully synchronous and stalls one frame

**What happens:** Every room transition calls `loadRoom()` within the same RAF callback.
The work includes:
- Spawning hundreds of particles (player + enemies + background fluid + grapple chain).
- Merging up to 128 wall rectangles through the iterative AABB merge pass.
- Building the ambient-light BFS depth map (potentially O(width × height) BFS).
- Constructing the bake canvas for the wall layer.
- Re-computing the occupancy grid for the wall layout cache.
- Re-initialising rope physics, crumble blocks, falling blocks, grasshoppers, dialogue, etc.

On a large room at 60 fps the budget per frame is ~16 ms.  `loadRoom()` on a complex room can
take 30–80 ms, causing a visible freeze.

**Where:** `src/screens/gameScreen.ts` — `loadRoom()` function, called from both the
transition callback and the initial load path.

**Fix applied:** A **fade-out / fade-in transition** (black overlay fading over ~167 ms)
hides the loading frame.  The room load executes at maximum fade (fully black), so the player
never sees the partially-constructed room.  This doesn't remove the work, but it removes the
visible stall — the transition feels intentional rather than broken.

**Remaining work:** Spreading particle spawning and wall processing across multiple frames
(using a generator or idle callbacks) would truly eliminate the stall for very large rooms.
This is higher-risk and is deferred as follow-up work.

---

## Bottleneck 3 — Adjacent rooms are not preloaded

**What happens:** When the player crosses a door into room B, room B's sprites begin loading
from scratch.  At 60 fps the player sees 0.5–3 s of fallback tiles while they walk around.

**Where:** No preloading logic existed prior to BUILD 259.

**Fix applied:** After every `loadRoom()` call, `preloadAdjacentRoomAssets(currentRoom)` fires
`loadImg()` for each unique block-theme sprite URL found in directly-connected rooms.  This is
O(rooms × sprites-per-theme) one-time work, all async, with no frame-budget impact after the
first room load.

---

## Bottleneck 4 — First gameplay entry: no loading screen, instant freeze possible

**What happens:** When `startGameScreen()` is called, `loadRoom()` runs immediately, then the
RAF loop starts.  If sprites are not cached (first visit or cleared browser cache) the first
second of gameplay shows fallback tiles and may stutter while images decode.

**Fix applied:** A DOM loading overlay ("Loading…") is shown immediately when gameplay starts.
It is polled each frame (≤100 ms interval) and removed once `areRoomSpritesReady(currentRoom)`
returns true (all folder-theme sprites for the spawn room are loaded).  The player sees a
clean black screen with "Loading…" text instead of a partially-textured world.

---

## Already Well-Optimised Areas (Do Not Regress)

- **Wall bake cache** (`_bakedWallCanvas`): walls are pre-rendered once to an offscreen canvas
  and blitted cheaply every frame.  Invalidated correctly on room/theme/lighting changes.
- **Ambient-light BFS** (`buildAmbientDepths`): memoised per `(roomSize × direction × blockerSet)`.
  Cost is O(tiles) only on the first render of a new configuration, then O(1) lookup.
- **ImageCache** (`render/imageCache.ts`): `loadImg()` is a singleton cache — no URL is ever
  loaded into two separate `HTMLImageElement` objects.
- **Wall layout cache** (`blockWallLayoutCache.ts`): occupancy grid, neighbour masks, and 2×2
  detection are memoised per wall-snapshot signature.
- **RenderProfiler**: per-stage timing overlay in debug mode (F9 / pause-menu debug toggle).
  Shows BG / Walls / Entities / Particles / Dust / Bloom / Lighting / HUD timing.

---

## Remaining Known Issues / Future Work

1. **`loadRoom()` synchronous stall**: for very large rooms (> 6000 tiles) the stall can
   exceed 50 ms even behind the fade.  Chunked/yielding particle spawn or wall-processing
   across multiple idle callbacks would address this.
2. **procblockSprite has its own private image cache**: `proceduralBlockSprite.ts` uses a
   module-level `_imgCache` separate from `render/imageCache.ts`.  These could be unified for
   more accurate readiness reporting.
3. **Non-folder themes (blackRock, brownRock, dirt, world sprites)** are not checked by
   `areRoomSpritesReady()` — the loading overlay uses only folder-based theme readiness.
   Legacy world sprites begin loading at module init time so they are typically ready within a
   few hundred ms anyway.
4. **LRU room cache**: if the campaign grows very large, all room defs stay in memory forever
   (they are plain JSON objects).  This is unlikely to matter in practice (<5 MB total) but
   could be addressed with a bounded cache if needed.
5. **Worker-based room parsing / asset decoding**: for future campaigns with many large rooms,
   decoding images via `createImageBitmap()` in a Worker and uploading the result to an
   `OffscreenCanvas` or `ImageBitmap` would remove image decode time from the main thread.
   This is currently not implemented because the integration risk is non-trivial.

---

## How to Test Locally

1. `npm run build && vite preview` (or `npm run dev`).
2. Open in a browser with **DevTools → Network → throttled to "Slow 3G"** to simulate slow
   asset loading.
3. Start a new campaign:
   - Confirm the "Loading…" overlay appears before the game world is visible.
   - Confirm it disappears once block sprites are ready and the room is fully textured.
4. Walk through a door to an adjacent room:
   - Confirm a brief black fade-out (~167 ms) before the new room appears.
   - Confirm a fade-in (~167 ms) after the new room loads.
   - Confirm block sprites are ready in the new room (no solid-colour fallback tiles) because
     they were preloaded in the background while you played the previous room.
5. Continue through several rooms and verify adjacent-room preloading keeps up.
6. Confirm ramps, platforms, crumble blocks, lighting, save tombs, particles, grapple, and
   editor mode still work correctly.
