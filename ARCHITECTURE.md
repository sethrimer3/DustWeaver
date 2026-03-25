# DustWeaver — Architecture

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
