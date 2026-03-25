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
2. Apply per-element forces: hash-noise perturbation, curl-noise turbulence,
   isotropic diffusion, upward/buoyancy bias (`elementForces.ts`).
3. Apply binding forces: element-aware anchor spring + orbital tangential
   force driving circular orbit around the owner cluster (`binding.ts`).
4. Apply inter-particle forces: different-owner repulsion + contact
   destruction; same-owner boid forces (cohesion, separation, alignment)
   weighted by element profiles (`forces.ts`).
5. Euler integration with per-element drag (`integration.ts`).
6. Lifetime update: age particles; respawn expired particles at their owner
   with new random anchor offsets (`lifetime.ts`).
7. Increment tick counter.

## Elemental Particle System

`sim/particles/elementProfiles.ts` defines `ElementProfile` — a struct of
~18 tunable coefficients (mass, drag, orbitalStrength, noiseAmplitude,
instability, cohesion, lifetime, …) — and one named preset per `ParticleKind`.

Force pipeline layers (all accumulated before integration):
- **Element forces** (`elementForces.ts`): hash-noise perturbation (rate
  controlled by `instability`), curl-noise turbulence, diffusion, upward bias.
- **Binding forces** (`binding.ts`): spring toward per-particle anchor point
  (owner pos + polar offset) scaled by `attractionStrength`; tangential
  orbital force scaled by `orbitalStrength`.
- **Inter-particle forces** (`forces.ts`): same-owner boid (cohesion,
  separation, alignment); different-owner repulsion + contact destruction.

**Adding a new element:**
1. Add a `ParticleKind` enum value in `sim/particles/kinds.ts`.
2. Add an `ElementProfile` constant and push it into `ELEMENT_PROFILES`
   at the matching index in `sim/particles/elementProfiles.ts`.
3. Add a matching colour entry in `render/particles/styles.ts` (Canvas 2D)
   and a `kindColor()` branch in the fragment shader in
   `render/particles/shaders.ts` (WebGL).



- `WorldSnapshot` is a shallow readonly view of the current sim state.
- Created each frame before rendering.
- Renderer only reads from snapshot — never from `WorldState` directly.

## Input Pipeline

- `KeyboardEvent` → `InputState` (mutable booleans).
- `collectCommands(inputState)` → `GameCommand[]` per frame.
- Commands applied before sim tick.
