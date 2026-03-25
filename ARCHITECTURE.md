# DustWeaver — Architecture

## Render Pipeline

Two canvases are layered in the DOM:

1. **WebGL canvas** (inserted first / lower z-order) — `WebGLParticleRenderer`
   renders the dark background + all particle point sprites in a single draw
   call.  On devices where WebGL is unavailable the canvas is not inserted.
2. **2D canvas** (`#game-canvas`, on top) — renders cluster indicators, health
   bars, HUD overlay, and UI text.  When WebGL is active the 2D canvas is fully
   cleared each frame (`clearRect`) so transparent areas expose the WebGL layer.
   When WebGL is unavailable the 2D canvas fills the background and renders
   particles via `renderParticles` (Canvas 2D arc fallback).

The render call order each frame:
1. `webglRenderer.render(snapshot)` — background + particles (WebGL) **or**
   `ctx.fillRect` + `renderParticles` (Canvas 2D fallback)
2. `renderClusters(ctx, snapshot)` — entity circles and health bars (2D)
3. `renderHudOverlay(ctx, hud)` — FPS / frame-time / particle-count (2D)
4. Instructions text (2D)

## Layer Separation

```
Input → Commands → Game Loop → Sim (tick) → Snapshot → Renderer
```

- `input/`: Maps browser events to `GameCommand` objects.
- `sim/`: Pure deterministic physics. No DOM. No random. No wall-clock.
- `render/`: Reads `WorldSnapshot`. Never mutates sim state.
- `ui/`: HTML overlays for menus.

## Tick Loop

1. Collect input commands.
2. Apply commands to WorldState (move player cluster).
3. Run `tick(world)` one or more times (accumulator).
4. Create `WorldSnapshot`.
5. Render snapshot.

## Particle Integration Pipeline

Each tick:
1. Clear forces.
2. Apply binding forces (orbit).
3. Apply inter-particle forces (repulsion + contact destruction).
4. Integrate (Euler: v += F/m * dt, x += v * dt).
5. Increment tick counter.

## Snapshot Boundary

- `WorldSnapshot` is a shallow readonly view of the current sim state.
- Created each frame before rendering.
- Renderer only reads from snapshot — never from `WorldState` directly.

## Input Pipeline

- `KeyboardEvent` → `InputState` (mutable booleans).
- `collectCommands(inputState)` → `GameCommand[]` per frame.
- Commands applied before sim tick.
