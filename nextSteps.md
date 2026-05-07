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
