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

## Bundler
- Vite with TypeScript.
- Entry: `src/main.ts`.
