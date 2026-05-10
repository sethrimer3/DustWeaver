# DustWeaver — Next Steps

## BUILD 271 — Rendering Performance Optimization Pass

This document summarises the optimizations applied in BUILD 271, suspected
remaining bottlenecks, and follow-up work that would require deeper changes.

---

## What Was Optimized (BUILD 271)

### 1. Frame-pacing diagnostics (renderProfiler.ts)

The debug overlay now shows:

- **FPS panel** (top right when debug mode is active):
  - `FPS cur:` — current instantaneous FPS (1000 / lastFrameMs)
  - `avg:` — exponentially-smoothed average FPS
  - `1%:` — 1% low FPS (average of the ~3 worst frames in the last 256 RAF callbacks)
  - `Frame now:Xms wrst:Yms` — current frame time and worst frame in the rolling window
  - `>20ms / >33ms / >50ms` — cumulative long-frame event counts (highlighted red if >50ms frames exist)
  - `! ADAPTIVE QUALITY` — shown in red when adaptive quality is actively reducing effects

- **Implementation**: All new state uses pre-allocated typed arrays (ring buffer = `Float32Array(256)`, scratch scratch `Float32Array(3)`).  No per-frame allocations in `recordFrameTime()` or `drawOverlay()`.

- **How to use**: Enable debug mode in-game (F3 or developer toggle). The FPS panel appears above the per-stage timing panel in the top-right corner.

### 2. DarkRoom light-hole gradient caching (darkRoomOverlay.ts)

**Before**: Every DarkRoom light source called `createRadialGradient()` every frame — one gradient object allocated per light per frame (typically 5–40+ lights in a dark room).

**After**: Eight 128×128 "light-hole" canvases are pre-rendered in the `DarkRoomOverlay` constructor, one for each quantized `innerFraction` value (0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40).  Each frame uses `ctx.drawImage(holeCanvas, x − r, y − r, 2r, 2r)` with bilinear scaling to punch a smooth soft-edged hole in the darkness.

Visual quality is unchanged — the quantized inner fractions are close enough to the originals (largest error = 0.025) that the difference is invisible in a dark overlay context.

This eliminates the dominant per-frame Canvas2D allocation in the DarkRoom rendering path.

### 3. Lights scratch buffer (gameRender.ts + wallDecorations.ts)

**Before**: `collectDecorationLights()` allocated a new `LightSourcePx[]` array every frame.

**After**:
- A module-level `_scratchLights: LightSourcePx[]` array is allocated once.
- `collectDecorationLights()` now takes `out: LightSourcePx[]` as its first argument and clears/fills it in place (void return).
- All light-source additions in the DarkRoom path (authored lights, player lantern, particle lights, preview bubbles) push to the same stable `_scratchLights` array.

### 4. Shadow occluders scratch buffer (gameRender.ts)

**Before**: `const shadows: ShadowCasterOccluderPx[] = []` allocated a new array every frame.

**After**: Module-level `_scratchShadows: ShadowCasterOccluderPx[]` is allocated once and passed to `buildPlayerShadowOccluders()` which calls `out.length = 0` to reset it.

### 5. Eliminated Array.find() with closure (gameRender.ts)

**Before**: `snapshot.clusters.find(c => c.isPlayerFlag === 1 && c.isAliveFlag === 1)` — created a closure function object every frame.

**After**: Replaced with a plain `for` loop — allocation-free and slightly faster.

### 6. Profiler ring buffer always-on (renderProfiler.ts + gameScreen.ts)

`recordFrameTime(elapsedMs)` is now called every RAF frame (regardless of debug mode) so the ring buffer is pre-populated. When the player first enables debug mode they immediately see accurate long-frame counts and worst-frame data instead of waiting for the ring to fill.

---

## Files Changed in BUILD 271

| File | Change |
|------|--------|
| `src/build-info.ts` | BUILD_NUMBER 270 → 271 |
| `src/render/hud/renderProfiler.ts` | Ring buffer, 1% low FPS, long-frame counters, adaptive quality status, dynamic panel Y stacking |
| `src/render/effects/darkRoomOverlay.ts` | Pre-rendered light-hole canvas cache; drawImage replaces createRadialGradient |
| `src/render/effects/wallDecorations.ts` | `collectDecorationLights` signature changed: takes `out: LightSourcePx[]` first arg; no return |
| `src/screens/gameRender.ts` | Module-level scratch arrays; Array.find() → for-loop; scratch arrays passed to DarkRoom path |
| `src/screens/gameScreen.ts` | `renderProfiler.recordFrameTime(elapsedMs)` called every frame |

---

## Remaining Suspected Bottlenecks

### A. Per-frame object-literal allocations in DarkRoom lights path
The `_scratchLights.push({ xPx, yPx, radiusPx, innerFraction })` calls (authored lights,
player lantern, particle lights, preview bubbles) still create new plain-object literals each
frame.  In a room with many authored lights + many particle lights this is ~30–80 objects/frame.
To fully eliminate these, the `LightSourcePx[]` array would need to hold mutable pre-allocated
objects, or the DarkRoomOverlay render() would need to accept a flat Float32Array instead.

### B. Sunbeam renderer linear gradients
`sunbeamRenderer.ts` calls `ctx.createLinearGradient()` for each beam each frame.  With only a
few beams per room the impact is small, but caching the gradient per-beam (invalidated when
the beam's pixel coords change by > 0.5px) would eliminate this.

### C. Shadow occluder object allocations
`buildPlayerShadowOccluders()` pushes `{ baseAx, baseAy, … }` objects into `out` — up to 4
objects per frame in DarkRoom mode.  Pre-allocating a pool of 4 mutable objects and filling
them without `push` would eliminate these.

### D. Decoration bloom: per-frame object literals in BloomSystem
`addDecorationBloom()` and similar bloom draw calls create `{ x, y, radius, glow: { … } }`
descriptor objects each frame.  Pooling these or using a flat typed-array interface for the
BloomSystem draw queue would reduce pressure.

### E. loadRoom() is fully synchronous
Heavy room loads (many walls, BFS ambient light, particle spawning) still block for 30–80 ms on
complex rooms.  The fade-to-black transition hides this, but spreading the work across frames
using a generator-based async load would truly eliminate the stall.

### F. Spatial partitioning for large particle counts
The DarkRoom particle-light loop scans all particles linearly (`particleCount` iterations).
With thousands of particles this is O(n); a spatial grid (already present in sim/ for physics)
could accelerate the screen-visible subset query.

---

## How to Use the Debug Profiler

1. **Enable debug mode** (F3, or the developer toggle if compiled in).

2. The **top-right overlay** shows:
   - **FPS panel**: current / average / 1% low FPS; frame time now / worst; long-frame counts.
   - **Stage timings**: per-render-stage ms (background, walls, entities, particles, dust, sunbeams, bloom, lighting, HUD, total).
   - **Chunk cache panel**: visible chunks, dirty chunks, rebuilt this frame, estimated VRAM.
   - **Transition panel**: room ID, fade state, player speed, bubble count, edge cache status.
   - **Liquid panel**: tile count, body count, merged rects, bubbles, rebuild count.

3. **Long frame detection**: The `>20ms / >33ms / >50ms` counters accumulate while debug is on.
   A room with frequent `>33ms` frames is dropping below 30 FPS.  Check which stage is
   dominating in the stage timings panel.

4. **Adaptive quality** (future): When implemented, the `! ADAPTIVE QUALITY` warning in red
   shows when the system has automatically reduced effects to stay within the frame budget.

---

## Follow-Up Work (Architectural Changes Needed)

1. **Async / incremental loadRoom()** — generator-based or idle-callback chunking.
2. **Coloured DarkRoom lights** — the `colour` field on `RoomLightSourceDef` is preserved but
   not yet applied to the darkness mask.  Requires coloured destination-out compositing or a
   coloured additive light layer.
3. **Adaptive quality safeguards** — monitor rolling frame time and automatically lower
   `maxDustMoteCount`, `maxDynamicLightCount`, `maxParticleLightCount`, or skip bloom every
   other frame when consistently over budget.  The profiler already has `setAdaptiveReduction()`
   support for the overlay indicator.
4. **Flat typed-array interface for lights** — eliminate all remaining object-literal allocations
   in the DarkRoom path by replacing `LightSourcePx[]` with a `Float32Array` interleaved buffer.
5. **Sunbeam gradient caching** — cache `createLinearGradient` per beam, invalidated when the
   beam's pixel-space endpoints change by more than a threshold.
