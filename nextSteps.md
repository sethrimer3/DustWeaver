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

### Known limitations / remaining work

1. **No dual-room rendering**: True seamless crossing would require pre-loading the adjacent room, rendering both rooms simultaneously, and sliding the camera across the boundary over ~0.3–0.5 seconds — a larger architectural change requiring a staging world state and two-room renderer.

2. **Next room's edge blocks not shown**: The spec requests 2 blocks of the *connected* room's edge visible. This is blocked by the same issue as (1); only the current room's edge extension is revealed.

3. **Lambda-anchor teleport**: `notifyFreshRoomLoaded(transitionRevealState)` is not called after a lambda teleport. Add it to the lambda-anchor handler in `gameCommandProcessor.ts` to prevent stale reveal state after teleporting.

4. **Small rooms**: Reveal offset on rooms narrower than the viewport may push the view past the available extension tiles. Cap the reveal offset by the available room margin.

5. **`TRANSITION_CAMERA_ENTRY_OFFSET_BLOCKS`** in `transitionConfig.ts` is now unused — can be removed in a cleanup pass.

### Tuning guide

All reveal constants live in `src/render/transitions/transitionConfig.ts`:

| Constant | Default | Effect |
|---|---|---|
| `TRANSITION_REVEAL_START_DIST_WORLD` | 48 | Reveal begins this many world units from the exit |
| `TRANSITION_REVEAL_MAX_BLOCKS` | 2 | Max extension blocks revealed by camera shift |
| `TRANSITION_REVEAL_DECAY_DIST_WORLD` | 48 | PostTransition fades over this walk distance |
| `TRANSITION_REVEAL_EASE_SPEED` | 6.0 | Camera easing speed (higher = snappier) |


