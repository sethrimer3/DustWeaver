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
- Virtual canvas: 480×270 virtual pixels (fixed internal resolution).
- Device canvas: sized in **physical pixels** (`window.innerWidth * devicePixelRatio`),
  used only as upscale target. Its CSS size is always `100vw × 100vh` with
  `image-rendering: pixelated` (+ `crisp-edges` for Firefox) so the browser
  composites the element using nearest-neighbor — no browser-level blur.
  The backing store (HTML width/height attributes) is set to physical pixels so
  `drawImage` fills the entire physical screen without a secondary browser scale.
- Scale: 1 world unit = 1 virtual pixel at zoom 1.0.
- Camera zoom: 1.0 (1 world unit = 1 virtual pixel).
  Camera follows player, clamped to room bounds so viewport never shows void.
- Upscale: `deviceCtx.drawImage(virtualCanvas, 0, 0, w, h)` with
  `imageSmoothingEnabled = false` for crisp nearest-neighbor sampling.
  At 1080p (1920×1080 physical) the scale factor is exactly 4× per virtual pixel.
- WebGL particle canvas also renders at 480×270 and is composited onto the
  device canvas during the upscale pass.

## Metroidvania Room System (BUILD 24)
- Game uses interconnected rooms instead of a level-select world map.
- Player spawns in a central lobby (world 0) with tunnels leading left (world 2)
  and right (world 1).
- Rooms are defined in block-unit coordinates (currently 1 block = BLOCK_SIZE_SMALL = 8 world units).
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

## Player Movement Physics (BUILD 38 — Celeste-inspired retune)

### Gravity Model
Replaced the dual rise/fall gravity split with a unified normal gravity (900 px/s²).
Rise/fall asymmetry is now achieved through:
- Jump-cut gravity multiplier (2.5×) when rising with jump released
- Apex half-gravity (0.5×) when abs(vy) < 50 px/s and jump is held
- Normal fall cap (160 px/s) + fast fall cap (240 px/s, smooth approach at 300/s)

### Jump Physics
- Normal gravity: 900 px/s²
- Jump velocity: 300 px/s (applied upward)
- Variable jump sustain: 0.20 s window where holding jump prevents gravity from
  decaying past the launch speed — creates expressive short hops vs full jumps.
- Apex half-gravity: gravity × 0.5 when abs(vy) < 50 and jump held — brief float.

### Jump-Cut (Variable Jump Height)
Jump-cut gravity multiplier (2.5×) still applied while rising with jump released.
Now works alongside the variable jump sustain system (sustain cancelled on release).

### Fall System
Two-stage terminal velocity replaces the old single 240 px/s cap:
- Normal max fall: 160 px/s (default)
- Fast max fall: 240 px/s (when holding down, smooth approach at 300/s)

### Horizontal Movement
Direct acceleration model preserved. Retuned values:
- Ground acceleration: 1200 px/s²
- Ground deceleration: 1500 px/s²
- Air acceleration:    780 px/s²
- Air deceleration:    900 px/s²
- Turn acceleration:   2200 px/s² (when reversing direction)
- Max run speed:       105 px/s

### Player Hitbox
Changed from 8×12 to 8×10 px (halfWidth=4, halfHeight=5). Player size constants
are exported from `src/levels/roomDef.ts` as PLAYER_WIDTH_WORLD=8,
PLAYER_HEIGHT_WORLD=10, PLAYER_HALF_WIDTH_WORLD=4, PLAYER_HALF_HEIGHT_WORLD=5.

### Wall Slide
Wall slide descent capped at 25 px/s (reduced from 80) for deliberate, readable
Celeste-like wall interaction.

### Wall Jump
Retuned for anti-climb: 220 px/s horizontal + 220 px/s vertical (down from 320).
Strong outward push paired with a 10-tick force-time window (~0.16 s) during which
horizontal input is overridden by the launch direction.  12-tick lockout (~0.20 s)
prevents immediate re-grab.  Net effect: wall jumping off the same wall repeatedly
returns the player to roughly the same height or slightly lower.

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
- Proximity detection radius: 3 blocks (3 × BLOCK_SIZE_MEDIUM world units).
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
### Block Size Constants (BUILD 45)
`BLOCK_SIZE_WORLD` (previously 11.25) replaced with three canonical constants,
updated from the BUILD 44 values (3/6/12) to the new standard:
- `BLOCK_SIZE_SMALL  = 8`  → 8×8 virtual px, 32×32 physical px @ 4×
- `BLOCK_SIZE_MEDIUM = 8`  → temporary alias of small tier while medium tier is disabled
- `BLOCK_SIZE_LARGE  = 8`  → temporary alias of small tier while large tier is disabled

At zoom 1.0 with 480×270 virtual canvas: 60 small blocks horizontally, 33.75 vertically.
All room definitions remain in block units and are converted at load time.

Player size constants are now exported from `src/levels/roomDef.ts`:
- `PLAYER_WIDTH_WORLD = 8`, `PLAYER_HEIGHT_WORLD = 10`
- `PLAYER_HALF_WIDTH_WORLD = 4`, `PLAYER_HALF_HEIGHT_WORLD = 5`

The obsolete 30×30 tile model is fully removed. All block sizing uses the three-tier
system above. Particle radius updated to 4/6 ≈ 0.667 world units (1/6 of player width).

### Collision System Rewrite (BUILD 44)
**Wall merging**: At room load time, contiguous axis-aligned wall rectangles are
iteratively merged into single AABBs. This eliminates internal seam edges that
caused ghost collisions when the player walked across adjacent blocks.

**Axis-separated sweep**: `resolveClusterSolidWallCollision` rewritten with a
strict two-pass approach:
1. **X pass**: integrate posX, resolve all X-axis overlaps, zero velX on contact.
2. **Y pass**: integrate posY, resolve all Y-axis overlaps, zero velY on contact,
   set isGroundedFlag on top-surface landing.
The passes are completely independent — X and Y resolution never mix. The old
minimum-penetration fallback is removed as the primary resolver; each axis has
its own directional fallback for edge-case overlaps (e.g. spawn inside a wall).

**Epsilon guards**: `COLLISION_EPSILON = 0.5` world units applied to all sweep
boundary checks to absorb floating-point error across ticks.

**Sub-tick safety**: Each axis pass is sub-stepped when the movement distance
exceeds half the cluster's dimension on that axis. This prevents tunneling
through thin walls (BLOCK_SIZE_SMALL = 8 units) at dash speed (~9 units/tick).

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

## Weave Combat System (BUILD 39)

### Design Philosophy
- **Old model**: Left click = attack (per-dust-type pattern), Right click = block (per-dust-type shield)
- **New model**: Left click = Primary Weave, Right click = Secondary Weave
- Dust type governs passive motion + elemental identity. Weave governs active combat form.

### Key Separation
- **Dust types** define: passive ambient motion, visual theme, elemental interactions, slot cost
- **Weaves** define: active deployment pattern, duration, cooldown, slot capacity
- The same Weave always produces the same recognizable shape regardless of dust type

### Weave Types (Initial Set)
- Aegis Weave: orbiting shield ring (sustained)
- Bastion Weave: directional wall (sustained)
- Spire Weave: straight line shot (burst, 45 ticks)
- Torrent Weave: cone spray (burst)
- Comet Weave: compressed projectile (burst)
- Scatter Weave: outward explosion (burst)

### Loadout Structure
- PlayerWeaveLoadout contains primary + secondary WeaveBinding
- Each WeaveBinding has a weaveId and an array of bound ParticleKinds
- Slot costs are per-dust-type (defined in dustDefinition.ts)
- Slot capacity is per-Weave (defined in weaveDefinition.ts)

### Behavior Modes (Extended)
- Mode 0: Passive orbit (dust-type motion from ElementProfile)
- Mode 1: Legacy attack (enemy AI only)
- Mode 2: Legacy block (enemy AI only)
- Mode 3: Weave active (particle executing a Weave pattern)
- Mode 4: Returning (transitioning back to passive orbit)

### Input Mapping
- Left click quick release = burst primary Weave (or sustained trigger)
- Left click hold = sustained primary Weave
- Right click quick release = burst secondary Weave
- Right click hold = sustained secondary Weave
- Hold threshold: 200ms (matches old attack/block threshold)

### Particle Buffer
- New `weaveSlotId` Uint8Array tracks which Weave slot each particle is bound to
- 0 = unbound (enemies, background), 1 = primary, 2 = secondary
- Set at spawn time based on PlayerWeaveLoadout

### Enemy Combat
- Enemies still use the legacy attack/block system (modes 1/2)
- Enemy combat forces in combat.ts are unchanged
- Player combat forces now come from weaveCombat.ts (step 4.55 in tick pipeline)

### Tuning Locations
- Passive dust motion: `sim/particles/elementProfiles.ts`
- Dust slot costs: `sim/weaves/dustDefinition.ts`
- Weave slot capacities: `sim/weaves/weaveDefinition.ts`
- Weave behavior tuning: `sim/weaves/weaveCombat.ts`
- Default loadout: `sim/weaves/playerLoadout.ts` (createDefaultWeaveLoadout)

## Brown Rock Cave Content (BUILD 41)

### World 0 Background
- World 0 now uses `SPRITES/BACKGROUNDS/brownRock_background_1.png` as its tiled background.
- Procedural background generation has been removed. All worlds use image-based backgrounds.
- If an image is not yet loaded, a solid fallback colour is drawn (no procedural textures).
- World 0 fallback colour: `#2a1a0e` (brown-rock cave).

### Brown Rock Block Sprites
- World 0 block auto-tiling uses brown-rock sprites from `SPRITES/BLOCKS/brownRock/`.
- Four variants available: `brownRock_block_1.png` (block/vertex), `brownRock_block_2.png` (edge/corner),
  `brownRock_block_3.png` (single/end), `brownRock_block_large_1.png` (2×2 editor palette).
- Editor palette includes all 4 brown rock blocks with correct dimensions.

### Rock Elemental Enemy
- New enemy type: `isRockElementalFlag` on `RoomEnemyDef` and `ClusterState`.
- 7 states: inactive (0), activating (1), active (2), evading (3), attacking (4), regenerating (5), dead (6).
- AI module: `sim/clusters/rockElementalAi.ts`
- Dust orbit/projectile module: `sim/clusters/rockElementalDust.ts`
- Tick pipeline: steps 0.5b (AI) and 0.5c (dust) after `applyEnemyAI`.
- Movement: hover physics with reduced gravity (200 vs 900) in active states.
- Dust uses `ParticleKind.Earth` particles, orbiting at 36 wu radius.
- Orbit → projectile conversion uses existing `behaviorMode=1` attack damage flow.
- Composite rendering: head + 2 arm sprites with deactivated/activated variants.

### Rock Elemental Tuning Constants
- Activation range: 180 wu
- Activation duration: 30 ticks (0.5 s)
- Preferred distance: 140 wu
- Evade threshold: 80 wu
- Max hover height: 40 wu
- Leash radius: 220 wu
- Max dust: 12
- Orbit radius: 36 wu
- Regen interval: 48 ticks (0.8 s)
- Projectile speed: 220 wu/s
- Projectile lifetime: 180 ticks (3 s)
- All constants in `sim/clusters/rockElementalAi.ts`.

### Lobby Remake
- Lobby room "Stone Hollow" (48×24 blocks, world 0).
- Cave-shaped with uneven ceiling stalactites, irregular side wall insets, uneven floor.
- Central plateau: 8 blocks wide (x=20..28), top at row 19 (3 blocks above row 22 floor).
- Player spawn on plateau top at (24, 18).
- Skill tome on plateau at (26, 18), 2 blocks right of spawn.
- One Rock Elemental at (10, 20), >10 blocks from plateau center.
- Left/right tunnel transitions preserved at row 16.

## Radiant Tether Boss (BUILD 42)

### Boss Concept
- First boss: floating spherical entity made of light ("Radiant Tether").
- Uses rotating laser telegraphs followed by chains of light anchored to walls.
- Boss moves by changing chain lengths (winch behavior).
- Chain count scales 3→8 as health drops (threshold-based).

### Boss Room
- 60×60 block square chamber ("Luminous Chamber"), world 1.
- Accessible from W1 Room 1 via right tunnel.
- Thick walls on all sides for reliable chain anchoring.
- Small platforms for player cover/parkour.
- Boss spawns at block (30, 20) with Holy + Lightning particles.

### Attack Loop Phases
1. **Telegraph** (90 ticks / 1.5s): Thin laser lines rotate around boss.
2. **Lock** (30 ticks / 0.5s): Lasers freeze for player reaction.
3. **Firing** (6 ticks / ~instant): Chains raycast to wall anchors.
4. **Movement** (300 ticks / 5s): Boss winches via tighten/loosen chains.
5. **Reset** (30 ticks / 0.5s): Retract chains, prepare next cycle.

### Chain System
- Chains fire along evenly-spaced angles (e.g., 4 chains = 90° apart).
- Each chain raycasts from boss to nearest wall in its direction.
- Retry with slight angle offsets if a direction misses terrain.
- Visual: parabolic sag approximation (not full rope sim) for performance.
- Damage: player takes 1 HP on chain contact + 60 ticks iframes.
- Telegraphs do NOT deal damage.

### Opposing-Chain Snap
- When two chains are ~180° apart and both tightening with high tension,
  they snap off the boss and swing from their wall anchors as broken chains.
- Tunable thresholds: opposing angle tolerance (0.35 rad), straightness
  threshold (0.92), tension ratio (0.55).
- Broken chains persist as environmental hazards for 240 ticks (4s).

### Chain Count Health Thresholds
- ≥85% HP → 3 chains
- ≥70% HP → 4 chains
- ≥55% HP → 5 chains
- ≥40% HP → 6 chains
- ≥25% HP → 7 chains
- <25% HP → 8 chains

### Movement Physics
- Boss has zero gravity (fully floating).
- Position/velocity controlled by chain tension forces.
- Boss bounces softly off room boundaries.
- Standard enemy AI is skipped (dedicated state machine).

### Files
- Config: `sim/clusters/radiantTetherConfig.ts` (all tunable constants)
- AI state machine: `sim/clusters/radiantTetherAi.ts`
- Chain system: `sim/clusters/radiantTetherChains.ts`
- Renderer: `render/clusters/radiantTetherRenderer.ts`
- Room: `levels/rooms.ts` (ROOM_BOSS_RADIANT_TETHER)
- Particle kind: `ParticleKind.Light` (kind 19)

## Player Movement Overhaul (BUILD 59)

### Speed Changes
- Walk speed: 70 → 105 (+50%)
- Jump speed: 200 → 300 (+50%)
- Gravity: 600 → 900 (+50%)
- Normal fall cap: 107 → 160.5 (+50%)
- Fast fall cap: 160 → 240 (+50%)
- Sprint multiplier: 2.0x → 1.5x (relative to already-increased base)

### Shift Mechanics
- Holding shift increases run speed by 50% (sprint multiplier 1.5x)
- Holding shift decreases ground friction by 50%
- Skidding: when sprinting and moving opposite to facing direction, spawn
  debris particles (1×1 px) from bottom-front corner, increase friction by 50%
- Skid jump: jumping while skidding boosts jump height by 50%

### Down Key Behavior
- Holding down without shift blocks left/right acceleration (no movement)
- Holding shift+down = sliding (normal movement is allowed)

### Grapple Hook Miss
- When raycast hits no wall, chain extends to full influence radius
- Chain links have heavy inertia (gravity + drag) and fall limp
- Links stay connected via distance constraints
- If tip link hits a surface, grapple attaches there
- Auto-cancels after 90 ticks if nothing is hit

### Debug Speed Panel
- All player speed constants are exposed as editable textboxes in the debug panel
- Debug panel appears when debug mode is toggled on (via pause menu)
- Values written to `debugSpeedOverrides` in `movement.ts` for live playtesting

### Level Editor Resolution Fix
- Editor mouse coordinates now properly convert from device pixels to
  virtual canvas coordinates (480×270) before computing world positions
- Editor passes device and virtual canvas dimensions through the update pipeline
