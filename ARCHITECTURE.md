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
1. `webglRenderer.render(snapshot, offsetX, offsetY, zoom)` — background + particles (WebGL) **or**
   `ctx.fillRect` + `renderParticles` (Canvas 2D fallback)
2. `renderWalls(ctx, snapshot, offsetX, offsetY, zoom)` — auto-tiling block sprites (2D)
3. `renderClusters(ctx, snapshot, offsetX, offsetY, zoom)` — entity boxes and health bars (2D)
4. `renderGrapple(ctx, snapshot, offsetX, offsetY, zoom)` — grapple rope/anchor (2D)
5. `drawTunnelDarkness(ctx, room, offsetX, offsetY, zoom)` — transition tunnel fade-to-black (2D)
6. `environmentalDust.render(ctx, offsetX, offsetY, zoom)` — environmental dust layer (2D)
7. `renderHudOverlay(ctx, hud)` — FPS / frame-time / particle-count (2D)
8. Room name banner, control hints, touch joystick (2D)

Camera (`render/camera.ts`) follows the player cluster position with a smooth
lerp, clamped to room bounds so the viewport never shows outside the room.

## Metroidvania Room System

Room definitions live in `levels/roomDef.ts` (types) and `levels/rooms.ts` (data).
Each room specifies walls, enemies, and transitions in block-unit coordinates.
The game screen loads one room at a time; transitions swap the entire sim state.

```
World 2 ←—[tunnel]—— LOBBY ——[tunnel]—→ World 1
```

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
- F key produces `CommandKind.Interact` for skill tomb interaction.

## Death Screen

When the player cluster dies (`isAliveFlag === 0`):
1. Sim ticks and room transitions are skipped (freeze effect).
2. `showDeathScreen` renders a 50% dark overlay + blurred goldEmbers animation
   at 50% opacity + "Dusts..." text + navigation buttons.
3. "Return to Last Save" reloads the saved room/spawn from `PlayerProgress`.
4. "Return to Main Menu" exits gameplay.

## Skill Tomb System

Skill tombs are interactable save points placed in rooms.
- `SkillTombRenderer` manages the sprite and golden dust particle effects.
- When the player is within `SKILL_TOMB_INTERACT_RADIUS_WORLD` (90 units):
  - Golden dust swirls around the tomb.
  - "Press F to interact" prompt appears.
- When the player leaves proximity, dust turns dull gold and falls to ground.
- Interaction opens `showSkillTombMenu` with Loadout and World Map tabs.
- Progress is auto-saved on interaction and on menu close.

## Skill Tomb Menu

Two-tab menu (`ui/skillTombMenu.ts`):
1. **Loadout** — particle kind selection (same as old loadout screen).
2. **World Map** — canvas-based room map with zoom (mouse wheel) and pan (drag).
   Shows explored rooms with blocks, doorways (blue), and skill tombs (gold).
- ESC closes the menu without opening the pause menu (captured with `{ capture: true }`).
- X button in top-right corner also closes.

## World Editor (BUILD 35)

The world editor is an in-game level editing tool accessible via the debug UI.

### Module Layout (`src/editor/`)
- **editorState.ts** — Core state: mode, tool, palette, selection, mutable `EditorRoomData`.
- **editorController.ts** — Orchestrator: lifecycle, input processing, tool dispatch, UI wiring.
- **editorCamera.ts** — Free WASD camera panning independent of the player.
- **editorInput.ts** — Keyboard/mouse/wheel input isolated from gameplay input.
- **editorTools.ts** — Select, Place, Delete tool logic with grid-snapping and hit testing.
- **editorUI.ts** — DOM-based toolbar, palette panel, inspector panel, export button.
- **editorRenderer.ts** — Canvas overlays: grid, placement preview, selection highlights, transition zones.
- **editorWorldMap.ts** — Room list overlay (M key) for jumping between rooms.
- **transitionLinker.ts** — Cross-room transition linking workflow.
- **editorExport.ts** — Browser download of room JSON.
- **roomJson.ts** — `RoomJsonDef` schema, validation, conversion between JSON ↔ `EditorRoomData` ↔ `RoomDef`.

### Integration with Game Screen
- `EditorController` is created once in `startGameScreen()`.
- A "World Editor" button appears when debug mode is on.
- When editor is active, the frame function skips gameplay (sim, input, transitions)
  and delegates to the editor's update/render cycle.
- The editor calls `loadRoom()` to apply changes to the runtime world when jumping rooms.

