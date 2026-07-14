# AI Repo Map

Purpose: help agents choose the smallest useful file set before making changes. This is a compact routing map, not a replacement for source inspection.

## Fast read guide

| Task type | Start here | Then inspect |
|---|---|---|
| App flow, screen navigation, save-slot start behavior | `src/game.ts` | `src/ui/mainMenu.ts`, `src/ui/weaveLoadout.ts`, `src/progression/` |
| Campaign starting-options normalization (health/containers/dust/weaves) | `src/progression/campaignStartingOptions.ts` | `src/levels/campaignSchema.ts`, `src/progression/unlocks.ts`, `src/progression/playerProgress.ts` |
| Gameplay loop, fixed tick, input-to-sim orchestration | `src/screens/gameScreen.ts` | `src/screens/gameCommandProcessor.ts`, `src/sim/tick.ts`, `src/input/handler.ts` |
| Speedrun timer arming, checkpoint, and respawn state | `src/screens/gameRunTimer.ts` | `src/screens/gameScreen.ts`, `src/screens/gameOverlayController.ts`, `src/progression/saveSlots.ts` |
| Skill-tomb save, checkpoint, and healing transaction | `src/screens/gameSkillTombActivation.ts` | `src/screens/gameOverlayController.ts`, `src/render/skillTombRenderer.ts`, `src/progression/playerProgress.ts`, `src/sim/world.ts` |
| Death-screen Return to Last Save respawn transaction | `src/screens/gameDeathRespawnCoordinator.ts` | `src/screens/gameOverlayController.ts`, `src/progression/playerProgress.ts`, `src/levels/roomDef.ts` |
| Room load / transition hitch | `src/screens/gameLoadRoomPhases.ts` | `src/screens/residentWorldBuilder.ts`, `src/screens/residentRoomManager.ts`, `src/screens/zoneResidentLoader.ts`, `src/screens/roomRuntimeCache.ts`, `src/debug/transitionProfiler.ts` |
| Resident-room / hot-swap behavior | `src/screens/residentRoomManager.ts` | `src/screens/residentWorldBuilder.ts`, `src/screens/playerTransfer.ts`, `src/screens/gameLoadRoomPhases.ts` |
| Render chunk prewarming | `docs/render-chunk-prewarming.md` | `src/screens/roomRenderChunkWarmScheduler.ts`, `src/render/walls/blockSpriteRenderer.ts`, `src/render/walls/backgroundBlockRenderer.ts`, `src/render/walls/chunkRenderCache.ts` |
| Wall template / boundary / transition geometry | `src/levels/roomBoundaryWalls.ts` | `src/screens/gameRoomWalls.ts`, `src/screens/gameTransitions.ts`, `src/screens/gameRoomTransitionOrchestrator.ts`, `src/screens/preparedRoomRuntime.ts` |
| World map or room sketch artifacts | `src/render/mapSketchRenderer.ts` | Relevant map UI files and room boundary/wall data sources. Treat as regression-prone. |
| Player movement, jump, grapple, ice behavior | `src/sim/clusters/movementConstants.ts` | `src/sim/clusters/`, `src/screens/gameCommandProcessor.ts`, relevant tests if present |
| Enemy AI or pathing | `src/sim/clusters/` | `src/screens/gameEnemySpawn.ts`, room enemy definitions |
| Editor palette / room authoring | `src/editor/editorController.ts` | `src/editor/editorDropdownData.ts`, `src/editor/editorPalettePreview.ts`, `src/editor/editorRoomBuilder.ts`, `src/editor/roomJsonSerializer.ts` |
| Editor playtest room activation / edit invalidation | `src/screens/gameEditorRoomActivationCoordinator.ts` | `src/screens/gameScreen.ts`, `src/screens/residentBuildScheduler.ts`, `src/screens/residentRoomManager.ts`, `src/screens/roomRuntimeCache.ts`, `src/screens/zoneResidentLoader.ts` |
| Room save format / migration / compression | `src/levels/roomSavedTypes.ts` | `src/levels/roomSchemaV2.ts`, `src/levels/roomSchemaHydrator.ts`, `src/levels/tileGridCompressor.ts`, `src/levels/roomFileAudit.ts`, `src/levels/roomRoundTripValidator.ts` |
| Legacy skill-book-to-weave room JSON migration | `src/levels/legacySkillBookMigration.ts` | `src/editor/roomJson.ts`, `src/levels/roomJsonToRoomDef.ts` |
| Asset loading / sprite decode | `src/render/roomAssetPreloader.ts` | `src/render/walls/imageCache.ts`, `src/screens/gameLoadRoomPhases.ts`, menu/loading UI files |
| UI menus / settings / debug panels | `src/ui/` | `src/render/hud/renderProfiler.ts`, `src/screens/gameOverlayController.ts`, `src/screens/gamePauseController.ts` |
| Build, lint, tests | `package.json` | `src/tests/**/*.test.ts` |

## Main entry points

- `src/main.ts` or equivalent Vite entry: browser bootstrapping. Verify exact file before editing because it was not inspected for this map.
- `src/game.ts`: top-level app state machine. It wires main menu, loadout, gameplay, custom campaign play/edit, save persistence, lazy official/custom campaign room loading, and recovery when `ROOM_REGISTRY` is partial.
- `src/screens/gameRunTimer.ts`: Node-safe, instance-local speedrun timer state machine. It owns normalization, waiting-for-intent arming, eligible-frame accumulation, checkpoint capture, and respawn restore; `gameScreen.ts` retains screen-level frame gating.
- `src/screens/gameSkillTombActivation.ts`: Node-safe owner of the synchronous skill-tomb save/checkpoint/healing transaction. It receives room/tomb lookups and callbacks through structural ports; `gameOverlayController.ts` retains modal guards, DOM construction, and close lifecycle.
- `src/screens/gameDeathRespawnCoordinator.ts`: Node-safe owner of the deterministic Return to Last Save respawn transaction (saved-room/campaign fallback resolution, `loadRoom`, transition-reveal reset, frame-clock reset, optional post-respawn callback). `gameOverlayController.ts` retains the death-screen guard, UI construction/cleanup, and the Return to Main Menu path.
- `src/screens/gameScreen.ts`: main gameplay orchestrator. It owns the fixed timestep loop, canvas size assumptions, input attachment, render orchestration, room loading, transition manager wiring, resident room manager, zone resident loader, debug/profiler hooks, and many renderer objects.

## Runtime flow

1. `startGame()` chooses menu/loadout/gameplay/custom campaign mode.
2. Gameplay starts through `startGameScreen()`.
3. Input is collected in `src/input/handler.ts` and translated by `src/screens/gameCommandProcessor.ts`.
4. Simulation advances at fixed `16.666 ms` ticks through `src/sim/tick.ts`.
5. `src/render/snapshot.ts` creates or updates reusable snapshots.
6. `src/screens/gameRender.ts` and render submodules draw the current interpolated frame.
7. Room transitions are orchestrated by `src/screens/gameRoomTransitionOrchestrator.ts` and loaded through `src/screens/gameLoadRoomPhases.ts` or resident activation paths.

## Rendering

Important files and roles:

- `src/screens/gameRender.ts`: frame renderer entry point. Read when changing draw order or integrating render passes.
- `src/screens/gameRenderQuality.ts`: adaptive render quality and quality-dependent cache limits. Risk: avoid per-frame allocations or redundant cache churn.
- `src/screens/gameRenderSceneLighting.ts`: scene-light pass and occluder invalidation. Risk: lighting occluder rebuilds can become expensive.
- `src/render/snapshot.ts`: reusable snapshot boundary between simulation and rendering. Risk: changing snapshot shape affects many renderers.
- `src/render/effects/bloomSystem.ts` and `src/render/effects/bloomConfig.ts`: selective bloom pipeline.
- `src/render/walls/blockSpriteRenderer.ts`: wall chunk rendering, prewarm/adopt APIs, active block sprite state.
- `src/render/walls/backgroundBlockRenderer.ts`: background block chunks and prewarm/adopt APIs.
- `src/render/walls/chunkRenderCache.ts`: chunk cache extraction/injection.
- `src/render/walls/roomRenderCacheStore.ts`: render-state key and memoization.
- `src/render/walls/roomRenderState.ts`: single source of truth for RoomDef → render-state params (defaults, render-state key, WallPrewarmContext, wall-template snapshot adapter). Pure, Node-testable. Change defaults here only deliberately — they feed the prewarm/adopt key.
- `src/render/mapSketchRenderer.ts`: world/room sketch output. Marked regression-prone in planning notes.

## Room and world loading

Important files and roles:

- `src/screens/gameLoadRoomPhases.ts`: six-phase room-load generator extracted from `gameScreen.ts`. It uses setter callbacks so Phase A updates outer `gameScreen.ts` state immediately. Read this before changing load order. The full-load generator and `applyResidentRoomActivation` (hot-swap) share the room-activation helpers in this file (`applyRoomPresentationState`, `resetRoomScopedSimState`, `applyPlayerWeaveWorldFields`, `applyRoomEnvironmentAndScheduling`) — add new per-room renderer/effect/singleton wiring to the helpers, not to one caller.
- `src/screens/roomRuntimeCache.ts`: prepared runtime entry cache and readiness checks.
- `src/screens/preparedRoomRuntime.ts`: central cache/baked/fallback wall-template resolution and diagnostics.
- `src/screens/gameRoomWalls.ts`: wall template building and incremental wall-template generator.
- `src/screens/residentWorldBuilder.ts`: background resident world construction. Known area to verify for first-entry large-room wall-template costs.
- `src/screens/residentRoomManager.ts`: resident room ownership/lookup/activation management.
- `src/screens/residentBuildScheduler.ts`: background resident-build priority queue, single active build session, per-room version counters (stale-build guard), frame-budget gating, cross-zone transition state, and initial zone-load progress. Owns its state; gameScreen interacts only through its interface. Queue/priority/stale semantics are pinned by `tests/residentBuildScheduler.test.ts`.
- `src/screens/zoneResidentLoader.ts`: zone/world-level resident loading direction.
- `src/screens/playerTransfer.ts`: preserves player state across resident hot-swap.
- `src/screens/entryViewportWarm.ts`: entry viewport warm-up behavior.
- `src/screens/roomPreloadScheduler.ts`: data and asset preloading.
- `src/screens/roomPrewarmNeighborhood.ts`: nearby-room BFS.
- `src/screens/roomRenderChunkWarmScheduler.ts`: idle-time render chunk warming.

Common risks:

- Phase ordering matters. Phase A state must be visible immediately for downstream preload/activation logic.
- Resident worlds contain mutable state. Do not share per-visit mutable enemy, hazard, rope, particle, crumble, or pickup state unless the existing resident architecture explicitly owns that lifecycle.
- Avoid reintroducing synchronous full-room work into transition frames.

## Transitions and boundaries

- `src/levels/roomBoundaryWalls.ts`: shared complete boundary wall builder. Boundary walls should remain complete solid edges.
- `src/screens/gameTransitions.ts`: trigger strip detection. Transitions are independent trigger strips, not holes.
- `src/screens/gameRoomTransitionOrchestrator.ts`: transition boundary detection, cooldown, and activation callback dispatch.
- `src/screens/roomTransitionLoadCoordinator.ts`: transition execution after the boundary fires — path selection (cross-zone → hot-swap → prepared instant → async), async load-generator state, pre-transition velocity, cross-zone pending activation, blocking-gameplay contract. Ports-injected and Node-testable (`tests/roomTransitionLoadCoordinator.test.ts`); never imports gameScreen.
- `src/screens/roomPreloadAnticipationPolicy.ts`: stateless, Node-safe module for per-frame preload anticipation. Runs proximity policy (first authored transition within 10 medium blocks → priority 1 resident build + runtime/decode/prewarm boosts) and velocity-direction policy (dominant-axis direction → priority 2 resident build). All side effects delegated through `RoomPreloadAnticipationPorts`; ports object created once in `startGameScreen`. Pinned by `tests/roomPreloadAnticipationPolicy.test.ts`.

Do not change boundary holes/trigger geometry casually. Planning notes explicitly warn this has caused regressions.

## Simulation, movement, collision

- `src/sim/world.ts`: `WorldState` and core buffers.
- `src/sim/tick.ts`: fixed tick pipeline.
- `src/sim/particles/`: particle forces, integration, lifetime, combat, wall interaction, element definitions.
- `src/sim/clusters/`: player/enemy cluster behavior, movement, AI, pathing.
- `src/sim/clusters/movementConstants.ts`: movement constants. Read for speed, jump, braking, wall slide, and related movement changes.
- `src/screens/gameCommandProcessor.ts`: input commands into sim flags/vectors.

Risk: simulation is intended to be deterministic. Keep DOM, render objects, and wall-clock randomness out of sim code.

## Editor and room data

- `src/editor/editorController.ts`: main editor controller. Large file; inspect only for editor orchestration changes.
- `src/editor/editorDropdownData.ts`: palette item definitions.
- `src/editor/editorPalettePreview.ts`: palette preview logic and audit helpers.
- `src/editor/editorRoomBuilder.ts`: converts editor room data to runtime/editor geometry.
- `src/editor/roomJsonSerializer.ts`: export serialization, including baked wall template generation.
- `src/editor/roomJsonSchema.ts`: room JSON schema types.
- `src/screens/gameEditorRoomActivationCoordinator.ts`: Node-safe orchestration boundary for applying an edited room to the live playtest runtime. It preserves spawn resolution, cache/resident/zone invalidation, radius-one rebuild ordering, room loading, and fresh active-world registration through injected ports.

Room schema and compression:

- `src/levels/roomSavedTypes.ts`: compact saved room types and schema version.
- `src/levels/roomSchemaV2.ts`: dehydration/writer path.
- `src/levels/roomSchemaHydrator.ts`: read/hydrate path with backward compatibility.
- `src/levels/tileGridCompressor.ts`: compressed layer helpers.
- `src/levels/roomFileAudit.ts` and `src/levels/roomRoundTripValidator.ts`: dev/audit validation tools.

## Performance systems and hot paths

Consult `nextSteps.md`, `performanceOptimizationDecisions.md`, and `docs/render-chunk-prewarming.md` before touching performance-sensitive code.

Known hot or sensitive paths:

- Fixed-step loop in `src/screens/gameScreen.ts`.
- Tick pipeline in `src/sim/tick.ts` and particle/cluster systems.
- Wall/background chunk renderers.
- Scene-light occluder invalidation.
- Room load phases and resident-world builds.
- `computeRenderStateKey` in `roomRenderCacheStore.ts`.
- Dense per-room grids such as `bgWallGrid` and snake pathing grids.

## Asset loading and menus

- `src/render/roomAssetPreloader.ts`: room sprite/background decode and readiness checks.
- `src/render/walls/imageCache.ts`: image decode/cache helpers.
- `src/ui/mainMenu.ts`, `src/ui/`, and loading screen modules: menu, save slots, settings, loadout, debug UI. Search by UI text or component name before editing.

## Tests and commands

Commands from `package.json`:

```bash
npm run build
npm run lint
npm test
```

Tests live under `src/tests/**/*.test.ts`. Prefer adding targeted tests near existing tests when changing pure helpers such as render-state keys, schema compression, wall template validation, or deterministic sim utilities.

## Uncertain areas

- This map was created from targeted source/docs inspection rather than a complete repo tree dump. Treat file lists as a routing aid, not exhaustive truth.
- Verify exact exports before editing any file not directly inspected.
- If source conflicts with this map, update this map after the change.
