# Architecture Guide

This document is AI-facing and intentionally compact. Use it to choose files, then verify implementation details in source.

## Major layers

DustWeaver is a TypeScript/Vite/Electron-capable browser game. The current codebase has several major ownership layers:

- `src/game.ts`: top-level app/navigation state machine. Owns transitions between menu, loadout, gameplay, custom campaign play, and custom campaign edit.
- `src/screens/`: gameplay screen orchestration, room loading, transitions, resident rooms, camera, HUD/debug integration, and render orchestration. `src/screens/gameRunTimer.ts` is the Node-safe, instance-local speedrun timer state owner; `gameScreen.ts` retains eligible-frame gating.
- `src/sim/`: deterministic gameplay simulation. Owns `WorldState`, fixed tick systems, particle/cluster movement, combat, AI, hazards, and pathing.
- `src/render/`: rendering systems. Reads snapshots and room/render state, draws particles, walls, backgrounds, UI overlays, bloom, lighting, effects, and debug panels.
- `src/levels/`: room definitions, room registry, compact room schema, lazy room-file loading, campaign metadata, and migration/audit helpers.
- `src/editor/`: custom campaign and room editor.
- `src/ui/`: menus, settings, debug panel controls, save/load UI, and non-gameplay HTML UI.
- `src/progression/`: save-slot, player-progress state, and campaign starting-options application. `src/progression/campaignStartingOptions.ts` is the single shared helper for normalizing and applying `CampaignSpawnData` starting fields (health, containers, dust types, weaves) to a `PlayerProgress` in either `'merge'` mode (official campaign, never reduces existing count) or `'fresh'` mode (custom packed campaign, assigns exact configured count).
- `src/tests/`: node test files run by `npm test`.

## Game loop / update / render flow

1. `startGame()` in `src/game.ts` opens main menu, custom campaign paths, or gameplay.
2. `startGameScreen()` in `src/screens/gameScreen.ts` creates the world, renderers, input handlers, room managers, resident loaders, and debug/profiler state.
3. Input is collected by `src/input/handler.ts` and converted to simulation commands in `src/screens/gameCommandProcessor.ts`.
4. The simulation uses a fixed timestep of `16.666 ms` in gameplay orchestration.
5. `src/sim/tick.ts` advances deterministic simulation systems.
6. A reusable render snapshot is updated from `WorldState` through `src/render/snapshot.ts`.
7. `src/screens/gameRender.ts` and related render modules draw the interpolated frame.
8. Room transitions, async load phases, resident activation, and entry warm-up run around that loop.

## Coordinate systems and scaling assumptions

- Gameplay uses world/block coordinates from room data and `RoomDef` constants such as `BLOCK_SIZE_MEDIUM` and `BLOCK_SIZE_SMALL`.
- The gameplay screen uses a fixed virtual height of `270 px` and baseline virtual width of `480 px`. Height is authoritative for fixed zoom; wider screens can expose more horizontal game area.
- Camera offset is computed in render space from world positions. Be careful with any change that mixes world pixels, native virtual pixels, CSS pixels, or canvas backing-store pixels.
- Map/sketch rendering has separate projection assumptions. Do not assume gameplay camera math applies directly to map sketch output.

## Simulation ownership boundaries

`src/sim/` should stay deterministic and independent from DOM/render state. Simulation systems may read command fields and room/world buffers, but should not read live canvas, image, performance timing, or UI objects.

The renderer should not mutate simulation truth. It should consume `WorldSnapshot`, room data, and renderer-owned cache/effect state.

## Room loading architecture

Room loading is split into phases in `src/screens/gameLoadRoomPhases.ts`. The phase generator was extracted from `gameScreen.ts` but still writes back important gameplay-screen state through callbacks. Phase A must update active room state immediately because transition/load orchestration depends on it.

The runtime now relies on several layers to avoid transition freezes:

- `RoomRuntimeCache`: prepared room entries.
- Baked wall templates from room JSON when valid.
- Incremental wall-template fallback when baked/cache data is missing.
- Decode-aware asset preloading.
- Idle-time render chunk prewarming.
- Entry viewport warming.
- Resident room/world construction and activation.

Use the cache/baked/fallback order already centralized in `preparedRoomRuntime.ts` where possible rather than duplicating wall-template resolution.

## Resident-room architecture

The intended direction is to keep nearby rooms or whole world/zone room sets resident/frozen, then activate a resident `WorldState` instead of cold-loading from scratch. Key files:

- `src/screens/residentRoomManager.ts`: tracks resident room entries.
- `src/screens/residentWorldBuilder.ts`: builds resident worlds in the background.
- `src/screens/playerTransfer.ts`: captures/restores player state across activation.
- `src/screens/gameLoadRoomPhases.ts`: includes `applyResidentRoomActivation`.
- `src/screens/zoneResidentLoader.ts`: coordinates larger zone/world resident loading.

Treat resident worlds as mutable gameplay state with lifecycle rules. Avoid sharing per-visit mutable state unless that is explicitly part of resident ownership.

## World / zone transition assumptions

Room-to-room transitions should be near-instant when prepared/resident. Longer loading is acceptable at world/zone boundaries.

Transition geometry should stay as complete boundary walls plus independent trigger strips. Do not cut openings into boundary walls. `src/levels/roomBoundaryWalls.ts` is the shared boundary wall source of truth.

## Editor architecture

The editor is centered around `src/editor/editorController.ts`, with data and UI split into helper modules. The editor writes room/campaign data through schema/serializer layers and shares runtime room builders for playtest/export.

High-level areas:

- Palette categories and items: `editorDropdownData.ts`.
- Palette visual previews and audit helpers: `editorPalettePreview.ts`.
- Runtime/editor room construction: `editorRoomBuilder.ts`.
- JSON export and baked wall templates: `roomJsonSerializer.ts`.
- Schema types: `roomJsonSchema.ts`.

Do not bypass the serializer/hydrator path when changing room data format. Update audit and round-trip validation helpers for schema changes.

## Performance-sensitive areas

Treat these as hot or regression-prone:

- Fixed-tick loop and particle/cluster systems.
- Room load phases and resident-world builds.
- Wall/background chunk caches and prewarming.
- Scene-light occluder invalidation and bloom work.
- Dense per-room grids such as background-wall grids and pathing grids.
- World-map sketch rendering.
- Boundary wall and transition trigger geometry.

Do not optimize by changing behavior or ordering unless measurements justify it. Prefer profiler-guided changes using `__dwTransitionStats`, `__dwBenchTransition`, and `__dwBenchPingPong` where available.

## What should not be changed casually

- Tick order in `src/sim/tick.ts`.
- Snapshot semantics between sim and render.
- Room boundary wall generation and trigger strips.
- Compact room schema without backward-compatible hydration.
- Map sketch edge handling.
- Render ordering/blend/composite sequence.
- Resident activation/player transfer semantics.

## Validation expectations

For code changes, run the narrowest useful check first, then as practical:

```bash
npm run build
npm run lint
npm test
```

For room schema changes, also use the repo's room audit / round-trip validation tooling from the editor/dev controls or source helpers. For transition performance work, include measured browser transition stats when possible, not just build/test success.
