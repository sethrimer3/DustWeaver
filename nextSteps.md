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
