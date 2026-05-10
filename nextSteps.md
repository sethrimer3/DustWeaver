# DustWeaver — Next Steps

## BUILD 272–273 — Sword Bug Fix + Performance Optimizations

This document summarises all work completed through BUILD 273 and any
remaining open items.

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

### Known limitations / remaining work

1. **No dual-room rendering** (the main remaining work):
   True seamless crossing requires:
   a. A staging `WorldState` for the connected room — pre-loaded asynchronously while the
      player is in the current room.
   b. A two-room `WorldSnapshot` snapshot boundary: both `WorldState` instances are ticked
      and snapshotted independently.
   c. A `StagingRoomRenderer` (or equivalent) that renders the connected room's snapshot
      onto an offscreen canvas in the correct world-space offset.
   d. The `TransitionPreviewContext.nextRoomFacingEdge` field is already the attachment
      point: replace (or augment) it with the full staging snapshot when it becomes
      available, and `renderNextRoomFacingEdge` can be updated to read from it.

2. **Row/column alignment at transitions with non-matching openings**:
   The current implementation assumes the connected room's rows/cols line up 1-to-1 with
   the current room's rows/cols. For rooms where the transition opening is vertically or
   horizontally offset (e.g., a 3-block opening at row 2 in the current room connecting to
   a 3-block opening at row 5 in the next room), the next-room edge tiles will be rendered
   at the "wrong" rows. Fix: store the Y-offset (for horizontal transitions) or X-offset
   (for vertical) in `NextRoomFacingEdge.originYWorld`/`originXWorld` using the matched
   transition's `yBlock`/`xBlock` difference.

3. **Auto-tiling accuracy at the seam**:
   The `NextRoomFacingEdge` occupancy set contains only 3 columns/rows from the connected
   room. Tiles at the innermost face of the 2-block strip do not know their room-interior
   neighbor, so the east/south/west/north open-air-side may be wrong for those tiles.
   Fix: include a 4th column/row of reference data in the occupancy set, or fall back to
   a fixed "interior wall" tile at the inner face.

