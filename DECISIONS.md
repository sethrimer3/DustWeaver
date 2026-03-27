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

