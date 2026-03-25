# AI Agent Guidelines for DustWeaver

This document provides comprehensive guidelines for AI agents working on the DustWeaver codebase. DustWeaver is a single-player, physics-based RPG where the player and all enemies are composed of particles governed by particle physics. These rules are designed to maintain simulation integrity, rendering performance, and code quality.

---

## 1. Physics Simulation Integrity (Non-Negotiable)

The particle simulation must be consistent and reproducible. Given the same initial state and the same inputs, the simulation must evolve identically — critical for save/load, replays, and ability to test edge cases.

### Core Requirements

- **Hard separation**: `sim/` (physics/game logic) must never depend on `render/` or `ui/`.
- **No wall-clock time in simulation**: Use an integer `tick` and a fixed `dtMs` derived from tick rate. Never use `Date.now()` or `performance.now()` in simulation code.
- **All randomness is seeded**: Route all RNG through a single deterministic RNG in `sim/`. Never use `Math.random()` directly in simulation code.
- **Float discipline**: Prefer consistent float arithmetic. Avoid platform-dependent math functions in sim-critical paths. Document any float precision trade-offs in `DECISIONS.md`.
- **No DOM or browser APIs in sim**: `sim/` must be pure TypeScript logic with no browser dependencies.

### Particle Physics Rules

- Each particle has a canonical state: `position`, `velocity`, `force`, `mass`, `charge`, and any game-specific properties.
- All force accumulation and integration happens inside `sim/` each tick.
- Collision, attraction, repulsion, and binding interactions between particles must be applied deterministically and in a consistent order each tick.

---

## 2. Tech Stack Scope

### TypeScript First

- All core game code is TypeScript with **strict mode enabled**.
- No implicit `any`.
- JavaScript is only allowed for build tooling, vendor shims, or isolated leaf modules with documented justification.

### Rendering

- HTML Canvas (`<canvas>`) is the rendering target.
- WebGL may be used for particle rendering if Canvas 2D performance is insufficient — document this decision in `DECISIONS.md`.

### Build & Tooling

- Use a standard bundler (e.g., Vite or esbuild). Document the choice in `DECISIONS.md`.
- All source under `src/`. Entry point is `src/main.ts`.

---

## 3. Performance Pillar: Render Thousands of Particles

Particle rendering and physics are performance-critical. The game must support thousands of simultaneous particles with responsive physics and smooth animation.

### Rendering Requirements

- **Allocation-minimal per frame**: No per-frame object or array creation in hot paths.
- **Batch-friendly**: Group particle draws by type, material, or color where possible.
- **Decoupled from sim**: The renderer reads from a snapshot/readonly view of particle state. The sim writes only within `tick()`.
- **Data-oriented layouts**: Prefer struct-of-arrays (e.g., `Float32Array` for `x`, `y`, `vx`, `vy`) for particle position/velocity to enable efficient iteration and potential GPU upload.
- **Performance overlay**: Always maintain a lightweight overlay displaying FPS, frame time, and particle count. Do not remove it without a replacement.

### Physics Performance Requirements

- Pre-allocate particle buffers. Never `push()` to unbounded arrays in the hot loop.
- Use spatial partitioning (e.g., a grid or quadtree in `sim/spatial/`) for neighbor queries — do not use O(n²) brute force for large particle counts.
- Object pools: Use typed pools for temporary force vectors and collision results. Name them clearly: `forceVectorPool`, `collisionResultPool`.

---

## 4. Naming Guidelines (Must Follow)

### General Rules

- **State**: Use nouns — `position`, `velocity`, `health`, `charge`
- **Actions**: Use verbs — `move`, `attract`, `spawn`, `destroy`
- **Commands/inputs**: Use imperative verbs — `castAbility`, `movePlayer`, `applyForce`
- Avoid ambiguous abbreviations. If you abbreviate, document it in `DECISIONS.md`.

### Booleans

Booleans must start with `is`, `has`, `can`, `should`, or `needs`.

✅ Good: `isAlive`, `hasTarget`, `canMerge`, `shouldEmit`, `needsRepath`

❌ Bad: `alive`, `targeted`, `mergeable`

**Exception**: Performance-critical packed booleans may use numeric `0 | 1`, but must be suffixed with `Flag` and commented:
```typescript
isActiveFlag: 0 | 1  // Packed boolean for performance in particle buffer
```

### Counts / Indices / IDs

- Counts end with `Count`: `particleCount`, `enemyCount`
- Indices end with `Index` and are 0-based: `particleIndex`, `clusterIndex`
- IDs end with `Id` and are opaque handles (never treat as index): `entityId`, `abilityId`

### Units of Measure

Any numeric value representing a measurable quantity must include a unit suffix.

- **Time**: `Ms`, `Ticks`, `Sec` — prefer `Ms` or `Ticks`. Examples: `lifetimeMs`, `spawnTick`, `cooldownMs`
- **Distance**: `World` (simulation space) or `Px` (screen pixels). Examples: `radiusWorld`, `rangeWorld`, `offsetPx`
- **Angle**: `Rad` (preferred in code). Examples: `angleRad`, `emitDirectionRad`
- **Mass / Charge**: `Kg`, `Units` as defined in `DECISIONS.md`

Never mix unit systems in one function without explicit conversion helpers.

### Coordinate Spaces

Use suffixes to distinguish coordinate spaces:

- `Screen` — pixel coordinates on the canvas
- `World` — simulation coordinate space

Conversion helpers must be named explicitly:
- `screenToWorld(positionScreen: Vec2): Vec2`
- `worldToScreen(positionWorld: Vec2): Vec2`

### Particle & Entity Naming

- `ParticleState` — mutable sim-side particle data
- `ParticleView` / `ParticleSnapshot` — readonly render-side view
- `ClusterState` — a bound group of particles forming an entity (player, enemy)
- `ClusterView` — readonly render-side view of a cluster
- Particle type enums: `ParticleKind` (e.g., `ParticleKind.Core`, `ParticleKind.Shell`, `ParticleKind.Projectile`)

### Collections

- Arrays are plural nouns: `particles`, `clusters`, `activeForces`
- Maps include the key type: `particleById`, `clusterByEntityId`

### Mutability Signal

- Mutable sim state types end with `State`: `WorldState`, `ClusterState`, `ParticleState`
- Readonly views end with `View` or `Snapshot`: `WorldSnapshot`, `ParticleView`
- Functions that mutate start with verbs: `applyForce`, `spawnParticle`, `removeCluster`, `setVelocity`

---

## 5. Hot-Path Coding Rules

### Avoid Hidden Allocations

- No `Array.map`, `Array.filter`, or `Array.reduce` in physics or render hot loops.
- Use `for` loops over typed arrays.
- No `{}` or `[]` literals per particle per frame.
- No closures inside per-frame/per-particle loops.

### Typed Arrays for Particle Buffers

Use struct-of-arrays layout:
```typescript
// Preferred — cache-friendly, GPU-uploadable
const posX = new Float32Array(MAX_PARTICLES);
const posY = new Float32Array(MAX_PARTICLES);
const velX = new Float32Array(MAX_PARTICLES);
const velY = new Float32Array(MAX_PARTICLES);
```

### Math Helpers

- Keep math helpers pure and allocation-free.
- Use a shared `Vec2` scratch buffer for temporary calculations rather than allocating new vectors.
- Name scratch buffers explicitly: `scratchVec2A`, `scratchVec2B`.

---

## 6. Repository Structure

```
src/
  sim/           # Pure physics + game logic (no DOM, no canvas, no random, no Date.now)
    particles/   # Particle state, integration, forces
    clusters/    # Entity clusters (player, enemies) built from particles
    abilities/   # Ability logic applied to the sim
    spatial/     # Spatial partitioning (grid, quadtree)
    rng.ts       # Single deterministic seeded RNG — all sim randomness routes through here
    world.ts     # WorldState: root sim state
    tick.ts      # Main tick function
  render/        # Canvas/WebGL rendering — reads only Snapshots/Views from sim
    particles/
    clusters/
    effects/
    hud/
  input/         # Maps browser input events to game commands/actions
  ui/            # HTML UI overlays (menus, HUD elements outside canvas)
  abilities/     # Ability definitions referenced by both sim and ui (data only, no logic)
  heroes/        # Player character definitions (factory pattern, one file per hero)
  assets/        # Static assets
  main.ts        # Entry point
```

### Directory Responsibilities

- **`sim/`**: Pure deterministic logic. No DOM, canvas, audio, random, or time. Only deterministic calculations.
- **`render/`**: Optimized rendering. Never modifies sim state. Only reads `Snapshot`/`View` types.
- **`input/`**: Maps browser events to commands/actions. Does not directly modify sim. Produces command objects for the game loop.
- **`ui/`**: HTML overlays and menus. Does not modify sim directly.

---

## 7. Required Documentation

Maintain the following files:

- **`DECISIONS.md`**: Document critical design decisions — RNG choice, tick rate, coordinate system and scale, float vs. fixed-point decisions, spatial partitioning strategy, rendering approach (Canvas 2D vs. WebGL).
- **`ARCHITECTURE.md`**: System architecture — tick loop, particle integration pipeline, snapshot boundary, render pipeline, input pipeline.
- **`manual_test_checklist.md`**: Manual testing procedures — player movement, particle emission, enemy AI, ability effects, large particle count stress test, save/load round-trip.

---

## 8. Workflow for AI Agents

### Before Making Changes

1. Read existing code to understand patterns and conventions.
2. Check `ARCHITECTURE.md` and `DECISIONS.md` for relevant context.
3. Identify which layer you are working in (`sim/`, `render/`, `input/`, `ui/`).

### While Making Changes

- Follow naming guidelines strictly.
- Maintain hard separation between layers.
- Avoid allocations in hot paths.
- Use appropriate suffixes for units, coordinates, and types.
- Keep functions in `sim/` pure, deterministic, and free of browser APIs.

### After Making Changes

- Increment `BUILD_NUMBER` in `src/build-info.ts` by 1 for every repository change.
- If changing `sim/` logic, verify the physics output is consistent with the previous behavior (or document intentional changes).
- Update `DECISIONS.md` if you changed an architectural or algorithmic decision.
- Update `ARCHITECTURE.md` if you changed the tick loop, pipeline, or snapshot boundary.
- Verify the performance overlay still shows acceptable FPS with a large particle count.

---

## 9. Common Pitfalls to Avoid

- ❌ Using `Date.now()` or `performance.now()` in `sim/` code
- ❌ Using `Math.random()` in `sim/` code — use the seeded RNG
- ❌ Creating objects or arrays in per-frame/per-particle loops
- ❌ Making `sim/` depend on `render/`, `ui/`, or any DOM API
- ❌ Using ambiguous variable names without proper suffixes
- ❌ Mixing `Screen` and `World` coordinates without conversion helpers
- ❌ Mixing time units (e.g., seconds and milliseconds) without explicit conversion
- ❌ Using boolean names without `is`, `has`, `can`, `should`, or `needs` prefix
- ❌ Treating `Id` values as array indices
- ❌ O(n²) neighbor search for large particle counts — use spatial partitioning
- ❌ Removing the performance overlay without a replacement

---

## 10. Checklist for Sim Changes

When modifying `sim/` code, verify:

- [ ] No wall-clock time used (`Date.now`, `performance.now`)
- [ ] No `Math.random()` — all RNG goes through `sim/rng.ts`
- [ ] No DOM or browser API dependencies introduced
- [ ] Particle buffer layouts remain consistent (no accidental shape changes)
- [ ] Spatial partitioning used for any O(n) or higher neighbor queries
- [ ] No per-tick allocations in hot paths
- [ ] Proper naming conventions followed (suffixes, mutability signals)
- [ ] Units of measure suffixes used on all numeric quantities
- [ ] Float usage is justified and documented if precision-sensitive
- [ ] `DECISIONS.md` updated if algorithm or architecture changed
- [ ] Performance overlay verified post-change

---

## 11. Particle & Cluster Design Guidelines

### Particle Types

Each distinct particle behavior gets its own `ParticleKind` enum value. When adding a new kind:

1. Add the value to `ParticleKind` in `sim/particles/kinds.ts`.
2. Implement its force contribution in `sim/particles/forces.ts`.
3. Add a render style in `render/particles/styles.ts`.
4. Document its physics properties (mass, charge, interaction rules) in `DECISIONS.md`.

### Cluster (Entity) Design

Entities (player, enemies) are clusters of bound particles. When adding a new entity type:

1. Create a factory file in `src/heroes/` (for the player) or `src/enemies/` (for enemies) — one file per entity type.
2. The factory returns a `ClusterState` with an initial particle configuration.
3. Define binding forces between the cluster's particles in `sim/clusters/`.
4. Define the entity's ability set in `src/abilities/`.
5. Keep each cluster file focused on a single entity type — no shared "god" cluster files.
