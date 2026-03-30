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

✅ Good: `isAlive`, `hasTarget`, `canMerge`, `shouldEmit`, `needsRepath

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
- **Distance**: `World` (simulation/world space) or `Px` (virtual canvas pixels). Examples: `radiusWorld`, `rangeWorld`, `offsetPx`
- **Angle**: `Rad` (preferred in code). Examples: `angleRad`, `emitDirectionRad`
- **Mass / Charge**: `Kg`, `Units` as defined in `DECISIONS.md`

Never mix unit systems in one function without explicit conversion helpers.

### Coordinate Spaces

Use suffixes to distinguish coordinate spaces:

- `Screen` — physical device pixel coordinates (after upscale). Avoid using these in game logic.
- `Px` — virtual canvas pixel coordinates (480×270 space). Used by renderers.
- `World` — simulation coordinate space (1 world unit = 1 virtual pixel at zoom 1.0).

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
- ❌ Mixing `Screen`, `Px`, and `World` coordinates without conversion helpers
- ❌ Mixing time units (e.g., seconds and milliseconds) without explicit conversion
- ❌ Using boolean names without `is`, `has`, `can`, `should`, or `needs` prefix
- ❌ Treating `Id` values as array indices
- ❌ O(n²) neighbor search for large particle counts — use spatial partitioning
- ❌ Removing the performance overlay without a replacement
- ❌ Setting canvas dimensions to `window.innerWidth` / `window.innerHeight` — always render to the 480×270 virtual canvas and upscale
- ❌ Using `BLOCK_SIZE_PX` or any stale block-size constant — use only `BLOCK_SIZE_SMALL`, `BLOCK_SIZE_MEDIUM`, or `BLOCK_SIZE_LARGE` from `src/levels/roomDef.ts`

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

1. Create a factory file in `src/heroes/` (for the player) or `src/sim/clusters/enemies/` (for enemies) — one file per entity type.
2. The factory returns a `ClusterState` with an initial particle configuration.
3. Define binding forces between the cluster's particles in `src/sim/clusters/`.
4. Define the entity's ability set in `src/abilities/`.
5. Keep each cluster file focused on a single entity type — no shared "god" cluster files.

---

## 12. WebGL Particle Shader Guidelines

### Architecture

Particle rendering uses a two-canvas layering strategy:

- **`WebGLParticleRenderer`** (`render/particles/webglRenderer.ts`) owns a WebGL canvas inserted *after* the 2D game-canvas in the DOM via `insertAdjacentElement('afterend', ...)`, placing it visually on top. All particles are drawn on this canvas.
- The **2D game-canvas** sits below (transparent background when WebGL is active) and renders clusters, HUD, and text.
- If WebGL is unavailable, `WebGLParticleRenderer.isAvailable` is `false` and the caller falls back to the Canvas 2D arc renderer — never remove this fallback.

### Shader Rules

- All GLSL shader source lives in `render/particles/shaders.ts` as exported string constants.
- Use **GLSL ES 1.00** (`precision mediump float;` in fragment shader, no `#version` directive) for maximum compatibility with WebGL1 and older mobile devices.
- Particle visuals are implemented as **point sprites**: each particle is one vertex; the fragment shader uses `gl_PointCoord` to compute radial effects — never allocate a quad mesh per particle.
- Use **additive blending** (`gl.blendFunc(SRC_ALPHA, ONE)`) so overlapping particles produce natural bloom without a separate post-process pass.
- Do NOT use `gl.DEPTH_TEST` for 2D particle rendering — particles are rendered flat.

### Performance Constraints

- The GPU vertex buffer must be **pre-allocated** at `MAX_PARTICLES` capacity in the constructor; never call `gl.bufferData` with a resizing intent in the render hot path.
- Upload alive-particle data each frame with **`gl.bufferSubData`**, not `gl.bufferData` (avoids GPU reallocation).
- The CPU-side interleaved vertex array (`Float32Array`) must be **pre-allocated** and never recreated per frame.
- The isPlayer lookup table must be a **pre-allocated `Uint8Array`** reset with `fill(0)` each frame (not a `Map` or object literal).
- All alive particles are drawn in a **single `gl.drawArrays(gl.POINTS, 0, vertexCount)` call** — never loop `drawArrays` per particle.

### Adding New Visual Effects via Shaders

When adding a new per-particle visual property (e.g., speed glow, charge colour, damage flash):

1. Add the new attribute to the interleaved vertex format in `webglRenderer.ts` and update `FLOATS_PER_VERTEX`.
2. Add the corresponding `attribute` declaration and logic to `PARTICLE_VERTEX_SHADER_SRC` or `PARTICLE_FRAGMENT_SHADER_SRC` in `shaders.ts`.
3. Pack the new data during the vertex-packing loop in `WebGLParticleRenderer.render()` — no allocations.
4. Document the new visual encoding in `DECISIONS.md`.
5. If the new data requires adding a field to `ParticleSnapshot`, update `render/snapshot.ts` and `createSnapshot` accordingly.

### Graceful Degradation

- Never remove `render/particles/renderer.ts` (Canvas 2D arc renderer) — it is the mandatory fallback.
- If shader compilation fails at runtime, `WebGLParticleRenderer.isAvailable` becomes `false`; errors are logged to the console, and the game falls back silently.
- The visual quality difference between WebGL and Canvas 2D fallback is acceptable — correctness and playability take priority over beauty on low-end devices.

---

## 13. Coordinate System & World Scale (Authoritative Standard)

This section is the single source of truth for all spatial constants. Any value in code that contradicts this section must be updated to conform.

### Virtual Resolution

The game renders to a **fixed internal virtual canvas of 480 × 270 virtual pixels**. This virtual canvas is then scaled up to the device display using **nearest-neighbor sampling** (`imageSmoothingEnabled = false`) for a crisp, pixelated retro look.

```
VIRTUAL_WIDTH_PX  = 480
VIRTUAL_HEIGHT_PX = 270
```

At 1080p (1920 × 1080 physical pixels), the scale factor is exactly **4×** — each virtual pixel maps to a 4 × 4 physical pixel block.

**All rendering code must target the 480 × 270 virtual canvas.** Never set canvas dimensions to `window.innerWidth` / `window.innerHeight` for the virtual canvas. The device-sized canvas is only used as the final upscale target.

### World Units

**1 world unit = 1 virtual pixel** at the default zoom of 1.0. This means all world-space measurements are directly comparable to virtual pixel counts. The camera zoom is **always 1.0** (no dynamic zoom) unless explicitly overridden for a special effect and documented in `DECISIONS.md`.

### Block Sizes (Authoritative)

All level geometry must be built from these three canonical block sizes, exported from `src/levels/roomDef.ts`. No other block size constants are permitted.

| Constant            | World Units | Virtual Pixels | Physical Pixels @ 4× |
|---------------------|-------------|----------------|----------------------|
| `BLOCK_SIZE_SMALL`  | 3           | 3 × 3          | 12 × 12              |
| `BLOCK_SIZE_MEDIUM` | 6           | 6 × 6          | 24 × 24              |
| `BLOCK_SIZE_LARGE`  | 12          | 12 × 12        | 48 × 48              |

The **medium block (6 world units)** is the standard room-building unit. At the default zoom and virtual resolution, exactly **45 medium blocks fit vertically** (270 ÷ 6 = 45) and **80 medium blocks fit horizontally** (480 ÷ 6 = 80).

> ⚠️ The legacy constant `BLOCK_SIZE_PX` (previously `11.25` or `30`) is **removed**. Any reference to it in code must be replaced with the appropriate `BLOCK_SIZE_SMALL`, `BLOCK_SIZE_MEDIUM`, or `BLOCK_SIZE_LARGE`.

### Camera & Zoom

The camera zoom is defined as **virtual pixels per world unit**. At the standard zoom of 1.0:

```
screenXPx = worldX * zoom + offsetXPx   // zoom = 1.0
screenYPx = worldY * zoom + offsetYPx
```

The camera viewport is always **480 × 270 virtual pixels**. Pass `VIRTUAL_WIDTH_PX` and `VIRTUAL_HEIGHT_PX` (not `canvas.width` / `canvas.height`) to all camera functions (`updateCamera`, `snapCamera`, `getCameraOffset`, `clampCameraToRoom`).

### Upscale Pipeline

The rendering pipeline has two stages:

1. **Virtual render pass**: All game content (walls, clusters, particles, HUD) is drawn onto the 480 × 270 virtual canvas using world-space coordinates transformed by zoom + camera offset.
2. **Upscale pass**: The virtual canvas is drawn onto the full device canvas using `ctx.drawImage(virtualCanvas, 0, 0, deviceWidth, deviceHeight)` with `imageSmoothingEnabled = false`.

The WebGL particle canvas must match the same virtual resolution and be upscaled with the same transform, so particles remain pixel-aligned with the rest of the scene.

---

## 14. Collision System Requirements

The collision system must be **unconditionally robust** — no tunneling, no clipping, no ghost forces at block seams, regardless of entity speed or direction.

### Wall Merging (Pre-processing)

At room load time, all wall rectangles that are axis-aligned and share a face (touching or overlapping on one edge) must be **merged into a single AABB** before being written into the world wall arrays. This is performed once in `loadRoomWalls()`.

- Two walls should be merged if they are colinear on one axis and their extents on the other axis are contiguous (gap = 0).
- Merge iteratively until no further merges are possible.
- The result is that large contiguous block groups (e.g., a floor made of 20 adjacent medium blocks) are represented as a single wide rectangle — eliminating all internal seam edges.

**Rationale**: Testing each block as a separate AABB causes the player to catch on internal seams between adjacent blocks, producing upward-clipping and sideways-sticking artifacts.

### Axis-Separated Sweep Resolution

`resolveClusterSolidWallCollision` must use a **two-pass axis-separated sweep**:

1. **X pass**: Apply only the horizontal component of velocity to position (`posX += velX * dt`), then resolve all wall overlaps on the X axis only (push out left/right, zero X velocity on contact).
2. **Y pass**: Apply only the vertical component of velocity to position (`posY += velY * dt`), then resolve all wall overlaps on the Y axis only (push out top/bottom, zero Y velocity on contact, set `isGroundedFlag` on top-surface landing).

Each pass iterates over all merged walls independently. This ensures horizontal and vertical resolution never interfere with each other, which is the root cause of corner-clipping.

> ❌ Never use minimum-penetration (shortest overlap axis) as the primary resolver. It will always produce incorrect results at corners and high velocities. It may only be used as a last-resort fallback with a clear comment explaining why it fired.

### Epsilon Guards

All sweep boundary checks must include a small epsilon (`COLLISION_EPSILON = 0.5` world units) to absorb floating-point error accumulated across ticks:

```typescript
// Example: was the cluster above the wall top last tick?
if (prevBottom <= wallTop + COLLISION_EPSILON && velocityY >= 0) { ... }
```

### Sub-Tick Safety

If `Math.abs(velocityX * dtSec) > cluster.halfWidthWorld` or `Math.abs(velocityY * dtSec) > cluster.halfHeightWorld`, the movement for that axis must be split into sub-steps (each step ≤ half the cluster's dimension) to prevent tunneling through thin walls at high speed. The dash speed (560 world units/s at 60fps = ~9.3 units/tick) must not tunnel through a small block (3 units wide) — sub-stepping is required.