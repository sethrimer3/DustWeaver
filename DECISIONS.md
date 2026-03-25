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
