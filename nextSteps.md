# DustWeaver — Next Steps

## BUILD 289 — Zip Cancel-Jump Fix & Weak Wall Jump Debris Cascade

### What Was Implemented in BUILD 289

1. **Zip cancel-jump vs true zip-jump distinction** (`grappleZip.ts`): pressing jump during zip travel now preserves zip velocity + adds an upward boost instead of bouncing away from the grapple point. True zip-jump (surface-normal super-launch) is gated to the stuck phase only.
2. **Weak wall jump debris cascade** (`weakWallJumpDebrisRenderer.ts`, `playerMovement.ts`, `world.ts`): spawns ~15 heavy debris chips from the wall surface on the 3rd+ consecutive wall jump, with simplified AABB wall-bounce physics and a rate-limited audio stub.

### Remaining work (BUILD 289 pass — not done)

#### 1. Wire `_playSoftDebrisThud` to real audio
**File:** `src/render/weakWallJumpDebrisRenderer.ts`, function `_playSoftDebrisThud`  
**Issue:** The debris-impact thud sound is currently a no-op stub.  
**Recommended fix:** Wire to the existing audio synthesis / SFX manager once a suitable short-impulse sound is available. The rate-limiter (≤ 4 thuds per 9-tick window) is already in place.  
**Risk:** Low — stub is a drop-in; no behaviour changes needed.

#### 2. Ramp surface interaction for cascade debris
**File:** `src/render/weakWallJumpDebrisRenderer.ts`, wall-collision loop  
**Issue:** The debris particle collision check skips ramp walls (`wallRampOrientationIndex[wi] !== 255`). Particles fly through ramp surfaces.  
**Recommended fix:** Use the existing ramp-slope helpers from `movementCollision.ts` (or a simplified dot-product slope check) to slide debris down ramp surfaces instead of passing through.  
**Risk:** Medium — ramp collision geometry differs from AABB; needs careful porting to render layer.

#### 3. Persistent zip impact visual indicator (non-debug HUD)
**File:** `src/screens/gameHudRenderer.ts` or similar  
**Issue:** The `hasZipImpactedSurfaceFlag` is only visible in debug mode via the overlay.  
**Recommended fix:** Consider a brief on-screen flash or icon to communicate "zip impact ready" vs "zipping" to the player without requiring debug mode.  
**Risk:** Low — purely visual / HUD layer.

---

## BUILD 288 — Rendering Pipeline Optimization

### What Was Implemented in BUILD 288

See below for details. New remaining work also appended here.

---

## Remaining work (BUILD 288 pass — not done — too risky or too large)

### 1. Environmental dust spatial partitioning
**File:** `src/render/environmentalDust.ts`  
**Issue:** The update path's wall-collision check may iterate all room walls for every active particle (`O(particles × walls)`). In large rooms with many walls this can be costly.  
**Recommended fix:** Add a coarse grid (cell size ≈ 4× particle radius) keyed by cell position. Each frame, look up only the ~4 neighbouring cells instead of iterating all walls. Similar to `src/sim/spatial/`.  
**Risk:** Behavioural change if grid boundary handling is wrong. Worth a separate PR.

### 2. Decoration viewport culling in `renderDecorationSprites`
**File:** `src/render/effects/wallDecorations.ts`  
**Function:** `renderDecorationSprites`  
**Issue:** Iterates `cachedDecorations` without a bounds check against the viewport. For rooms with hundreds of decorations this loops through all of them every frame.  
**Recommended fix:** Add a world-space bounds check using `ox, oy, zoom, vpW, vpH` before calling `ctx.drawImage`.  
**Risk:** Low — purely cosmetic, no gameplay.

### 3. Rope viewport culling
**File:** `src/render/ropes/ropeRenderer.ts`  
**Issue:** All ropes rendered regardless of on-screen position.  
**Recommended fix:** Add a simple AABB check per rope against the viewport.

### 4. Hazard and liquid culling
**File:** `src/render/hazards.ts`, `src/render/liquidRenderer.ts`  
**Issue:** Liquid body merged-rects are rendered without per-rect viewport culling.  
**Recommended fix:** Skip merged rects fully outside the viewport.

### 5. Chunk cache memory cap — wire to quality settings
**File:** `src/render/walls/chunkRenderCache.ts`, `src/screens/gameScreen.ts`  
**Issue:** `RoomChunkCache.setMaxMemoryKB()` exists but is not called by default.  
**Recommended fix:** Call `bgChunkCache.setMaxMemoryKB(8192)` (8 MB) on Medium quality and `16384` on High; call from `gameScreen.ts` when `graphicsQuality` changes.

### 6. Grapple influence visual culling
**File:** `src/render/grappleInfluenceRenderer.ts`  
**Issue:** Draws edge-glow and circle regardless of whether the influence area intersects the viewport.  
**Recommended fix:** Add a viewport intersection check before the arc draws.

### 7. Save tomb / skill tomb effect culling
**Files:** `src/render/skillTombRenderer.ts`, `src/render/skillTombEffectRenderer.ts`  
**Issue:** All tombs and their particle effects are rendered regardless of camera position.  
**Recommended fix:** Add a world-space distance check to skip tombs outside the viewport.

### 8. Atmospheric light dust density with adaptive quality
**File:** `src/render/effects/atmosphericLightDust.ts`  
**Issue:** Tier-1 adaptive reduction halves `maxDustMoteCount` but does not reduce dust *density* per light (only the cap on total motes). In rooms with many light sources the per-source emission rate could be reduced.  
**Recommended fix:** Pass a `densityMultiplier` (0.5 for tier-1) to `AtmosphericLightDust.render()`.

### 9. Sunbeam density with adaptive quality tier-1
**File:** `src/render/effects/sunbeamRenderer.ts`  
**Issue:** Tier-1 only disables bloom, not sunbeam dust density. Tier-2 already disables sunbeams entirely; but tier-1 could reduce sunbeam particle density for a graceful intermediate step.  
**Recommended fix:** `SunbeamRenderer.setDensityMultiplier(0.5)` for tier-1.

### 10. Large-room stress-test room
**Suggested:** Create a dedicated dev/test room (`rooms/dev_stress_large.json`) with:
- 120×80 blocks of mixed wall types (black rock + sand + snow)
- 200+ decorations
- 30+ background block definitions covering 60% of the floor
- 10+ dust containers, 5 dust swarms
- 4 sunbeam emitters
This room will make profiler readings comparable across builds and validate that chunk rebuild performance scales correctly.

---



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
