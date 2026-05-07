# Next Steps

## BUILD 261 — Explicit Transition Zone Refactor

This document captures what was completed, what is still legacy-compatible but
not yet cleaned up, and what remains for future work.

---

## What Was Completed

1. **Removed depth as an authoring concept** — `depthBlock (blank=edge)` removed
   from the inspector. New authoring fields are `xBlock`, `yBlock`, `widthBlocks`
   (= `openingSizeBlocks`), `gradientWidthBlocks`, and `direction`.

2. **Removed tunnel side walls** — `buildTunnelWalls()` removed from
   `editorRoomBuilder.ts`. Transitions no longer generate corridor walls outside
   the room. `buildBoundaryWalls` now only creates edge gaps for transitions whose
   zone actually touches the room boundary.

3. **New placement logic** — `editorPlaceTool.ts` uses the cursor block as the
   zone's top-left anchor and `placementRotationSteps % 4` for direction:
   0 = right, 1 = down, 2 = left, 3 = up.

4. **Explicit zone geometry and visualization** — `drawTransitionZone` in
   `editorRendererHelpers.ts` draws the zone as a translucent rectangle, a thick
   red trigger edge, and a red hover arrow pointing outward.

5. **Updated inspector** — shows `xBlock`, `yBlock`, `Width (openingSizeBlocks)`,
   `Gradient Width`, `direction`, `targetRoomId`, `targetSpawnX/Y`, `fadeColor`,
   `isSecretDoor`. `depthBlock (blank=edge)` removed.

6. **Updated property change handler** — `editorPropertyChange.ts` handles
   `transition.xBlock` and `transition.yBlock`, keeps legacy `positionBlock` in
   sync, and removes `depthBlock` handling.

7. **Updated hit testing** — `editorHitTest.ts` uses `xBlock`/`yBlock` directly.

8. **Updated drag/copy** — `editorDragCopyPaste.ts` uses `xBlock`/`yBlock` for
   transition drag and keeps `positionBlock` in sync.

9. **Valid link enforcement** — `transitionValidation.ts` provides
   `validateTransitionLink` (width + orientation) and `getOppositeTransitionDirection`.
   Both `transitionLinker.ts` and `completeDoorLink` in `editorVisualMapLinkPrompt.ts`
   validate before mutating state.

10. **Warning popups** — invalid link attempts show a styled warning popup:
    - Visual map: `showLinkWarningPopup` in `editorVisualMapLinkPrompt.ts`
    - In-room / world-map list: `showEditorToast` in `editorController.ts`

11. **Backward-compatible loading** — old rooms with `positionBlock` /
    `depthBlock` are migrated to `xBlock`/`yBlock` at load time in both
    `roomJson.ts` (JSON → EditorRoomData) and `editorRoomBuilder.ts`
    (RoomDef → EditorRoomData).

12. **Updated runtime trigger** — `gameTransitions.ts` uses `xBlock`/`yBlock`
    for zone bounds and a trigger-edge proximity check, removing the old
    `TUNNEL_DETECT_MARGIN_WORLD` dependency and the `depthBlock` interior path.

13. **Visual map door positions** — `drawDoor` and `getDoorCenter` in
    `editorVisualMap.ts` use `xBlock`/`yBlock` for zone-center placement.

---

## Legacy Compatibility Code Still Present

- `EditorTransition.positionBlock` — still a required field, always kept in sync
  with `xBlock`/`yBlock`. Can be removed once all JSON has been resaved with new
  fields. It is marked `@deprecated` in the type.

- `EditorTransition.depthBlock` — still an optional field on the type, kept for
  JSON round-trip compatibility. Not written by new editor placements. Marked
  `@deprecated`.

- `RoomTransitionDef.positionBlock` / `depthBlock` — kept in the runtime type for
  JSON compatibility. New fields `xBlock` and `yBlock` are now primary.

- `RoomJsonTransition.positionBlock` / `depthBlock` — still emitted on save for
  backward compatibility with any old readers.

---

## What Remains for Smooth Room-to-Room Transitions

### Relative player-position preservation
- When the player enters a transition at 25 % along its width, they should exit
  the linked transition at 25 % along the linked transition's width.
- Requires same-width transitions (now enforced by link validation).
- Current implementation always spawns at the center of the opening.
- **To implement:** at trigger time, compute the player's offset along the
  transition opening axis, and use it to compute the exit spawn.

### Momentum / velocity preservation
- Current code does not zero out velocity on transition, but the room-load path
  (via `onLoadRoom` in gameScreen.ts) may reset physics state.
- **To implement:** pass the player's pre-transition velocity vector into
  `onLoadRoom` and apply it to the spawned player cluster after the new room loads.

### Camera interpolation
- Smooth visual transition between rooms (fade or pan).
- **To implement:** add a transition-state machine in gameScreen.ts that fades out
  the old room and fades in the new room while the player position updates.

### Preloading adjacent rooms
- **To implement:** at room load time, resolve all linked transition targets and
  preload (parse + build wall arrays) each adjacent room's RoomDef in the
  background.

### Rendering outgoing/incoming rooms
- Required for pan-based (non-fade) transitions.
- **To implement:** maintain a secondary render buffer for the incoming room and
  draw both rooms offset by their relative positions during the transition.

---

## Known Remaining Issues

- The list-of-rooms world map (`showEditorWorldMap` / `editorWorldMap.ts`) will
  show a warning toast when an invalid link is attempted via the `onLinkTransition`
  callback, but individual transition items in the list are not yet grayed out
  for incompatible width/orientation — that visual hint was not implemented.
  Future work: pass source-transition data into the world-map UI so invalid
  targets can be visually dimmed.

- Secret-door visualization (the gradient fade that starts invisible) was not
  changed. It still uses `positionBlock` internally in the game-room rendering
  (`gameRoom.ts`). If secret-door rendering is explicitly migrated in a future
  session, it should use `xBlock`/`yBlock` from the RoomTransitionDef.

---

# BUILD 262 — Room Transition Visuals, Edge Extension, Preview Bubbles

## What was implemented (BUILD 262)

- **Speed-based transition duration** — Transitions are faster for fast-moving players (grapple/dash → ~70 ms, walking → ~280 ms). See `src/render/transitions/transitionConfig.ts`.
- **Asymmetric fade** — Fade-out is 55% of the total duration; fade-in is 45%, so entering a room feels snappier than leaving.
- **Camera entry offset** — After `loadRoom()`, the camera starts 4 blocks behind the player's spawn direction and lerps naturally to the player. Gives a sense of arriving from a direction.
- **6-block edge extension (visual only)** — `src/render/transitions/edgeExtensionCache.ts` builds a per-room tile list of wall continuations 6 blocks past every edge. `src/render/transitions/edgeExtensionRenderer.ts` draws them as solid-colour rectangles matching the edge wall's theme. No collision impact.
- **Preview glow bubbles** — `src/render/transitions/previewBubbleState.ts` computes per-transition bubble state (size, opacity) based on player proximity. `src/render/transitions/previewBubbleRenderer.ts` renders a radial-gradient glow at each transition opening. Grows and brightens as the player approaches.
- **Debug panel** — `renderProfiler.ts` now shows a transition info panel: current room ID, transition state, last player speed, last duration, active bubble count, edge cache status.

## Remaining work (BUILD 262)

### 1. Sprite-based edge extension tiles

**Status:** Currently solid-colour fill (`_themeSolidColor`).

**Goal:** Match the auto-tiling sprites used inside the room.

**Recommended approach:**
- In `src/render/walls/blockSpriteRenderer.ts`, export a new function `renderWallTilesDirect(ctx, tiles, ox, oy, scale, blockSizePx)` that accepts an array of `{col, row, themeOverride}` descriptors and draws them without the chunk cache.
- Call this from `src/render/transitions/edgeExtensionRenderer.ts` for solid extension tiles.
- The current `_doRenderWallTilesDirect` internal function is the correct building block; it just needs to be made accessible.

### 2. Connected-room tile preview inside the bubble

**Status:** Preview bubbles show a glow but not actual room tiles from the connected room.

**Goal:** The circular reveal area should show tiles from the target room.

**Recommended approach:**
- Add a `RoomPreviewCache` class in `src/render/transitions/roomPreviewCache.ts`.
  - Pre-render the connected room's wall tiles to an `OffscreenCanvas` once per adjacent-room load.
  - Build a temporary `WallSnapshot`-like structure from `ROOM_REGISTRY.get(transition.targetRoomId)?.walls`.
- In `previewBubbleRenderer.ts`, clip to the bubble circle and draw the relevant portion of the pre-rendered canvas, spatially aligned so the transition edge mates correctly with the current room's edge.

### 3. FullyLit empty-extension background

In `FullyLit` mode, the procedural background (`renderWorldBackground`) should extend into the empty extension strips. The simplest approach: extend the room clip rect to `room + 6 blocks` in `FullyLit` mode only and let the background renderer fill it naturally.

### 4. Lighting integration for edge extension tiles

Edge extension tiles should participate in ambient lighting depth. Compute a synthetic depth from the extension step and apply the same tint formula used by `_doRenderWallTilesDirect`. Modify `src/render/transitions/edgeExtensionRenderer.ts`.

### 5. Preview bubble in DarkRoom lighting

In DarkRoom mode, pass bubble positions to `DarkRoomOverlay` as secondary light sources so it punches a small hole in the darkness mask at each transition opening. Modify `src/render/effects/darkRoomOverlay.ts`.

### 6. Editor edge extension visibility

In `src/editor/editorRenderer.ts`, draw the edge extension tiles with a distinct tint (e.g., 30% transparent blue) so they read as non-editable. Pass `edgeExtensionCache` into the editor's render context. Invalidate the cache when edge tiles change.

### 7. Preload check in preview bubble

In `previewBubbleState.ts`, reduce `opacity` to 0 when the connected room's sprites are not yet ready (`areRoomSpritesReady` from `roomAssetPreloader.ts`).

---

# BUILD 263 — Transition System Visual Improvements

## What was implemented (BUILD 263)

### 1. Sprite-based edge extension tiles ✅

Extension tiles now render using the same auto-tiling sprite system as the main wall renderer.

- `EdgeExtensionTile` gains `extensionStep: number` (1 = adjacent to room, N = outermost layer).
- `EdgeExtensionCache` gains `occupancySet: ReadonlySet<string>` — a pre-built set of solid tile positions (extension + room edge cells) used for per-tile neighbour-mask lookups.
- `blockSpriteRenderer.ts` exports new `renderSingleExtensionTile(ctx, col, row, theme, occupancy, ox, oy, scale, blockSizePx, darknessAlpha)` that handles procedural, folder-based, and legacy sprite paths.
- `edgeExtensionRenderer.ts` calls `renderSingleExtensionTile` for every solid extension tile; the solid-colour fallback path is removed.

### 2. Connected-room tile preview inside the bubble

**Status:** Still deferred. Requires pre-rendering adjacent room wall tiles to an OffscreenCanvas (see `roomPreviewCache.ts` stub in nextSteps.md). Preview bubbles still show a glow-only cue.

### 3. FullyLit empty-extension background

Empty extension tiles in FullyLit mode are filled with `bgColor` (unchanged from BUILD 262). Extension of the `renderWorldBackground` clip rect is deferred to a future pass.

### 4. Ambient lighting integration for edge tiles ✅

- `_extensionDepth(step)` maps extension step → air depth (step 1 → depth 2 = 30 % dark; step 2 → depth 3 = 70 %; step 3+ → 100 %).
- `getDarknessAlphaFromAirDepth` tint is applied as a `darknessAlpha` overlay on top of each extension sprite.
- Tinting is skipped for `FullyLit` (no tint) and `DarkRoom` (overlay handles it globally).

### 5. DarkRoom overlay integration for preview bubbles ✅

In `gameRender.ts`, active preview bubbles are injected as `LightSourcePx` entries into the DarkRoom lights array before `darkRoomOverlay.render()`.  The `innerFraction` is scaled by `b.opacity` so the aperture fades in as the player approaches — matching the existing bubble glow animation.

### 6. Editor visibility of edge extension layer ✅

- `renderEditorOverlays` gains an optional `edgeExtensionCache` parameter.
- When provided, solid extension tiles are drawn as 30 % transparent blue rectangles before the grid and wall overlays.
- `editorController.ts` builds the cache in `loadRoomForEditing` (via `buildEdgeExtensionCache`) and passes it to `renderEditorOverlays`.

## File map

| File | Status | Notes |
|---|---|---|
| `src/render/transitions/transitionConfig.ts` | ✅ Done | All tunables |
| `src/render/transitions/transitionState.ts` | ✅ Done | Types only |
| `src/render/transitions/edgeExtensionCache.ts` | ✅ Done | `extensionStep` + `occupancySet` added |
| `src/render/transitions/edgeExtensionRenderer.ts` | ✅ Done | Sprite rendering + ambient tint |
| `src/render/transitions/previewBubbleState.ts` | ✅ Done | Glow proximity |
| `src/render/transitions/previewBubbleRenderer.ts` | ⚠️ Partial | Room tiles still TBD |
| `src/render/transitions/roomPreviewCache.ts` | ❌ Not started | See #2 above |
| `src/render/walls/blockSpriteRenderer.ts` | ✅ Done | `renderSingleExtensionTile` export |
| `src/screens/gameScreen.ts` | ✅ Done | Speed-based fade, camera entry |
| `src/screens/gameRender.ts` | ✅ Done | DarkRoom bubble lights added |
| `src/editor/editorRenderer.ts` | ✅ Done | Edge extension ghost overlay |
| `src/editor/editorController.ts` | ✅ Done | Cache build + pass-through |
| `src/render/hud/renderProfiler.ts` | ✅ Done | Transition debug panel |

---

## BUILD 264 — Editor Save/Load Fixes & Brush Improvements

### What Was Completed

**TASK 1: Save/Load Fixes**

1. **Fixed missing fields in SavedRoomV2** (`src/levels/roomSchemaV2.ts`):
   - Added `SavedCrumble`, `SavedBounce`, `SavedRoomRope` compact interfaces.
   - Added `crumbles`, `bounces`, `ropes`, `dialogueTriggers`, `dcPieces` to `SavedRoomV2`.
   - Implemented dehydrate (export) and hydrate (import) for all five missing types.
   - Crumble blocks, bounce pads, ropes, dialogue triggers, and dust container pieces now survive the full v2 export/import round-trip.

2. **Fixed edge interior wall filtering** (`src/editor/editorRoomBuilder.ts`):
   - `extractInteriorWalls()` now filters boundary walls by `isInvisibleFlag === 1` instead of position heuristics.
   - User-placed 1×1 interior walls at room edges (x=0, x=widthBlocks-1, y=0, y=heightBlocks-1) are no longer stripped when loading a room into the editor.

**TASK 2: Liquid Block Improvements**

3. **1×1 liquid painting** (`src/editor/editorState.ts`, `src/editor/editorPlaceTool.ts`):
   - Water zones and lava zones now default to 1×1 size — paintable like tiles.
   - Liquids are gravity-free: no floor/support check enforced.
   - Duplicate placement at the same position+size is idempotent (no stacking).

**TASK 3: Brush Palette**

4. **BrushMode state** (`src/editor/editorState.ts`): Added `BrushMode` type and `brushMode`, `brushRectStartBlockX`, `brushRectStartBlockY` fields to `EditorState`.

5. **Brush helper** (`src/editor/editorBrush.ts`): New file with `getBrushCells()` and `getRectBrushPreview()`.

6. **Brush dispatch** (`src/editor/editorPlaceTool.ts`): `placeAtCursor` uses brush cells for tile-like items (blocks, liquids, crumble blocks, falling blocks, bounce pads, ambient light blockers).

7. **Rect brush logic** (`src/editor/editorController.ts`): Click-to-start, click-to-fill rectangle. Drag-paint suppressed in rect mode. ESC clears pending rect start.

8. **Brush UI** (`src/editor/editorUI.ts`): Compact brush size selector (1×1, 3×3, 5×5, ▭ rect) appears below tool buttons.

9. **Rect brush preview** (`src/editor/editorPlacementPreviewDrawer.ts`): Shows a preview rectangle while in rect mode with a drag start set.

**TASK 4: Duplicate Self-Overlap Prevention**

10. **Dedup guards** (`src/editor/editorPlaceTool.ts`): Added position-based duplicate prevention for save tombs, skill tombs, dust containers, dust container pieces, water zones, and lava zones.

### Known Limitations / Not Completed

- **Liquid rounded corners**: Floating liquid blocks do not yet render with rounded corners. This is a cosmetic enhancement for a future pass — implement neighbor-aware drawing in the zone renderer.
- **Manual tests**: All items in TASK 5 of the problem statement (save/load tests, brush tests, duplicate prevention tests, performance tests) need manual validation in the running editor.
- **Migration**: Room files exported before BUILD 264 that contained crumble blocks, bounce pads, ropes, or dialogue triggers will be missing those items (they were silently dropped in v2 export). Those rooms need to be re-authored.
- **Falling blocks at room edges**: The `dehydrateRoom` already handled falling blocks in v2 format; no change was needed for those. The edge wall fix in `extractInteriorWalls` covers edge interior wall blocks.

### Files Changed

| File | Change |
|---|---|
| `src/levels/roomSchemaV2.ts` | New SavedCrumble/SavedBounce/SavedRoomRope types; dehydrate/hydrate for 5 missing object types |
| `src/editor/editorRoomBuilder.ts` | extractInteriorWalls uses isInvisibleFlag instead of position heuristic |
| `src/editor/editorState.ts` | BrushMode type, brushMode/brushRectStart fields, 1×1 liquid defaults |
| `src/editor/editorBrush.ts` | New: getBrushCells, getRectBrushPreview |
| `src/editor/editorPlaceTool.ts` | Brush dispatch, 1×1 liquid dedup, save/skill tomb/container dedup |
| `src/editor/editorController.ts` | Rect brush click logic, canDragPaint rect exclusion, ESC clear |
| `src/editor/editorUI.ts` | Brush size selector UI |
| `src/editor/editorPlacementPreviewDrawer.ts` | Rect brush preview overlay |
| `src/build-info.ts` | BUILD_NUMBER 263 → 264 |

---

## BUILD 265 — Liquid Visual Effects (Rounded Corners, Wave Edges, Lava Sparks)

### What Was Completed

1. **Increased MAX_WATER_ZONES and MAX_LAVA_ZONES** (`src/sim/worldHazardState.ts`):
   - Raised from 8 → 512 to support the 1×1 tile painting added in BUILD 264.

2. **New `src/render/liquidRenderer.ts`** — All liquid visual logic extracted from `hazards.ts`:
   - **Neighbor-aware rounded corners**: Each liquid zone checks all 4 orthogonal directions for adjacent walls or other liquid zones. Free (unexposed) corners receive an `arcTo` arc radius of `0.4 × BLOCK_SIZE_MEDIUM`. Corners touching walls or other liquids stay square, so adjacent liquids merge cleanly.
   - **Smooth sine-wave surface**: The exposed top edge of each zone is drawn as a multi-step polyline driven by two overlapping sine waves (`WAVE_FREQ × tick` + spatial frequency). The amplitude tapers to zero near rounded corners and at blocked sides, preventing discontinuities.
   - **Lava spark particles**: Module-level `LavaSpark` pool (max 256). Each tick, exposed lava edges randomly emit sparks (probability `SPARK_EMIT_PROB = 0.055` per block-width of edge per tick). Sparks receive a perpendicular outward velocity + random tangential component, then integrate gravity (`0.10 wu/tick²`) and slight drag each tick. They fade from bright yellow-white to red over `SPARK_LIFETIME_TICKS = 28` ticks. Sparks can emerge from any exposed edge (top, bottom, left, right).

3. **Updated `src/render/hazards.ts`**:
   - Removed the old inline water/lava rendering loops.
   - Now delegates to `renderWaterZones()` and `renderLavaZones()` from `liquidRenderer.ts`.

### Architecture Notes

- All liquid effects are purely cosmetic render-layer state — no sim state is modified.
- The `sparks` pool in `liquidRenderer.ts` is module-level (reset survives room transitions). Sparks automatically expire after `SPARK_LIFETIME_TICKS` ticks.
- The neighbor check (`isSideBlocked`) is O(wallCount + waterZoneCount + lavaZoneCount) per zone per side. With 512 max zones this could be up to ~512 × 4 × 1000 operations per frame in pathological cases. For typical rooms with few hundred tiles this is fine. A spatial hash could be added later if profiling shows a bottleneck.

### Known Limitations / Follow-Up

- **Water rounded corners**: Currently water only has top-corner rounding on 4 corners. Side/bottom corners also round. This looks correct for isolated cells. If the water pool is intentionally contained by walls on 3 sides with only the top free, it will also render correctly.
- **Lava sparks and room transitions**: Sparks are not cleared on room load. They naturally expire within ~28 ticks (~0.5 seconds at 60fps). A future improvement could clear the pool on room load for instant cleanup.
- **Performance with 512 zones**: The current neighbor check is O(n) per zone side. For rooms with many hundreds of 1×1 zones, this may be noticeable. Add a spatial hash or sorted-list acceleration if frame time regresses.
- **Rounded corner clipping**: When a liquid zone is adjacent to a solid wall, the corner arc is suppressed (corner remains sharp). This is intentional — liquid touching a wall should have a hard edge there.

### Files Changed

| File | Change |
|---|---|
| `src/sim/worldHazardState.ts` | MAX_WATER_ZONES and MAX_LAVA_ZONES 8 → 512 |
| `src/render/liquidRenderer.ts` | New: neighbor checks, rounded corners, wave surface, lava sparks |
| `src/render/hazards.ts` | Delegated water/lava rendering to liquidRenderer; removed inline loops |
| `src/build-info.ts` | BUILD_NUMBER 264 → 265 |
