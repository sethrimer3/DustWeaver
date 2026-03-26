# DustWeaver

## Comprehensive Gameplay + Codebase Description (for AI Agents)
DustWeaver is a **single-player, deterministic, top-down action RPG / arena battler** where every character is a **cluster of physically simulated particles**. The player progresses through menu → world map → loadout → level gameplay, clears enemy encounters in wave-like arena fights, then unlocks additional levels/worlds. The simulation is fixed-step and deterministic, the rendering is snapshot-based, and gameplay emerges from layered particle-force systems plus cluster-level combat inputs.

### 1) Core player fantasy and high-level loop
- You control one cluster (the hero core + orbiting particles) in a bounded arena.
- Enemies are also clusters made of particles, with their own kinds/behaviors and HP.
- Combat is about movement, dashing, directional attacks, directional blocking, and elemental loadout composition.
- Particles collide, repel, orbit, age, respawn, and can be destroyed by enemy contact/abilities.
- A level is won when all enemy clusters are dead; after a short victory delay, the game returns to the world map and unlock progression.

### 2) Game flow and progression structure
- **Main Menu**: starts the run.
- **World Map**: shows available levels by world; includes locked/unlocked gating.
- **Loadout Screen**: player chooses a set of particle element kinds used to spawn the hero cluster.
- **Gameplay Screen**: runs fixed-timestep simulation + rendering until ESC/MAP exit or level completion.
- **Progression rules**:
  - Completing the current frontier level unlocks the next level in that world.
  - Completing the final World 1 level unlocks World 2.
  - Unlock counts are tracked in player progress state.

### 3) Input model and moment-to-moment controls
- **Desktop**:
  - `WASD` = move direction (cluster-level movement input).
  - `SPACE`/`SHIFT` = dash (direction from movement vector or cursor fallback).
  - Mouse click/tap = directional attack trigger (one-shot launch behavior).
  - Mouse hold = directional block (shield shaping/defensive posture while held).
  - `ESC` = return to map.
- **Touch**:
  - Virtual left-thumb joystick for movement.
  - Secondary touch actions for attack/block.
  - On-screen MAP button to exit gameplay.
- Input is collected into command objects each frame, then translated into world state flags/vectors consumed by deterministic sim ticks.

### 4) Simulation architecture and determinism model
- Fixed timestep (`~16.666ms`, ~60 Hz) with accumulator.
- Integer tick counter advances simulation; no wall-clock APIs in sim logic.
- Seeded deterministic RNG (`sim/rng.ts`) is used for spawn/respawn/randomized variation.
- Simulation (`sim/`) is pure logic (no DOM/render dependencies).
- Render reads only a `WorldSnapshot` view generated from sim state.
- Given same initial state + same commands, behavior is intended to be reproducible.

### 5) World and entity model
- **WorldState** holds:
  - Particle buffers (typed-array style data for position, velocity, force, kind, owner, lifetime, etc.).
  - Cluster list (player + enemies, HP/alive state, movement/combat-relevant fields).
  - World dimensions.
  - Wall/obstacle rectangle buffers.
  - Player combat input flags/vectors (attack, block, dash, movement).
- **Clusters** are gameplay entities (player/enemies) built from many particles.
- **Particles** are the primary physical units and the source of most emergent behavior.

### 6) Full tick pipeline (mechanics ordering)
Per sim tick, the game executes layered systems in a specific order:
1. Cluster movement smoothing/accel/decel (+ dash handling).
2. Enemy AI decisions (attack/block/dodge intent).
3. Force reset.
4. Per-element forces (noise, turbulence/curl-like motion, diffusion, buoyancy/up-bias).
5. Fluid disturbance pass (ambient fluid reacts to nearby fast motion).
6. Binding/orbit forces (spring toward anchor + tangential orbital drive).
7. Combat force pass (attack launch impulses + block shield positioning behavior).
8. Lava AoE pass (heat/burn effect against nearby enemies).
9. Inter-particle interactions (same-owner boid-like cohesion/separation/alignment; cross-owner repulsion/contact outcomes).
10. Wall repulsion force pass.
11. Integration (Euler + drag).
12. Wall bounce/reflection pass (with damping; stone shatter handling).
13. Lifetime aging + respawn/cycling logic.
14. Tick increment.

This order is important because each pass consumes/modifies state produced by previous passes.

### 7) Particle mechanics in detail
- Particle properties include world position/velocity, accumulated force, mass, charge, ownership, element kind, durability, behavior mode, lifetime/age, and anchor orbit parameters.
- Particles belonging to clusters have owner-linked anchors (angle + radius) and are pulled toward those targets with spring-like force.
- Orbital tangential force makes particles circulate around owners rather than simply collapsing to center.
- Same-owner boid terms create swarm-like coherence.
- Enemy-owner vs player-owner interactions include repulsion and destruction mechanics affecting effective HP.
- Particle lifetime causes aging; expired particles respawn with new randomized anchor/lifetime/noise seeds, preserving total cloud feel.
- Background fluid particles fill arenas and respond via disturbance logic to motion energy in the scene.

### 8) Element system and loadout mechanics
- Element kinds are enumerated in `ParticleKind`; each maps to a profile in `elementProfiles`.
- A profile defines many coefficients (examples: mass, drag, orbit radius/strength, noise amplitude/instability, cohesion/separation/alignment weights, lifetime, toughness, special-effect tuning).
- Player loadout is a list of kinds; total player particle budget is distributed across selected kinds.
- Enemy definitions also specify kind sets and particle counts per cluster.
- Result: “build” identity comes from profile-weighted force behavior and survivability characteristics rather than discrete class abilities alone.

### 9) Combat model
- **Attack**: directional trigger; applies force/behavior changes that launch or bias offensive particle motion.
- **Block**: directional hold; sets a blocking state and direction used to shape defensive particle arrangement/response.
- **Dash**: short directional burst at cluster level, using input vector or aim fallback.
- **Contact attrition**: opposing particles can destroy each other; cluster health effectively tracks remaining survivability.
- **Boss durability**: boss-marked enemy clusters spawn with HP multiplier.
- **AoE interactions**: lava-related behavior can burn nearby enemies.

### 10) Level and environment systems
- Levels are data-driven (`LevelDef`): world number, level number, name/theme, enemy spawn definitions, and wall layouts.
- Wall geometry is stored in fixed-capacity world buffers and applied in both force and collision/bounce passes.
- Themes influence visual background/label presentation (e.g., water/ice/fire/lava/stone/metal/boss/physical).
- Victory condition checks all non-player clusters dead; triggers delayed completion banner and callback.

### 11) Rendering and presentation stack
- Hybrid renderer:
  - **WebGL layer** (if available) for high-volume particle point-sprite rendering with glow-like additive blending.
  - **Canvas 2D layer** for walls, clusters, HP bars, HUD overlay, control hints, and fallback particle rendering when WebGL is unavailable.
- Always-on HUD overlay reports FPS, frame time, and alive particle count.
- Snapshot boundary prevents render code from mutating simulation state.

### 12) Codebase map (practical orientation)
- `src/sim/` — deterministic simulation core.
  - `tick.ts` orchestrates system order.
  - `particles/` contains forces, integration, lifetime, combat, walls, disturbance, element definitions.
  - `clusters/` contains cluster movement, binding, and enemy AI.
  - `spatial/` contains partitioning/grid logic for neighbor queries.
- `src/render/` — rendering pipeline (WebGL + Canvas2D).
- `src/input/` — browser/touch input to command translation.
- `src/ui/` — HTML menu/map/loadout screens.
- `src/levels/` — level content definitions for worlds.
- `src/progression/` — unlock/loadout progression state.
- `src/screens/gameScreen.ts` — runtime loop integrating input, sim ticking, victory checks, and rendering.
- `src/game.ts` — top-level navigation state machine across app screens.

### 13) Performance-oriented design traits
- Typed-array-like particle buffers and capped capacities.
- Snapshot-based render boundary.
- Fixed update cadence.
- Spatial partitioning for neighbor interactions.
- WebGL batch rendering path for large particle counts.
- Overlay instrumentation to monitor runtime health in live play.

### 14) What another AI agent should assume when modifying this project
- Any gameplay change is likely a force/tick-order/profile interaction, not an isolated script event.
- Preserve determinism contracts (seeded RNG, fixed tick, no sim wall-clock randomness).
- Respect layer boundaries (`sim` pure; `render` read-only on snapshots).
- Verify both control paths (desktop and touch) when changing combat/input.
- If adding a new element kind, update both simulation profile and render coloring/shader mappings.
