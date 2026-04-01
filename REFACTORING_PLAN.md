# DustWeaver Refactoring Plan

This document describes a plan to split the largest monolithic source files into
smaller, focused modules.  The goal is to improve organization and make it easier
for agents (and humans) to reason about individual responsibilities — without
impacting game performance or quality.

**Agent instructions:** When you complete a step, replace `[ ]` with `[x]` for
that item and add a brief note (e.g. `— done in commit abc1234`).  If you decide
to skip or change a step, document why in a note next to the item.

---

## Agent Execution Protocol

Use this protocol for every refactor PR so parallel agents can coordinate safely.

1. **Claim scope first**
   - Add your name/handle and the exact checklist item(s) you are taking in the
     **Progress Log** before editing code.
   - If another agent has already claimed an item, coordinate in that row before
     proceeding.

2. **Work in small slices**
   - Prefer one checklist item per PR/commit when feasible.
   - Keep behavior identical during file moves/splits; do not mix gameplay
     balance changes into refactor-only commits.

3. **Mandatory progress notes**
   - After each completed item, mark `[x]` and append:
     `— completed by <agent> on <YYYY-MM-DD>, commit <sha>`.
   - If partially done, keep `[ ]` and append:
     `— in progress by <agent>: <what remains>`.
   - If skipped/changed, append:
     `— skipped by <agent> on <YYYY-MM-DD>: <reason>`.

4. **Verification checklist per item**
   - Run `npm run build`.
   - Run targeted manual smoke test for the affected feature area.
   - Note results in the **Progress Log** row for the date.

5. **Handoff requirements**
   - Include touched files and remaining risks in the Progress Log summary.
   - If follow-up work is needed, add a new unchecked checklist bullet directly
     under the relevant section so it is visible to the next agent.

---

## Guiding Principles

- Every split must preserve the existing public API so call-sites need no edits,
  *or* all call-sites must be updated atomically in the same commit.
- No new allocations may be introduced in hot paths (forces, render loop).
- Each new file should have a single clear responsibility (one concern per file).
- All naming conventions from `ARCHITECTURE.md` and the agent guidelines apply.
- After each split, run `npm run build` and verify the game still loads.
- Update `DECISIONS.md` if an architectural decision changes.

---

## 1  `src/screens/gameScreen.ts`  (1 120 lines)

This is the largest file and the main game loop driver.  It mixes particle
spawning helpers, room-loading, camera/rendering orchestration, the main
`requestAnimationFrame` loop, and UI wiring.

### Proposed splits

- [ ] **`src/screens/gameSpawn.ts`** — Extract the three particle-spawning
  helpers: `spawnClusterParticles`, `spawnLoadoutParticles`,
  `spawnWeaveLoadoutParticles`, and `spawnBackgroundFluidParticles`.  These
  are pure sim-setup functions with no render dependency.

- [ ] **`src/screens/gameRoom.ts`** — Extract `loadRoomWalls`, the room
  transition logic (teleport / tunnel detection), and enemy spawn logic that
  is currently embedded in the main `startGameScreen` closure.

- [ ] **`src/screens/gameRender.ts`** — Extract the rendering orchestration
  block (all canvas draw calls, background, HUD, tunnel darkness, debug
  overlay) out of the main loop into a single `renderFrame(...)` function
  in its own file.

- [ ] **`src/screens/gameLoop.ts`** — Keep only the `requestAnimationFrame`
  tick loop, fixed-timestep accumulator, and the top-level
  `startGameScreen` export in `gameScreen.ts` (or rename it `gameLoop.ts`
  once the above extractions are done).

---

## 2  `src/sim/clusters/movement.ts`  (928 lines)

Contains player movement, enemy movement, wall-jump / coyote-time constants,
and player-sprite rotation — all in one file.

### Proposed splits

- [ ] **`src/sim/clusters/movementConstants.ts`** — All tunable numeric
  constants (gravity, jump heights, fall speeds, coyote time, wall-slide
  cap, wall-jump force, etc.).  Pure data, no logic.

- [ ] **`src/sim/clusters/playerMovement.ts`** — Player-specific movement
  functions: `tickPlayerMovement`, jump/fall logic, wall-slide, wall-jump,
  variable sustain, apex half-gravity, sprite rotation.

- [ ] **`src/sim/clusters/enemyMovement.ts`** — Enemy-specific movement
  functions currently inside `movement.ts`.

- [ ] Keep `movement.ts` as a thin re-export barrel (`export * from
  './playerMovement'; export * from './enemyMovement';`) to avoid
  updating every call-site.

---

## 3  `src/sim/particles/forces.ts`  (852 lines)

All inter-particle force logic lives here: boid behaviours, element-specific
contact effects (stone shatter, lava trail, crystal shards, poison cloud,
chain lightning, ice chill, shadow lifesteal, wind scatter), and the main
`applyInterParticleForces` export.

### Proposed splits

- [ ] **`src/sim/particles/elementEffects/stoneShatter.ts`** — `_spawnStoneShards`
  and stone-contact logic.

- [ ] **`src/sim/particles/elementEffects/lavaTrail.ts`** — `_spawnLavaTrailFire`
  and lava-contact logic.

- [ ] **`src/sim/particles/elementEffects/crystalShards.ts`** — `_spawnCrystalShards`
  and crystal-contact logic.

- [ ] **`src/sim/particles/elementEffects/poisonCloud.ts`** — `_spawnPoisonCloud`
  and poison-contact logic.

- [ ] **`src/sim/particles/elementEffects/chainLightning.ts`** — `_spawnChainLightning`
  and lightning-contact logic.

- [ ] **`src/sim/particles/elementEffects/iceSlowEffect.ts`** — Ice chill /
  slow logic.

- [ ] **`src/sim/particles/elementEffects/shadowLifesteal.ts`** — Shadow
  lifesteal logic.

- [ ] **`src/sim/particles/elementEffects/windScatter.ts`** — Wind scatter
  knockback logic.

- [ ] **`src/sim/particles/boidForces.ts`** — Boid cohesion, separation, and
  alignment accumulators and the per-kind boid weighting table.

- [ ] Keep `forces.ts` as a thin orchestrating module that imports from the
  above and calls them in the correct order inside `applyInterParticleForces`.
  Pre-allocated scratch buffers remain module-level in `forces.ts` (they are
  shared across effect files via function parameters, not module state).

---

## 4  `src/ui/skillTombMenu.ts`  (835 lines)

The skill-tomb upgrade menu mixes layout helpers, tab rendering, particle-kind
icon drawing, weave-loadout editing, and keyboard/mouse event handling.

### Proposed splits

- [ ] **`src/ui/skillTombTabs.ts`** — Tab-bar rendering and tab-switching logic.

- [ ] **`src/ui/skillTombUpgrades.ts`** — The upgrade-list panel: rendering
  upgrade rows, applying upgrades, computing costs.

- [ ] **`src/ui/skillTombWeavePanel.ts`** — The weave-loadout tab inside the
  tomb menu (selecting weave / dust bindings).

- [ ] Keep `skillTombMenu.ts` as the entry point that wires the panels together
  and handles the open/close lifecycle.

---

## 5  `src/sim/particles/combat.ts`  (665 lines)

Player and enemy combat logic: attack launch, attack-mode tick, block shield
positioning, enemy attack/block, and the top-level `applyCombatForces`.

### Proposed splits

- [ ] **`src/sim/particles/playerCombat.ts`** — `triggerAttackLaunch`,
  `tickAttackMode`, block-shield positioning and `applyBlockForces`.

- [ ] **`src/sim/particles/enemyCombat.ts`** — `triggerEnemyAttackLaunch`,
  `applyEnemyBlockForces`, and enemy-specific combat helpers.

- [ ] Keep `combat.ts` as the orchestrating module exporting
  `applyCombatForces` (calls into both player and enemy modules).

---

## 6  `src/sim/particles/elementProfiles.ts`  (644 lines)

A large lookup table of `ElementProfile` objects (one per `ParticleKind`),
each containing dozens of tuning constants.

### Proposed splits

- [ ] **`src/sim/particles/elementProfiles/equippableProfiles.ts`** — Profiles
  for the equippable kinds (Physical through Void, indices 0–13).

- [ ] **`src/sim/particles/elementProfiles/environmentalProfiles.ts`** — Profiles
  for non-equippable / environmental kinds (Fluid, Water, Lava, Stone, Gold,
  Light, indices 14–19).

- [ ] Keep `elementProfiles.ts` as the barrel that assembles the
  `ELEMENT_PROFILES` array and exports `getElementProfile`.

---

## 7  `src/levels/rooms.ts`  (555 lines)

All room definitions live in one file.  As more rooms are added this will
become unwieldy.

### Proposed splits

- [ ] **`src/levels/rooms/lobby.ts`** — Stone Hollow (lobby) room definition.

- [ ] **`src/levels/rooms/world1Rooms.ts`** — All World 1 room definitions.

- [ ] **`src/levels/rooms/world2Rooms.ts`** — All World 2 room definitions.

- [ ] **`src/levels/rooms/bossRooms.ts`** — Boss-room definitions (Luminous
  Chamber and any future boss rooms).

- [ ] Keep `rooms.ts` as an index that re-exports all rooms and the
  `getRoomById` / `getAllRooms` helpers.

---

## 8  `src/sim/clusters/radiantTetherChains.ts`  (531 lines)

Boss chain simulation and rendering data preparation mixed together.

### Proposed splits

- [ ] **`src/sim/clusters/radiantTetherChainSim.ts`** — Pure sim-side chain
  physics: spring integration, chain update tick, lifetime management.

- [ ] **`src/render/clusters/radiantTetherChainRenderer.ts`** — Chain rendering
  helpers (currently in the file or `radiantTetherRenderer.ts`).

- [ ] Keep `radiantTetherChains.ts` as a compatibility re-export if it is
  already imported widely, or update all import sites.

---

## Progress Log

| Date | Agent | Summary |
|------|-------|---------|
| *(none yet)* | — | — |
