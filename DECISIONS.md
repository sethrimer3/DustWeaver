# DustWeaver — Design Decisions

## RNG
- Using xoshiro128** PRNG seeded with a fixed integer.
- All sim randomness routes through `sim/rng.ts`.
- Never use `Math.random()` in sim code.

## Tick Rate
- Fixed timestep: 16.666ms per tick (~60 ticks/sec).
- Accumulator pattern for frame-rate independence.

## Coordinate System
- World space: floating-point units.
- Screen space: pixels.
- Scale: 1 world unit = 1 pixel at default zoom.
- Camera zoom: default 2× (1 world unit = 2 screen pixels at default zoom).
  Camera follows player, clamped to room bounds so viewport never shows void.

## Metroidvania Room System (BUILD 24)
- Game uses interconnected rooms instead of a level-select world map.
- Player spawns in a central lobby (world 0) with tunnels leading left (world 2)
  and right (world 1).
- Rooms are defined in block-unit coordinates (1 block = 30 world units).
- Room transitions are open tunnel passages at room edges; blocks line the
  tunnel ceiling/floor and a darkness gradient fades to 100% black at the edge.
- When the player enters a transition zone, the current room is unloaded and
  the target room is loaded with the player at the corresponding spawn point.
- Per-world block sprites: W-0 for world 0, W-1 for world 1, W-2 for world 2.
- Per-world background colours: world 0 = pale dark green (#0d1a0f),
  world 1 = deep dark green (#051408), world 2 = dark blue (#080c1a).

## Float vs Fixed-Point
- Using 32-bit floats (Float32Array) for particle buffers.
- Acceptable precision for this simulation scale.

## Spatial Partitioning
- Spatial hash grid in `sim/spatial/grid.ts`.
- Cell size = 2× repel range to minimize multi-cell lookups.

## Rendering
- HTML Canvas 2D for initial implementation.
- WebGL upgrade path available if Canvas 2D performance is insufficient.

## WebGL Particle Shaders
- Particle rendering upgraded to WebGL (WebGL1 + `experimental-webgl` fallback).
- Approach: single `gl.drawArrays(gl.POINTS, N)` call per frame — all alive
  particles rendered as point sprites in one GPU draw.
- Shader design:
  - Vertex shader transforms world-space (x, y) to clip space via a
    `u_resolution` uniform; sets `gl_PointSize` for the sprite footprint.
  - Fragment shader uses `gl_PointCoord` to compute a radial glow falloff
    (`pow(1 − dist, 1.8)`) plus a tight bright core
    (`pow(max(0, 1 − dist × 3), 2.5)`).  No texture lookup needed.
  - Per-particle colour (cyan = player, red = enemy) encoded as a single
    `a_isPlayer` float attribute; GLSL `mix()` selects the colour.
- Blending: `gl.blendFunc(SRC_ALPHA, ONE)` — additive.  Overlapping particles
  accumulate into natural bloom without a post-process pass.
- GPU buffer pre-allocated at `MAX_PARTICLES` capacity; each frame uploads only
  the alive-particle slice via `gl.bufferSubData` (≤ 6 KB at 512 particles).
- Canvas layering: WebGL canvas sits behind the 2D game-canvas (DOM insertion
  order).  2D canvas calls `clearRect` each frame so transparent pixels expose
  the WebGL layer.  Clusters, HUD, and UI text remain on the 2D canvas.
- Graceful degradation: if WebGL context creation or shader compilation fails,
  `WebGLParticleRenderer.isAvailable` is `false` and the caller falls back to
  the existing Canvas 2D arc-based renderer — no code path removed.

## Bundler
- Vite with TypeScript.
- Entry: `src/main.ts`.

## Elemental Particle Behavior System

### Force Layering
Particle forces are accumulated from four independent passes per tick:
1. **Element forces** (`elementForces.ts`): per-particle hash-noise (direction
   determined by `floor(tick × instability)` so `instability=1` changes every
   tick and `instability=0.02` changes every ~50 ticks), curl-noise turbulence
   (approximated from a scalar potential), isotropic diffusion, and a constant
   upward-bias.
2. **Binding forces** (`binding.ts`): spring toward each particle's individual
   anchor point (set at spawn as an offset from the owner center); plus a
   constant-magnitude tangential force driving orbit.
3. **Inter-particle boid forces** (`forces.ts`): cohesion, separation, alignment
   with same-owner neighbors; repulsion + destruction with different-owner.
4. **Drag** applied in integration before Euler step.

### Noise Determinism
A pair of integer-multiply-xorshift hash functions are used instead of consuming
the shared PRNG for per-tick noise.  This gives identical noise per (particleIndex,
tick, noiseTickSeed) regardless of processing order, making the sim reproducible
without the fragility of a shared PRNG consumed in a hot loop.

### Lifetime / Respawn
Particles have `ageTicks` and `lifetimeTicks`.  When they expire they respawn at
their owner with a fresh random anchor angle/radius — keeping particle count
constant and element character persistent.  Short-lived elements (fire, lightning)
feel like they flicker and regenerate rapidly; long-lived elements (ice, physical)
feel persistent and stable.

### Performance (Elemental System)
- Boid neighbor range (36 world units) larger than inter-cluster repulsion range
  (20 world units); both handled in a single spatial-grid pass.
- Boid accumulators (_cohesionX, _alignX, …) are module-level Float32Arrays
  reset with `.fill(0)` each tick — no per-tick allocation.
- Hash noise: 2 multiply-xorshift ops per particle per tick (~500K/sec at 512
  particles × 60 fps) — negligible CPU cost.
- MAX_PARTICLES raised from 512 → 1024 to support richer elemental clouds.
  GPU buffer is pre-allocated at that capacity (1024 × 4 floats × 4 bytes = 16 KB).

### WebGL Vertex Format Change
Old: [x, y, isPlayer]  (3 floats)
New: [x, y, kind, normalizedAge]  (4 floats)
The `kind` drives element colour selection in the GLSL fragment shader.
`normalizedAge` (ageTicks / lifetimeTicks) drives alpha fade and point-size
shrink in the vertex shader — particles visually decay as they age out.

## Player Movement Physics (BUILD 22)

### Jump Physics
Jump constants are derived from explicit kinematic targets rather than guessed values:
- Target jump height: 60 px (2 standard 30 px blocks)
- Time to apex: 0.35 s
- Rise gravity = (2 × 60) / (0.35²) ≈ 979.6 px/s²
- Jump velocity = gravity × 0.35 ≈ 342.8 px/s (applied upward)
- Fall gravity: 1600 px/s² (stronger than rise for a snappier descent)

### Jump-Cut (Variable Jump Height)
Jump-cut uses an extra-gravity multiplier (2.5×) applied while the player is rising
with the jump key released, rather than clamping velocity on key release.  This gives
a smooth range of hop heights from a single button without abrupt velocity changes.

### Horizontal Movement
Switched from an exponential-blend (lerp) model to a direct acceleration model:
- Ground acceleration: 1200 px/s²
- Ground deceleration: 1500 px/s²
- Air acceleration:    900 px/s²
- Air deceleration:    1000 px/s²
- Turn acceleration:   2200 px/s² (when reversing direction)
- Max run speed:       140 px/s
Turn acceleration is applied any time the player pushes against their current
velocity direction; it is the same whether grounded or airborne.

### Player Hitbox
Changed from 8×12 to 10×10 px (halfWidth=5, halfHeight=5) to match the spec of
exactly one-third of a standard block (30 px) in each dimension.

### Wall Slide
When airborne, pressing into a solid (thick) wall while falling, the player enters a
wall slide.  Descent is capped at 80 px/s.  Disabled during the wall-jump lockout
window so the player has a moment of free flight after a wall jump.

### Wall Jump
Launch vector: 160 px/s horizontal (away from wall) + 320 px/s vertical (up).
A 20-tick lockout (~0.33 s) prevents immediately re-grabbing the same wall, which
also prevents infinite altitude climbing — by the time the lockout expires the
player is falling, not rising.

### Grapple Hook Rope Pull-In
Holding the jump button while grappling shortens the rope at 90 px/s, tightening
the swing radius.  Total pull-in is tracked; once it exceeds 150 px the rope snaps
and the player launches with accumulated momentum.  This creates a skill-ceiling
mechanic: skilled players can build large speed with careful timing, but the rope
will break under sustained tension.

### Grapple Hook Physics Overhaul (BUILD 26)

**Momentum preservation:** The player's velocity is never zeroed when the grapple
attaches.  The rope constraint only acts when taut (player beyond rope length),
removing the outward radial velocity component while preserving tangential motion.
This allows fast-moving players to carry momentum into wide, natural arcs.

**Angular momentum conservation on rope shortening:** When the rope is retracted,
tangential velocity is scaled by (oldLength / newLength), conserving angular
momentum (L = m × v × r).  This makes retraction feel like winding up for a
launch rather than an artificial speed boost.  The ratio is clamped to ≤ 1.1 per
tick to prevent extreme speed spikes on very short ropes.

**Swing damping:** A subtle tangential damping coefficient (0.12 per second)
slowly bleeds energy from the swing to simulate air resistance / rope friction.
Only the tangential component is damped so gravity is not penalised.  The effect
is barely noticeable within a single swing but becomes apparent after 3–4 full
oscillations.  The constant is exposed for tuning.

**Tap-jump vs hold-jump:** While grappling, the jump button serves dual purpose:
  - **Tap** (press + release within 6 ticks / ~100 ms): instantly releases the
    grapple and the player flies off with their current velocity.
  - **Hold** (held beyond 6 ticks): retracts the rope, building angular speed.
Retraction begins immediately on press for responsiveness; if released within the
tap window, the negligible retraction (~7 px) is imperceptible.  An ultra-fast
tap (pressed and released within a single frame) is detected separately via the
playerJumpTriggeredFlag.

**Gravity during grapple:** Consistent base gravity (rise gravity ≈ 980 px/s²)
is used for both rising and falling while grappling, instead of the asymmetric
rise/fall split and jump-cut multiplier used for normal platforming.  This
produces a symmetric, physically convincing pendulum arc.  Terminal velocity
capping is also skipped during grapple since the rope constraint limits
displacement each tick.

**Horizontal movement during grapple:** Platformer-style horizontal acceleration,
deceleration, and speed capping are skipped while the grapple is active.  All
motion is governed by the pendulum physics (gravity + rope constraint + damping).
This prevents the acceleration model from fighting against the swing.

## Skill Tomb Save Points (BUILD 27)
- Skill tombs are placed in rooms via `skillTombs` array in `RoomDef`.
- Uses `skill_tomb.png` sprite from `ASSETS/SPRITES/WORLDS/W-0/`.
- Proximity detection radius: 3 blocks (90 world units).
- Golden dust particles swirl around the tomb when the player is near;
  particles transition to dull gold and fall to the ground when the player leaves.
- Press F to interact: saves progress and opens the Skill Tomb menu.
- The Skill Tomb menu has two tabs: Loadout and World Map.
- Loadout tab replaces the old standalone loadout screen for returning players.
- World Map tab shows explored rooms in their relative positions with zoom/pan.

## Death Loop (BUILD 27)
- When the player's cluster `isAliveFlag` becomes 0, the sim freezes.
- A 50% dark overlay fades in, with the blurred goldEmbers animation playing
  at 50% opacity over it.
- "Dusts..." text and two buttons: "Return to Last Save" and "Return to Main Menu".
- "Return to Last Save" reloads the room/spawn of the last skill tomb used.

## Game Flow Changes (BUILD 27)
- New saves still show the loadout screen before gameplay.
- Returning saves (with explored rooms) skip the loadout screen and go directly
  to gameplay, spawning at the last save point.
- Loadout is now accessible through skill tomb interaction during gameplay.

## Font Convention (BUILD 27)
- All UI text uses Cinzel, Regular 400.
- Main menu title text uses text-transform: uppercase.


## BUILD 34 Changes

### Block Size Reduction
`BLOCK_SIZE_WORLD` reduced from 15 to 11.25 (25% smaller).  All room dimensions
(walls, enemy spawns, tunnel positions) are stored in block units and converted
to world units at load time, so the entire geometry shrinks proportionally.
Player and enemy physics constants (jump height, gravity, speed) remain in
absolute world units and are therefore unaffected by the block size change —
the player effectively becomes larger relative to each block.

### Jump Height Reduction
`JUMP_HEIGHT_WORLD` reduced from 60 to 40 world units.  Derived constants
(rise gravity, jump velocity) are recomputed automatically:
- Rise gravity = (2 × 40) / (0.40²) = 500 px/s²
- Jump velocity = 500 × 0.40 = 200 px/s (upward)
The jump arc is noticeably shorter and snappier.

### Grapple Bug Fix (Immediate Release on Attachment)
Root cause: when the player pressed jump on the same animation frame as firing
the grapple, `playerJumpTriggeredFlag` was set to 1 in gameScreen.ts AFTER
`fireGrapple` ran.  On the first sim tick, `applyClusterMovement` skipped the
normal jump path (grapple active), leaving the flag set.
`applyGrappleClusterConstraint` then saw `jumpJustPressed=1` and
`playerJumpHeldFlag=0` and treated it as an ultra-fast tap-release, immediately
detaching the grapple.

Fix: `fireGrapple` now clears `playerJumpTriggeredFlag` immediately after
attaching so that any jump input that coincides with the fire frame is
discarded rather than being consumed by the constraint on the next tick.

Secondary fix: the anchor is now placed at the exact raycast surface hit point
(`hit.x/hit.y`) instead of `player + dir * clampedDist`.  If the wall is
closer than `GRAPPLE_MIN_LENGTH_WORLD` the grapple no longer fires at all
(previously it would embed the anchor inside the block geometry).

### Grapple Tap-Jump Hop
Tapping jump while grappling now adds an upward velocity impulse
(`GRAPPLE_TAP_HOP_SPEED_WORLD = 80 px/s`) before releasing the grapple.  Both
the ultra-fast tap path and the regular tap path (held ≤ 6 ticks) apply the hop.
The impulse is always applied additively (velocityYWorld -= 80): if the player is
already moving upward at 100 px/s (velocityYWorld = -100), the result is -180 px/s,
further increasing upward speed.

### Debug Hitbox Rendering
`renderWalls` now accepts an `isDebugMode` flag.  When enabled, a dashed red
outline (`rgba(255,60,60,0.75)`) is drawn over every wall AABB so developers
can verify the collision boundary matches the visual tile geometry.

## World Editor (BUILD 35)

### Editor Architecture
- The editor is a modular system under `src/editor/` with a single integration
  point in `gameScreen.ts` via `EditorController`.
- When active, the editor takes over the frame loop: gameplay input is suppressed,
  the camera becomes free-moving (WASD), and editor overlays are drawn on top of
  the frozen game world.
- The editor operates on authored room data (`EditorRoomData`), which is the
  source-of-truth for level content. Runtime `WorldState` is rebuilt from this
  data via `editorRoomDataToRoomDef()` when needed.

### JSON Export Format
- Room data is exported as `RoomJsonDef` (clean, human-readable JSON).
- Enemy particle kinds use string names (e.g. `"Fire"`, `"Ice"`) rather than
  numeric enum values for readability and stability.
- Boundary walls and tunnel wall geometry are **not serialized** — they are
  regenerated deterministically from room dimensions and transition definitions
  at load time by `editorRoomDataToRoomDef()`.
- The schema captures: id, name, worldNumber, widthBlocks, heightBlocks,
  playerSpawnBlock, interiorWalls, enemies, transitions, skillTombs.

### Compatibility Strategy
- Existing TypeScript-authored rooms in `levels/rooms.ts` remain untouched.
- The editor can export any room to JSON and a JSON loader path exists via
  `jsonToEditorRoomData()` → `editorRoomDataToRoomDef()`.
- Full migration of all rooms to JSON is deferred to a future decision.

### Transition Linking
- The editor supports a "Link Transition" workflow: select a transition,
  click Link, pick a destination room from the world map, then click the
  target transition to complete the link.
- This updates `targetRoomId` and `targetSpawnBlock` on the source transition.

### Up/Down Transitions
- The editor and JSON schema support `up` and `down` transition directions in
  their data models (EditorTransition, RoomJsonDef, RoomTransitionDef).
- Runtime tunnel wall generation currently only handles `left` and `right`
  directions. Up/down tunnel walls will be added when the first up/down
  transition is needed in gameplay. The editor and export format are already
  structured to support this without schema changes.
