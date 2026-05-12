# DustWeaver — Next Steps

## BUILD 284 — Seamless Room Transitions + Long Transition Flag

### What Was Implemented

**Seamless adjacent-room crossing** (`src/screens/gameScreen.ts`):

Normal (non-long) room transitions no longer snap/teleport when the active room
swaps.  Instead, after the player crosses 2 blocks into the new room (the existing
`isCrossingComplete` threshold), `_finalizeCrossingSeamless()` is called:

1. `loadRoom()` re-initialises the new room (player spawn position, enemies,
   hazards, physics, etc.) in the usual room-local coordinate space.
2. For **right/down exits** (where the previous room would have negative coords in
   the new space), the entire world is shifted right/down by the previous room's
   width/height so all wall coordinates remain positive.
3. The previous room's walls are re-appended to `world.walls[]` at the correct
   world-space offset (`appendRoomWallsAtOffset`, now exported from
   `twoRoomCrossing.ts`).
4. The previous room is recorded in `stagedRooms[]` as a `StagedRoomInstance`
   with its world-space origin.
5. World bounds, camera, and render clip-rect are updated to cover the union of
   the active room + staged rooms, exactly as during the active-crossing phase.
6. `currentRoomOriginXWorld/Y` tracks where the active room begins in world space
   so `checkRoomTransitions` can convert between world and room-local player
   coords via the new optional `playerOffsetX/Y` parameters.
7. Staged rooms are cleared automatically when `loadRoom()` is called for any
   reason (death, save-load, long transition).
8. When the player triggers the *next* transition, `_clearStagedRoomsAndNormalize()`
   removes the staged walls and shifts the world back to `(0, 0)` before calling
   `startCrossing()`, restoring the invariant that the active room begins at the
   origin.

**Long Transition flag** (`longTransition?: boolean`):

Added to all transition data layers:
- `RoomTransitionDef` (roomDef.ts)
- `RoomJsonTransition` (roomJsonSchema.ts)
- `EditorTransition` (editorState.ts)
- `SavedTransition` — compact key `lt` (roomSchemaV2.ts)

When a transition has `longTransition: true`:
- `startCrossing()` is **not** called.
- `loadRoom()` is called immediately (legacy teleport-style).
- The `PostTransition` camera reveal is still applied.
- Existing room files without the field load correctly (defaults to `false`).

**Editor UI**:
- Inspector panel for room transitions now includes a **"Long Transition"**
  checkbox below "isSecretDoor".

**Defensive warnings** (`gameTransitions.ts`):
- Console warning when a transition points to a missing room.
- Console warning when no matching return transition is found.

### Reuse of Existing Infrastructure

- `appendRoomWallsAtOffset` (was private `_appendRoomWalls` in `twoRoomCrossing.ts`):
  reused verbatim, just exported.
- `updateCameraWithBounds`: reused for both active-crossing and staging phases.
- `getCrossingUnionBounds`: still used during the active crossing phase.
- `isCrossingComplete` threshold unchanged — staging begins at the same point the
  old hard teleport fired.

### Known Limitations / Next Steps

1. **Staged room background**: The background texture/parallax of the staged (previous)
   room is not rendered at its world-space offset.  The active room's background
   fills the entire expanded clip rect.  Visually this is only noticeable for rooms
   with very different backgrounds.

2. **Staged room hazards**: Water/lava/spike zones from the staged room are not
   simulated while staged.  The player can walk through them without effect if they
   re-enter the staged room portion.  A future pass should re-spawn or freeze-simulate
   staged room hazards.

3. **Staged room enemies**: Enemies from the staged room are despawned when `loadRoom`
   is called.  They do not reappear during staging.  A future pass should keep enemy
   clusters alive in the staged room's world-space positions.

4. **Falling blocks, ropes, crumble blocks**: Similar to enemies — these belong to the
   staged room but are not preserved.  Not marked as broken since the player cannot
   easily return within the staging window without triggering a new crossing.

5. **Recursive staging (A→B→C)**: When the player crosses from B into C, staged room A
   is discarded (`_clearStagedRoomsAndNormalize`).  Only one ring of staged rooms is
   maintained at a time (sufficient for the seamless feel requirement).

6. **Ambient-depth shading seam**: Wall sprites at the seam may look slightly wrong
   because the ambient-depth BFS is computed per-room and does not extend across the
   boundary for staged walls.

7. **Transition reveal (edge-extension preview)**: The reveal offset and
   `transitionPreviewContext` are suppressed when staged rooms are present (same
   behaviour as during active crossing).  This means no edge-extension preview tiles
   appear on the far side of the new room while A is still staged.

---

## BUILD 279 — Two-Room Smooth Camera Crossing

### What Was Implemented

**Two-room smooth camera crossing system** (`src/screens/twoRoomCrossing.ts`):

- When the player crosses a room transition, both rooms are placed side-by-side
  in a shared "crossing world space" rather than immediately loading the new room.
- The current room's walls stay at their normal positions. The next room's walls
  are appended to `world.walls` at the correct adjacent origin offset, so player
  physics (collision, gravity) work correctly in both rooms without any special
  casing.
- For left/up exits where the next room would be at negative coordinates, the
  current room walls, player, and camera are shifted right/down so all coordinates
  remain positive (required by the physics boundary system).
- The camera clamps to the **union** of both room bounding boxes during crossing,
  so it smoothly follows the player across the seam without hard clipping.
- Once the player's centre is 2 blocks past the seam, crossing is finalised:
  `loadRoom()` is called with `preserveCamera = true`, the camera is restored in
  next-room local coords, and normal single-room rendering resumes.
- Player velocity is preserved through the transition with no momentum loss.

**Feature flags** (`src/render/transitions/transitionConfig.ts`):

| Flag | Value | Effect |
|------|-------|--------|
| `ENABLE_TWO_ROOM_CAMERA_CROSSING` | `true` | Activates two-room crossing system |
| `ENABLE_EDGE_EXTENSION_RENDERING` | `false` | Disables procedural edge-extension tiles |
| `ENABLE_NEXT_ROOM_EDGE_PREVIEW` | `false` | Disables next-room facing-edge strip |

**Camera API** (`src/render/camera.ts`):

- Added `updateCameraWithBounds(camera, targetX, targetY, minX, minY, maxX, maxY, vpW, vpH, dt)`
  to clamp the camera to arbitrary world-space bounds — used during crossing and
  available for any future multi-room or boss-room scenarios.

**Rendering** (`src/screens/gameRender.ts`):

- New `RenderFrameContext` fields: `isCrossing`, `crossingUnionMin/MaxXWorld/YWorld`.
- During crossing, the clip rect is expanded to the union bounds of both rooms,
  so the next room's walls (added to `world.walls`) render correctly.
- Edge-extension rendering and next-room facing-edge rendering are gated by flags.
- Transition passage gradients are skipped during crossing (both rooms are rendered
  in full; no artificial void fill needed).
- Background fill expanded to union rect when crossing and WebGL is unavailable.

**Transition API** (`src/screens/gameTransitions.ts`):

- `checkRoomTransitions` callback now receives `transitionIndex` as 5th argument,
  enabling `startCrossing` to look up the matched return transition for door-offset
  alignment without a second search.

**Door alignment** (reuses `computeConnectedRoomOrigin` / `computeTransitionOpeningOffset`
from `src/render/transitions/transitionPreviewContext.ts`):

- Offset door openings (where the current room's door is at a different row/column
  than the connected room's door) are correctly aligned in crossing world space.
- If no matching return transition is found, the origin offset defaults to 0 and
  a console warning is emitted.

---

### What Is Intentionally Disabled for This Pass

- **Edge-extension tiles** beyond room borders: hidden via `ENABLE_EDGE_EXTENSION_RENDERING = false`.
- **Next-room facing-edge strip**: hidden via `ENABLE_NEXT_ROOM_EDGE_PREVIEW = false`.
- **Transition reveal offset** (old camera-peek system): suppressed during crossing
  (camera is already in crossing world space).

---

### Known Limitations and Remaining Work

#### Camera

- **Small rooms narrower/shorter than the viewport**: after crossing finalises,
  `updateCamera` forces the camera to centre on the new room. This causes a brief
  camera snap if the crossing camera position was off-centre. Fix: lerp toward
  room-centre instead of snapping, or keep `updateCameraWithBounds` active for a
  short settling window after finalisation.

#### Rendering

- **Wall sprite auto-tiling at the seam**: the chunk cache's occupancy set for
  auto-tiling is built from all walls in `world.walls`. Both rooms' walls are
  present, but they were added independently, so tiles at the seam boundary may
  have incorrect neighbour masks (e.g. a wall tile touching the adjacent room's
  floor tile may appear without the correct edge sprite). Fix: after appending
  next-room walls, rebuild the seam columns/rows with cross-room occupancy data.
- **Background rendering during crossing**: the parallax background is only drawn
  for the current room's rectangle. The next room's area shows a solid `bgColor`
  fill (or transparent when WebGL is active). Fix: call `renderWorldBackground`
  twice with each room's origin offset, or extend the background renderer to
  accept an arbitrary clip rect.
- **Dark-room overlay during crossing**: the `DarkRoomOverlay` clips to the current
  room's light holes only. Light sources from the next room are not included.
  Fix: extend light collection to also scan the next room's `lightSources` array
  during crossing, offsetting them by `nextRoomOriginXWorld/YWorld`.

#### Gameplay staging in the next room

- **Enemies**: enemies from the next room are not spawned during crossing. The
  player physically enters the next room's geometry with no enemies present. Fix:
  spawn next-room enemies into a second `WorldState` or add them at offset
  positions to the current `WorldState`. Requires careful lifetime management
  (the enemy clusters must be removed before `loadRoom` finalises).
- **Hazards** (spikes, liquid, fireballs): not simulated in the next room during
  crossing. The player can walk over them without damage. Fix: port hazard
  activation to use world-space offsets, and stage them alongside the walls.
- **Particles and motes**: particle emitters from the next room do not fire during
  crossing. Fix: stage next-room particle zones at the offset origin.
- **Falling blocks**: not triggered for the next room during crossing.

#### Transition edge cases

- **Player dies during crossing**: `loadRoom` (called by the death handler)
  automatically resets `crossingState.phase = 'inactive'`, so recovery is clean.
  Verify on death mid-seam.
- **Very fast players (sub-tick tunneling)**: at very high velocity (e.g. during
  a dash through a narrow opening), the player might skip past the 2-block settle
  threshold in a single tick before `isCrossingComplete` is evaluated. Current
  `SETTLE_INSET_WORLD = 2 * BLOCK_SIZE_MEDIUM`. If this causes missed finalization,
  increase the settle inset or add sub-step detection.
- **Multiple simultaneous transitions**: only one transition can be active at a
  time (guarded by `crossingState.phase === 'inactive'` check). Attempting to
  re-enter a transition during crossing is ignored (correct).

---



---

## Bug Fix: Sword Visible Without Motes (BUILD 273)

**Root cause**: `tickSwordWeave()` fell back to `lengthRatio = 1.0` when
`world.moteSlotCount === 0` (no dust bound to the secondary weave), causing the
renderer to draw a full-length sword even before any motes existed.  Additionally,
the FSM was not reset on room load, so a stale `ORBIT` → `FORMING` transition
fired on the first frame.

**Fix** (`src/sim/weaves/swordWeave.ts`):
- Added a guard at the top of `tickSwordWeave()`: when `moteSlotCount === 0`
  the FSM is forced to `SWORD_STATE_ORBIT` and the function returns `false`
  immediately — no sword, no crescent.
- Removed the `lengthRatio = 1.0` fallback; the ratio is now always
  `activeSwordMoteCount / MAX_SWORD_BLADE_MOTES`.

**Fix** (`src/screens/gameScreen.ts`):
- `loadRoom()` now calls `resetSwordWeaveState(world)` after the mote queue is
  initialised so the FSM starts clean (from `ORBIT`) on every room visit.
- Right-click no longer makes the sword "disappear" — it never appeared in the
  first place when no motes are bound.

---

## BUILD 272 — Rendering Performance Optimization Pass (continued)

### 1. Async / incremental loadRoom() ✅

`loadRoom()` is now implemented as a generator function (`_makeLoadRoomPhases`)
with 6 yield points between major loading phases:

| Phase | Work | ~Cost |
|-------|------|-------|
| A | Room meta + world reset + block sprites + music | ~1 ms |
| B | Spawn player + particles + mote queue | ~1 ms |
| C | Spawn enemies | 5–15 ms |
| D | Background particles + grapple chains + walls | 5–10 ms |
| E | Hazards + ropes + blocks + grasshoppers + dialogue | 2–5 ms |
| F | Env effects + rendering setup + camera | ~1 ms |

For room transitions, the generator is advanced **one phase per RAF frame**
while the screen is blacked out by the fade overlay.  The fade-in begins only
after all phases complete.  Initial load and save/respawn paths run all phases
synchronously (backwards-compatible `loadRoom()` wrapper).

This eliminates the 30–80 ms synchronous stall during room transitions.

### 2. Coloured DarkRoom lights ✅

`RoomLightSourceDef.colorR/G/B` is now forwarded through the full pipeline.
After the darkness mask is composited, a second pass with `ctx.globalCompositeOperation = 'lighter'`
draws a radial gradient tint for any light source that is not pure white (R=G=B=255).
Achromatic/white lights skip the colour pass entirely (zero extra draw calls).

### 3. Adaptive quality safeguards ✅

A rolling frame-time monitor runs each RAF frame (reads from the profiler's EMA
scalar — no allocation).  When the average exceeds **33 ms** (≈30 fps) for 90
consecutive frames (~1.5 s), `isAdaptiveReductionActive` is set and quality caps
are halved in `renderFrame()`:

| Cap | Normal | Adaptive |
|-----|--------|----------|
| Dust mote count | configurable | `max(32, n >> 1)` |
| Dynamic light count | configurable | `max(4, n >> 1)` |
| Particle light count | configurable | `max(4, n >> 1)` |
| Decoration bloom count | configurable | `max(16, n >> 1)` |

Recovery: when the average drops below **20 ms** for 180 consecutive frames
(~3 s), full quality is restored.  The profiler overlay shows `! ADAPTIVE QUALITY`
in red while active.

### 4. Flat typed-array interface for lights ✅

`LightSourcePx[]` replaced with a pre-allocated `Float32Array` (`MAX_LIGHT_BUFFER_COUNT × LIGHT_BUFFER_STRIDE` = 256 × 7 = 1792 floats).

Interleaved layout per light (7 floats):
- `[0]` xPx, `[1]` yPx, `[2]` radiusPx, `[3]` innerFraction, `[4]` colorR, `[5]` colorG, `[6]` colorB

`collectDecorationLights()` writes directly into the flat buffer and returns the new count.
`_pushLight()` helper in `gameRender.ts` writes one entry into the buffer.
All `_scratchLights.push({...})` calls are eliminated.

### 5. Sunbeam gradient caching ✅

`SunbeamRenderer` now caches one `CanvasGradient` per beam in a pre-allocated array.
Gradients are rebuilt only when the beam's pixel-space origin or tip position changes
by more than `GRADIENT_REUSE_THRESHOLD_PX = 0.5` px.  The shimmer animation is
applied via `ctx.globalAlpha` rather than being baked into gradient colour stops,
so the cached gradient remains valid across frames while the camera is stationary.

---

## Files Changed in BUILD 272–273

| File | Change |
|------|--------|
| `src/build-info.ts` | BUILD_NUMBER 271 → 273 |
| `src/sim/weaves/swordWeave.ts` | Guard: `moteSlotCount=0` → stay ORBIT; remove fallback `lengthRatio=1.0` |
| `src/screens/gameScreen.ts` | `resetSwordWeaveState()` on room load; generator-based async `loadRoom()`; adaptive quality state machine |
| `src/render/effects/darkRoomOverlay.ts` | Flat `Float32Array` API; coloured additive light pass; `LIGHT_BUFFER_STRIDE`/`MAX_LIGHT_BUFFER_COUNT` exports |
| `src/render/effects/wallDecorations.ts` | `collectDecorationLights` writes to `Float32Array`; returns new count |
| `src/render/effects/sunbeamRenderer.ts` | Gradient cache per beam; shimmer via `globalAlpha` |
| `src/render/hud/renderProfiler.ts` | `getAvgFrameMs()` added |
| `src/screens/gameRender.ts` | `isAdaptiveReductionActive` field; `_pushLight()` helper; flat buffer; adaptive `qc` overrides; coloured lights via `ls.colorR/G/B` |

---

## Remaining Open Items

### A. Shadow occluder object allocations
`buildPlayerShadowOccluders()` pushes `{ baseAx, baseAy, … }` objects into `out`
— up to 4 objects per frame in DarkRoom mode.  Pre-allocating a pool of 4 mutable
objects and filling them without `push` would eliminate these.

### B. Decoration bloom: per-frame object literals in BloomSystem
`addDecorationBloom()` and similar bloom draw calls create `{ x, y, radius, glow: { … } }`
descriptor objects each frame.  Pooling these or using a flat typed-array interface
for the BloomSystem draw queue would reduce GC pressure.

### C. Spatial partitioning for DarkRoom particle-light loop
The DarkRoom particle-light loop scans all particles linearly (`particleCount`
iterations).  With thousands of particles this is O(n); a spatial grid (already
present in `sim/` for physics) could accelerate the screen-visible subset query.

---

## BUILD 274 — Smooth Camera Transition Reveal (no fade)

### What was implemented

- **Removed black-screen fade**: The fade-out/fade-in overlay (`transitionFadeAlpha`, `transitionFadeDir`, `pendingRoomTransition`, `pendingAsyncLoad`) is removed. Transitions no longer black out the screen.
- **Synchronous transition loading**: `checkRoomTransitions` now calls `loadRoom()` synchronously in its callback. The ~30–80 ms stall replaces the multi-frame black fade.
- **Camera reveal system**: New module `src/render/transitions/transitionCameraReveal.ts`:
  - **NearTransition**: Camera eases outward as player approaches a room exit.
  - **PostTransition**: Camera shows entry-edge extension tiles and eases back to neutral as the player walks deeper into the new room.
- **New constants** in `transitionConfig.ts`: `TRANSITION_REVEAL_START_DIST_WORLD`, `TRANSITION_REVEAL_MAX_BLOCKS`, `TRANSITION_REVEAL_DECAY_DIST_WORLD`, `TRANSITION_REVEAL_EASE_SPEED`.

---

## BUILD 275 — Transition Preview Context + Next-Room Edge Preview

### What was implemented

1. **Removed unused fade constants** from `transitionConfig.ts`:
   `TRANSITION_MAX_DURATION_MS`, `TRANSITION_MIN_DURATION_MS`, `TRANSITION_FADE_OUT_FRACTION`, `TRANSITION_SPRINT_SPEED_WORLD`, `TRANSITION_FAST_SPEED_WORLD`, and `TRANSITION_CAMERA_ENTRY_OFFSET_BLOCKS` are all removed. They were leftover from the old fade-overlay system.

2. **`TransitionRevealState` extended**:
   - `activeTransitionIndex: number` — index into `currentRoom.transitions` for the transition driving the current reveal (−1 = none). Updated each frame by `updateTransitionReveal`.
   - `revealProgress: number` — `[0, 1]` fraction of the maximum reveal currently active.
   These fields are read by `updateTransitionPreviewContext` each frame.

3. **Small-room cap** in `updateTransitionReveal`: The reveal offset is now capped at
   `(EDGE_EXTENSION_EXTRA_BLOCKS − 1) × BLOCK_SIZE_SMALL` so the camera can never be shifted
   beyond the available extension tiles, regardless of room size.

4. **Lambda-anchor teleport fix**: `lambdaTeleportFlash()` in `gameScreen.ts` now calls
   `notifyFreshRoomLoaded(transitionRevealState)` to reset the reveal offset after an
   in-room teleport. Stale reveal state no longer persists after a lambda-anchor jump.

5. **`notifyTransitionRoomEntered` extended**: Now accepts an optional `entryTransitionIndex`
   parameter and stores it in `activeTransitionIndex` so the preview context can resolve the
   connected room immediately on the first post-entry frame.

6. **`TransitionPreviewContext`** — new type and module `src/render/transitions/transitionPreviewContext.ts`:
   - `isActive: boolean` — true when reveal progress exceeds a small threshold.
   - `direction: TransitionDirection | null` — which side is being revealed.
   - `connectedRoomId: string | null` — ID of the next room (from `transition.targetRoomId`).
   - `revealProgress: number` — mirrors `TransitionRevealState.revealProgress`.
   - `nextRoomFacingEdge: NextRoomFacingEdge | null` — the connected room's 2-block facing strip.

   Updated each frame by `updateTransitionPreviewContext()`. Caches the `NextRoomFacingEdge`
   until the active transition changes (key: `{roomId}:{direction}:{currentW}x{currentH}`).
   This is the intended attachment point for future dual-room rendering — see below.

7. **`NextRoomFacingEdge`** — computed from the connected room's wall definitions:
   - For a `'right'` transition: connected room's leftmost 2 columns (cols 0 and 1).
   - For a `'left'` transition: connected room's rightmost 2 columns (cols W−1 and W−2).
   - For `'down'` / `'up'`: equivalent 2-row strip from the top/bottom.
   - Origin expressed in current-room world space so the renderer can position the tiles
     correctly with no additional coordinate math.

8. **`renderNextRoomFacingEdge()`** — new renderer `src/render/transitions/nextRoomEdgeRenderer.ts`:
   - Renders the `NextRoomFacingEdge` tiles before the room clip rect (same phase as the
     current room's edge extension tiles).
   - Tiles fade in proportionally to `revealProgress` — invisible during normal navigation,
     gradually appearing as the player approaches a transition.
   - Combines with the current room's own extension tiles to give 4 columns/rows of tile
     continuity at each transition:
       `[current-room ext col 2] [current-room ext col 1] | door | [next-room col 0] [next-room col 1]`
   - Auto-tiling uses the 3-column/row occupancy set from `NextRoomFacingEdge`; neighbor
     masks at the seam are best-effort (inner face is correct; outer edge is treated as open-air).
   - No work is done during ordinary room navigation (`revealProgress < 0.05`).

### Files changed in BUILD 275

| File | Change |
|------|--------|
| `src/build-info.ts` | BUILD_NUMBER 274 → 275 |
| `src/render/transitions/transitionConfig.ts` | Removed 6 unused fade/entry constants |
| `src/render/transitions/transitionCameraReveal.ts` | Added `activeTransitionIndex`, `revealProgress`; small-room reveal cap; updated `notifyTransitionRoomEntered` signature; `notifyFreshRoomLoaded` doc update |
| `src/render/transitions/transitionPreviewContext.ts` | **New**: `TransitionPreviewContext`, `NextRoomFacingEdge`, cache, `createTransitionPreviewContext`, `updateTransitionPreviewContext`, `_buildNextRoomFacingEdge` |
| `src/render/transitions/nextRoomEdgeRenderer.ts` | **New**: `renderNextRoomFacingEdge` |
| `src/screens/gameScreen.ts` | Import + create + update `transitionPreviewCtx`; pass to `renderFrame`; lambda-anchor fix; pass `entryTi` to `notifyTransitionRoomEntered` |
| `src/screens/gameRender.ts` | Added `transitionPreviewCtx` to `RenderFrameContext`; call `renderNextRoomFacingEdge` before clip rect |

### Tuning guide

All reveal constants live in `src/render/transitions/transitionConfig.ts`:

| Constant | Default | Effect |
|---|---|---|
| `TRANSITION_REVEAL_START_DIST_WORLD` | 48 | Reveal begins this many world units from the exit |
| `TRANSITION_REVEAL_MAX_BLOCKS` | 2 | Max extension blocks revealed by camera shift |
| `TRANSITION_REVEAL_DECAY_DIST_WORLD` | 48 | PostTransition fades over this walk distance |
| `TRANSITION_REVEAL_EASE_SPEED` | 6.0 | Camera easing speed (higher = snappier) |

---

## BUILD 276 — Transition Origin Alignment + Seam Auto-tiling + Staging Snapshot

### What was implemented

#### 1. Connected-room origin alignment using matched transition positions ✅

Previously `NextRoomFacingEdge.originXWorld`/`originYWorld` were hardcoded to 0
for the non-primary axis (e.g., `originYWorld = 0` for all horizontal transitions).
This caused offset door openings to misalign — the next-room tiles rendered at the
wrong row/column when the two transitions' `yBlock`/`xBlock` differed.

**Fix**: `_buildNextRoomFacingEdge` now finds the matched transition in the
connected room (same logic as `checkRoomTransitions`) and computes:
- `seamDeltaRowBlocks = currentTrans.yBlock − connectedTrans.yBlock` (horizontal)
- `seamDeltaColBlocks = currentTrans.xBlock − connectedTrans.xBlock` (vertical)

The connected-room origin is then placed so the two openings align at the seam:
- `'right'`: `originYWorld = seamDeltaRowBlocks × BLOCK_SIZE_SMALL`
- `'left'`:  same, `originXWorld = -connectedW × BS`
- `'down'`:  `originXWorld = seamDeltaColBlocks × BS`
- `'up'`:    same, `originYWorld = -connectedH × BS`

If no matching transition is found, origin defaults to 0 and a console warning
is emitted.

#### 2. Seam auto-tiling improvements ✅

Two improvements to `occupancySet` in `NextRoomFacingEdge`:

**4th reference column/row**: Added `refCol2`/`refRow2` (one step deeper than
the existing 3rd reference) so the inner-face tile (`col1`/`row1`) has a correct
east/south neighbor mask for the block immediately behind it, rather than
treating it as open air.

**Seam-face entries from current room**: `_buildCurrentRoomSeamSolid()` builds
a set of rows/cols where the current room's boundary edge is solid. These are
mapped into connected-room coordinates and added to `occupancySet` at
`seamCol`/`seamRow` (one step outside `col0`/`row0`). The facing tile therefore
sees its neighbor toward the current room as solid when the current-room wall
continues to the edge — eliminating the "exposed outer face" artifact on
connected seam tiles.

#### 3. `TwoRoomTransitionSnapshot` staging data structure ✅

New exported type in `transitionPreviewContext.ts`. Provides:
- `activeTransitionIndex`, `exitDirection`, `currentRoomId`, `connectedRoomId`
- `currentRoomOriginXWorld/Y` (always 0 — current room IS the reference frame)
- `nextRoomOriginXWorld/Y` — correctly aligned origin from matched transitions
- `nextRoomFacingEdge: NextRoomFacingEdge | null` — the facing-edge strip
- `revealProgress: number` — updated in-place each frame (no per-frame allocation)

Reserved fields documented for future dual-room rendering:
- `nextRoomWorldSnapshot` — full WorldSnapshot for the connected room
- `nextRoomEdgeExtensionCache` — edge tiles for the connected room
- `isNextRoomStaged` — true once staging is ready

#### 4. `stagingSnapshot` field on `TransitionPreviewContext` ✅

`TransitionPreviewContext` gains a `stagingSnapshot: TwoRoomTransitionSnapshot | null`
field. The existing `nextRoomFacingEdge` field is retained as a backward-compatible
alias pointing to `stagingSnapshot.nextRoomFacingEdge`.

The cache key now includes the current room ID and transition index (not just the
target room ID + direction) so two different transitions in the same room with
different `yBlock`/`xBlock` values are cached separately.

#### 5. Exported helper functions ✅

- `computeTransitionOpeningOffset(currentTrans, connectedTrans, exitDir)` — returns
  the signed delta in blocks between the two opening positions.
- `computeConnectedRoomOrigin(exitDir, currentW, currentH, connectedW, connectedH,
  seamDeltaRowBlocks, seamDeltaColBlocks)` — returns the connected room's `originXWorld`
  / `originYWorld` in current-room world space.  Pure, side-effect-free, usable by
  future staging code.

#### 6. `renderNextRoomFacingEdge` documented as staging renderer ✅

`nextRoomEdgeRenderer.ts` is documented as the **StagingRoomRenderer** equivalent:
the opt-in renderer path that activates only during transition preview or crossing.

### Files changed in BUILD 276

| File | Change |
|------|--------|
| `src/build-info.ts` | BUILD_NUMBER 275 → 276 |
| `src/render/transitions/transitionPreviewContext.ts` | Added `TwoRoomTransitionSnapshot`; added `stagingSnapshot` to context; added `computeTransitionOpeningOffset`, `computeConnectedRoomOrigin` helpers; fixed origin offset; improved seam auto-tiling (4th ref + seam face); updated cache key; improved failure warning |
| `src/render/transitions/nextRoomEdgeRenderer.ts` | Updated module comment to document it as the StagingRoomRenderer equivalent; documents BUILD 276 alignment fix |
| `nextSteps.md` | Updated to reflect BUILD 276 completions and remaining work |

### Known limitations / remaining work

1. **No full dual-room rendering** (primary remaining work):
   True seamless crossing requires:
   a. A staging `WorldState` for the connected room — pre-loaded asynchronously
      while the player is in the current room.
   b. A two-room snapshot tick: both rooms' `WorldState` instances are ticked and
      snapshotted; the connected room's snapshot is stored in
      `TwoRoomTransitionSnapshot.nextRoomWorldSnapshot`.
   c. `renderNextRoomFacingEdge` (or a new `renderStagingRoom` function that reads
      the full `stagingSnapshot`) renders the connected room's enemies, particles,
      and all walls at `nextRoomOriginXWorld`/`Y` offset.
   d. Camera bounds: during crossing, clamp the camera to the union of both room
      bounds; after the active-room swap, restore normal single-room clamping.

2. **Active room swap timing** (existing behavior is correct):
   The active room swaps the moment the player crosses the trigger boundary in
   `checkRoomTransitions`. The staging snapshot is cleared immediately after swap
   by `notifyFreshRoomLoaded`. No change needed here unless full dual-room rendering
   requires a later swap point.

3. **Seam auto-tiling edge cases**:
   - Corner tiles near the seam (where a horizontal wall meets a vertical wall
     at the transition opening corner) may still show incorrect diagonal auto-tiling
     because only 4 reference columns/rows of connected-room data are available.
   - Transitions with very small rooms (< 4 blocks in the exit direction) may have
     fewer reference columns/rows available; `refCol2`/`refRow2` bounds checks handle
     this gracefully (skipped when out of bounds).
   - The `_buildCurrentRoomSeamSolid` function captures wall-level solidity only;
     crumble blocks and falling blocks at the boundary edge are not included. This
     is acceptable for the current use case.

4. **Editor compatibility**:
   The cache key now includes the current room ID and transition index. If the
   editor modifies a transition's `yBlock`/`xBlock` without triggering a full
   room reload, the cache will be stale. This is acceptable because the editor
   calls `notifyFreshRoomLoaded` (via the editor load callback) which resets
   `activeTransitionIndex = -1` and effectively clears the preview context.

5. **Performance note**:
   `_buildCurrentRoomSeamSolid` iterates all walls in the current room each time
   the cache key changes (not every frame — only on transition/room change).
   For rooms with very large wall counts this is still fast (O(walls), not O(n²)).


