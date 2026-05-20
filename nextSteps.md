# DustWeaver — Next Steps

## BUILD 375 — Collectible Dust Types + Campaign Spawn Starting Options

### What Was Implemented

1. **All 17 dust types are now collectible and equippable** (`src/sim/particles/kinds.ts`, `src/sim/weaves/dustDefinition.ts`):
   - `EQUIPPABLE_KINDS` expanded from 1 (Physical only) to all 17 elemental/material dust types.
   - `DUST_DEFINITIONS` expanded with display names, colors, descriptions, and slot costs for all 17 types.
   - Fluid (background particle), Gold (grapple chain), and Light (boss chains) remain non-collectible.

2. **Persistent dust swarm collection** (`src/progression/playerProgress.ts`, `src/progression/saveSlots.ts`, `src/screens/gameCommandProcessor.ts`, `src/screens/gameScreen.ts`):
   - Added `collectedDustSwarmKeys: string[]` to `PlayerProgress`.
   - When a dust swarm is collected, the key is persisted to `progress.collectedDustSwarmKeys`.
   - On session start, `collectedDustSwarmKeySet` is initialized from `progress.collectedDustSwarmKeys`.
   - Migration added so older saves without this field load cleanly.

3. **Campaign Spawn starting options** (`src/levels/campaignSchema.ts`):
   - `CampaignSpawnData` extended with optional `startingHealth`, `startingDustContainerCount`, `startingDustTypes`, `startingWeaves` fields.
   - Fully backward-compatible — older campaigns without these fields behave as before.

4. **Editor inspector UI for campaign spawn starting options** (`src/editor/editorInspector.ts`, `src/editor/editorCampaignSpawn.ts`, `src/editor/editorState.ts`, `src/editor/editorController.ts`):
   - Campaign spawn inspector now shows Starting Health (number), Starting Containers (number), Starting Dust Types (checkbox grid), Starting Weaves (checkbox grid).
   - `state.campaignSpawnStartingOptions` mirrors the spawn data's optional starting fields.
   - Moving/replacing a campaign spawn preserves its existing starting options.

5. **Applying campaign spawn options at play start** (`src/game.ts`):
   - When playing a packed custom campaign, `startingHealth`, `startingDustContainerCount`, `startingDustTypes`, and `startingWeaves` are applied to a fresh `PlayerProgress` before the first room loads.
   - `startingHealth` is clamped to `[1, PLAYER_INITIAL_HEALTH]`.
   - `startingDustContainerCount` is clamped to `>= 0`.
   - Invalid/unknown dust type names and weave IDs are silently skipped.

### Known Limitations / Remaining Work

1. **Multi-dust spawn on first room load** (`src/screens/gameScreen.ts`, Phase B ~line 483):
   - When a campaign grants multiple starting dust types (`startingDustTypes: ["Fire", "Ice"]`), only the first type (`unlockedDustKinds[0]`) is spawned as initial particles. The player sees the correct types in the loadout/save tomb UI, but only one type orbits them until they configure the weave loadout at a save tomb.
   - **Recommended fix**: In Phase B, iterate all `unlockedDustKinds` and distribute capacity evenly across all unlocked types, spawning each into the cluster. Consider using `spawnWeaveLoadoutParticles` with a synthesized loadout, or extend the existing `spawnClusterParticles` loop.

2. **Folder-based campaign starting options not applied** (`src/game.ts` ~line 130):
   - When playing a campaign loaded via `source.loadFolderCampaign` (file-system campaigns), the campaign spawn starting options are not applied (those campaigns don't have a `SavedCampaignV1` in memory at that point).
   - **Recommended fix**: After `initRoomRegistry()`, call `getLoadedOfficialCampaignSpawn()` and apply its starting options the same way as packed campaigns.

3. **Official (non-custom) campaign starting options** (`src/game.ts` ~line 99):
   - The official campaign's spawn options are applied as a `campaignSpawnOverride` (position only). The `startingHealth` etc. from `getLoadedOfficialCampaignSpawn()` are not yet applied to the official-campaign `PlayerProgress`.
   - **Recommended fix**: After retrieving `officialSpawn`, create/modify the progress with the spawn's starting options, similar to the custom campaign flow.

4. **Campaign spawn validation** (`src/levels/campaignSchema.ts`, `validateSavedCampaign`):
   - The `validateSavedCampaign` function does not yet validate the optional new fields in `CampaignSpawnData` (startingHealth range, startingDustTypes names, startingWeaves IDs). Invalid values are silently ignored at apply time, which is safe but not explicit.
   - **Recommended fix**: Add optional validation for `campaign.campaignSpawn.startingDustTypes` (check each is a valid `DUST_KIND_OPTIONS` entry) and `campaign.campaignSpawn.startingHealth` range.

5. **`startingHealth` for official play**: the `startingHealth` field is only consumed for custom campaign play (`customCampaignPlay` branch). For the main game (`gameplay` branch), `PLAYER_INITIAL_HEALTH` is always used as the fallback.

## BUILD 359 — Combat/Dust Integration Polish

### What Was Implemented

1. **Storm Weave gating** (`src/sim/weaves/weaveCombat.ts`):
   - `applyStormAttraction` now only fires when `world.playerPrimaryWeaveId === WEAVE_STORM`.
   - Previously it ran unconditionally, breaking the `isMoteSourceOrbitFlag` distinction.

2. **Mote/particle sync invariant** (`src/sim/motes/orderedMoteQueue.ts`):
   - New `depleteMoteSlot(world, slotIndex, cooldownTicks?)` central helper.
   - `syncMoteQueueWithParticles` now extends `respawnDelayTicks` on killed mote
     particles to `BASE_MOTE_REGENERATION_TICKS`, preventing them from respawning
     while their logical slot is still depleted.
   - `tickMoteSlotRegeneration` now sets `respawnDelayTicks[pidx] = 1` when a slot
     restores, triggering physical particle respawn on the next lifetime tick.

3. **Hot-path allocation fix** (`src/sim/particles/forces.ts`):
   - Three `new Map` allocations per tick in `applyInterParticleForces` replaced with
     module-level Maps cleared with `.clear()` each tick.

4. **Legacy combat path documentation** (`src/sim/particles/combat.ts`):
   - Added a clear architecture note explaining that `triggerAttackLaunch` and
     `applyBlockForces` are vestigial no-ops (flags never set by input), while
     `tickAttackMode` is still required for enemy AI.

5. **`combatDustPolishDecisions.md`** (new): full audit of the combat/dust
   architecture and all decisions from this pass.

### Remaining Work — Not Finished in BUILD 359

#### Mote kind colors for sword blade and arrows
- File: `src/render/effects/swordWeaveRenderer.ts`, `src/render/effects/arrowWeaveRenderer.ts`
- Data already in: `world.moteSlotKind[]` (Uint8Array, one per slot)
- Work needed:
  1. Add `particleMoteSlotState: Uint8Array` (and optionally `particleMoteSlotKind: Uint8Array`)
     to `ParticleSnapshot` in `src/render/snapshotTypes.ts`.
  2. Populate in `updateSnapshotInPlace` (`src/render/snapshot.ts`) by scanning
     `world.moteSlotParticleIndex` and `world.moteSlotState` — O(MAX_MOTE_SLOTS) per frame.
  3. Update `src/render/snapshotAllocating.ts` (`createSnapshot`) similarly.
  4. Use `particleMoteSlotState` in the Canvas2D arc renderer and WebGL renderer to
     reduce alpha (e.g., 0.25×) for depleted-slot particles (visual "spent state").
  5. Use `particleMoteSlotKind` in `swordWeaveRenderer.ts` to tint blade segments.
- Risk: low; renderer-only change.

#### Visual spent-state for depleted mote particles
- Linked to the above: once `particleMoteSlotState` is in the snapshot, depleted-slot
  particles can be rendered with reduced alpha (fade-out "spent" look).
- The physical/logical invariant is already enforced in BUILD 359 so the particle will
  be dead (not visible) during most of the depletion period.  The visual change mainly
  covers the ~1-tick window after airborne landing.

#### Remove vestigial player attack/block input paths
- File: `src/sim/particles/playerCombat.ts`, `src/sim/particles/combat.ts`
- `triggerAttackLaunch` and `applyBlockForces` are never reached in normal gameplay.
- To clean up: either gate behind `ENABLE_LEGACY_PLAYER_COMBAT = false` flag or
  remove entirely if no future feature requires them.
- Low risk, but requires auditing that no test or editor tool sets the flags.

#### Armor based on logical mote count
- File: `src/sim/particles/forces.ts` (`applyInterParticleForces`)
- Current: `playerArmor = Math.floor(physicalDustCount / DUST_PARTICLES_PER_ARMOR)`
- In BUILD 359 the physical count and logical available count are closely aligned.
- Future: if a new weave depletes motes without killing particles, switch to
  `Math.floor(getAvailableMoteSlotCount(world) / DUST_PARTICLES_PER_ARMOR)`.
- No balance change yet — document the intent here.

#### Airborne respawn-freeze and mote regeneration
- When the player is airborne, `updateParticleLifetimes` freezes countdown for
  player-owned particles, but mote cooldowns still decrement.
- After `tickMoteSlotRegeneration` sets `respawnDelayTicks[pidx] = 1`, the particle
  will not actually respawn until the player lands.
- The 1-tick window where the HUD shows the mote as AVAILABLE but the particle is
  still dead is a known documented exception (see `combatDustPolishDecisions.md §2`).
- Future fix: defer slot restoration until the particle is confirmed alive, or add a
  "pending restore" state to the mote FSM.

#### Debug test room / debug overlay for combat
- A dedicated test room or debug panel (gated with `import.meta.env.DEV`) would make
  it easy to verify: arrow spend depletes motes, sword length scales, shield density
  scales, grapple range shrinks/restores, motes flash on regen.
- Not implemented in BUILD 359.

---


### What Was Implemented

1. **`RoomWallTemplate` + split of `loadRoomWalls`** (`src/screens/gameRoomWalls.ts`):
   - `buildRoomWallTemplate(room)` runs the expensive O(n²) iterative merge pass and
     returns a compact `RoomWallTemplate` (typed arrays sized to actual post-merge wall
     count, not `MAX_WALLS`).
   - `applyRoomWallTemplate(world, template)` is a fast O(n) copy into `WorldState`.
   - `loadRoomWalls` is kept as a compatibility wrapper for any callers outside the
     main load path.

2. **`RoomRuntimeCache`** (`src/screens/roomRuntimeCache.ts`):
   - LRU-evicting Map-based cache keyed by room ID.
   - Stores `RoomWallTemplate` + `EdgeExtensionCache` per room.
   - Default capacity: 10 rooms (current room + 2-hop radius + headroom).
   - `invalidate(roomId)` called by the editor reload callback so edits take effect.

3. **`roomPreloadScheduler.ts`** (`src/screens/roomPreloadScheduler.ts`):
   - `scheduleRoomPreloads(currentRoom, registry, cache)` BFS-traverses 2 hops.
   - Radius-1 rooms are enqueued first (urgent); radius-2 rooms second (background).
   - Each idle callback processes one room and re-schedules using `requestIdleCallback`
     (with `setTimeout(0)` fallback for Safari/Firefox).
   - Idempotent: skips rooms already in cache.
   - Returns a handle; previous handle is cancelled on each new room load.

4. **`gameScreen.ts` integration**:
   - Phase D: uses `roomRuntimeCache.get(room.id)` before calling `buildRoomWallTemplate`.
     Cache HIT → `applyRoomWallTemplate` only.  Cache MISS → build + store + apply.
   - Phase F: uses cached `EdgeExtensionCache` when available.  On miss: builds, stores,
     and falls back gracefully.
   - Editor reload callback calls `roomRuntimeCache.invalidate(roomDef.id)` before
     `loadRoom()` so stale geometry is never used after an editor change.
   - Teardown cancels the active preload schedule handle.
   - Dev-mode (`import.meta.env.DEV`) console logs show cache HIT/MISS + timing.

5. **`roomAssetPreloader.ts`**:
   - Added `preloadNearbyRoomAssets(room, radius)` for BFS-based radius-N sprite
     preloading used by the preload scheduler.

### Remaining Work — Async Load Path (Not Yet Implemented)

The `_makeLoadRoomPhases()` generator already yields between each phase, but
`loadRoom()` still drains it synchronously in one frame.  Making transitions
non-blocking requires the following additional work:

#### `startAsyncLoadRoom()` in `src/screens/gameScreen.ts`
- File: `src/screens/gameScreen.ts`
- Status: **not started**
- Approach:
  1. When a room transition fires, start the generator (`_makeLoadRoomPhases`)
     but do NOT drain it — store the generator reference.
  2. Show the existing loading/fade overlay (call `showLoadingOverlay()`).
  3. Each `frame()` call: if a load is in progress, advance the generator by
     one phase (or until the frame budget is exhausted) and render only the
     overlay.  When the generator is done, clear the overlay.
  4. Player momentum (`preTransVX`, `preTransVY`) must be captured before the
     transition fires and restored after Phase B completes.
  5. Transition cooldown should still be set at the moment the transition fires
     (not when the load completes) to prevent double-trigger.
- Recommended steps:
  1. Add `type AsyncLoadState = { gen: Generator<void>; room: RoomDef; ... } | null`
     state variable.
  2. Replace `loadRoom(room, ...)` in `orchestrateRoomTransitions` callback with
     `startAsyncLoadRoom(room, ...)`.
  3. In `frame()`, before the sim tick block, check `asyncLoadState !== null` and
     advance one phase per frame.
  4. Show `loadingOverlay` for the first frame of the async load, hide it after
     Phase F completes (same condition as initial load: `areRoomSpritesReady`).
  5. Fast path: if `roomRuntimeCache.has(room.id)` already has both `wallTemplate`
     and `edgeExtension`, apply them synchronously and skip the generator entirely.

#### Outstanding known performance issue (O(n²) merge pass)
- File: `src/screens/gameRoomWalls.ts`, `buildRoomWallTemplate()`
- The iterative merge pass is still O(n²) in the worst case.  With the cache,
  this only runs once per room per session (or after editor edits), but large
  rooms (200+ wall tiles) can still cause a ~40–80 ms spike on cache miss
  (e.g. first campaign load or first visit to a large room).
- Recommended fix: replace the double-loop with a sort-and-sweep merge similar
  to the sweep-line algorithm used in 2D geometry processing.
- Status: deferred; the cache eliminates the problem for all subsequent visits.

---

### Background

BUILD 349 temporarily restored simple (instant) room transitions by setting
`ENABLE_SIMPLE_ROOM_TRANSITIONS = true` in
`src/render/transitions/transitionConfig.ts`.  The fancy seamless-crossing and
camera-interpolation systems introduced in BUILDs 279–297 were left intact
behind feature flags so they can be re-enabled when they are stable.

### What Was Verified in BUILD 356

1. **Simple-transition path confirmed correct** (`src/screens/gameScreen.ts`,
   `src/render/transitions/transitionConfig.ts`):
   - `ENABLE_SIMPLE_ROOM_TRANSITIONS = true` — room transitions call
     `loadRoom(room, validSpawnX, validSpawnY)` immediately with no camera
     rewind, no interpolation, and no camera restore.
   - `ENABLE_TWO_ROOM_CAMERA_CROSSING = false` — two-room side-by-side
     rendering is disabled; `crossingState.phase` never leaves `'inactive'`.
   - `ENABLE_TRANSITION_CAMERA_REVEAL = false` — no near-transition or
     post-transition camera reveal offsets are applied.
   - Camera snaps to the destination spawn via `snapCamera()` in Phase F.
   - `resolveSpawnBlock()` prevents spawning inside a solid wall (falls back to
     `findOpenSpawnBlock()` and logs a warning).
   - Transition cooldown (`TRANSITION_COOLDOWN_MS = 400 ms`) prevents the
     adjacent return-transition from double-firing immediately after spawn.
   - All four crossing directions (left, right, up, down) go through the same
     code path and are confirmed correct by code analysis.

2. **Defensive hardening of `cancelCameraTransition`**
   (`src/screens/gameCameraState.ts`):
   - `cancelCameraTransition` now also clears `prevHadUnionBounds` and
     `camSettlingFramesLeft` so that even if the seamless-crossing system is
     partially re-enabled in a future build, a room load via the simple path
     will not inherit stale union-bounds settling state.
   - Under the current flag configuration these fields are never mutated, so
     this is a purely defensive change with no runtime effect.

### How to Re-Enable Fancy Transitions Later

To restore the BUILD 279–319 seamless-crossing behaviour, set the following
flags in `src/render/transitions/transitionConfig.ts`:

```typescript
ENABLE_TWO_ROOM_CAMERA_CROSSING   = true   // re-enable side-by-side rendering
ENABLE_TRANSITION_CAMERA_REVEAL   = true   // optional: camera peek near exits
```

Before re-enabling, address the known issues listed in the BUILD 319 entry
below (staged enemy/hazard simulation, wall auto-tile seam artefacts, narrow-
room camera snap on finalization).  The settling-window code in
`gameCameraState.ts` (`camSettlingFramesLeft`, `prevHadUnionBounds`) and the
`finalizeCrossingSeamless` path in `gameSeamlessStaging.ts` remain intact for
this purpose.

---

## BUILD 319 — Performance & Seamless Crossing Improvements

### What Was Completed in BUILD 319

1. **Shadow occluder allocation reduction** (`src/render/effects/shadowCaster.ts`):
   - Removed `readonly` from `ShadowCasterOccluderPx` fields to allow in-place mutation.
   - Added module-level pool of 4 mutable occluder objects (`_shadowPool`).
   - `buildPlayerShadowOccluders` fills pool objects in-place instead of calling `out.push({...})`.
   - Up to 4 object-literal allocations per frame eliminated in DarkRoom mode.

2. **Decoration bloom allocation reduction** (`src/render/effects/glowPass.ts`,
   `src/render/effects/wallDecorations.ts`):
   - Added `GlowPass.drawCircleDirect(x, y, radius, intensity, color)` that accepts flat arguments.
   - `addDecorationBloom` now calls `drawCircleDirect` instead of `drawCircle({...})`, eliminating
     nested `{ x, y, radius, glow: { enabled, intensity, color } }` object literals per bloom call.

3. **Environmental dust wall spatial partitioning** (`src/render/environmentalDust.ts`):
   - Added `_wallColumnGrid: Map<number, number[]>` (cell width = 32 world units).
   - `_buildWallGrid(world)` called once per room load: registers each wall index in every
     column cell it spans.
   - `resolveWorldCollisions` now looks up only the column bucket for the particle's X position
     for both the AABB collision pass and the surface-anchor pass, reducing worst-case cost from
     O(particles × walls) to O(particles × walls-in-column).

4. **Staged room background rendering** (`src/screens/gameRender.ts`, `src/screens/gameScreen.ts`):
   - Added `StagedRoomBgInfo` interface and `stagedRoom: StagedRoomBgInfo | null` field to
     `RenderFrameContext`.
   - When `stagedRoom` is non-null, `renderFrame` clips each room's background to its own
     screen-space rect using nested `ctx.save()/clip()/restore()`, then calls
     `renderWorldBackground` for the staged room first (with adjusted camera offset
     `ox + originXWorld * zoom`) and then for the active room.
   - Eliminates the visual discontinuity where the active room's background filled the full
     union clip rect when rooms had different backgrounds.
   - `gameScreen.ts` populates `stagedRoom` from `stagingState.stagedRooms[0]`.

5. **Camera settling after seamless crossing finalization** (`src/screens/gameCameraState.ts`):
   - Added `camSettlingFramesLeft`, `settlingMinX/Y/MaxX/Y`, `prevHadUnionBounds` to
     `GameCameraState` and `CAM_SETTLING_FRAMES = 21` constant.
   - When `renderUnionBounds` transitions from non-null → null, the settling window starts:
     effective bounds lerp frame-by-frame from the captured union bounds toward the new
     single-room bounds over 21 frames (~0.35 s at 60 fps), preventing the camera snap on
     rooms narrower or shorter than 480×270 px.
   - After settling expires, the existing `CAMERA_BOUNDS_LERP_SPEED` lerp resumes as before.
   - This path is currently dormant (`ENABLE_TWO_ROOM_CAMERA_CROSSING = false`) but is in place
     for when seamless crossings are re-enabled.

---

## BUILD 318 — Campaign Spawn Trigger & Fade From Black

### What Was Completed in BUILD 318

1. **Campaign Spawn data model** (`src/levels/campaignSchema.ts`):
   - New `CampaignSpawnData` interface: `{ roomId: string; xBlock: number; yBlock: number }`.
   - `SavedCampaignMetadata` gains optional `campaignSpawn?: CampaignSpawnData`.
   - Backward compatible — older campaigns without `campaignSpawn` continue to load.

2. **Official campaign spawn loaded from registry** (`src/levels/rooms.ts`):
   - `initRoomRegistry()` stores `campaignSpawn` from the packed campaign in `loadedOfficialCampaignSpawn`.
   - New `getLoadedOfficialCampaignSpawn()` getter exposed for `game.ts`.
   - `loadedOfficialCampaignRevisionMetadata` and `loadedOfficialCampaignSpawn` are reset on `initRoomRegistry()`.

3. **Editor palette** (`src/editor/editorDropdownData.ts`):
   - Added `campaign_spawn` item (label: `Campaign Spawn`, category: `triggers`).
   - Renamed existing `player_spawn` item label from `Player Spawn` to `Room Spawn (Fallback)`.

4. **Editor state** (`src/editor/editorState.ts`):
   - Added `'campaignSpawn'` to `SelectedElementType`.
   - Added `campaignSpawnBlock: [number, number] | null` to `EditorState`; initialized to `null`.

5. **Editor tools** (`src/editor/editorTools.ts`, `src/editor/editorDeleteTool.ts`):
   - `selectAtCursor` hit-tests `state.campaignSpawnBlock` — returns `{ type: 'campaignSpawn', uid: 0 }`.
   - `deleteAtCursor` clears `state.campaignSpawnBlock = null` when cursor hits campaign spawn.
   - Controller calls `syncCampaignSpawnToSessionAfterDelete()` after every delete to update session.

6. **Editor rendering** (`src/editor/editorOverlayDrawers.ts`, `src/editor/editorRendererHelpers.ts`):
   - Campaign spawn drawn as ⭐ with a gold footprint outline.
   - "CAMPAIGN SPAWN" label rendered below marker when selected or hovered.
   - New color constants `CAMPAIGN_SPAWN_COLOR` and `CAMPAIGN_SPAWN_SELECTED`.
   - Tooltip/name maps updated to include `campaignSpawn`.

7. **Editor controller** (`src/editor/editorController.ts`):
   - `loadRoomForEditing` syncs `state.campaignSpawnBlock` from session on room load.
   - New helpers: `syncCampaignSpawnBlockFromSession`, `syncCampaignSpawnToSessionAfterDelete`,
     `showCampaignSpawnReplaceModal`, `placeCampaignSpawn`.
   - Singleton enforcement: placing `campaign_spawn` when another exists in a different room shows
     a modal: **"This will remove the current campaign spawn, proceed?"** with Yes/No.
   - Choosing Yes removes old spawn and places new one; updates session `campaignSpawn` and `initialRoomId`.
   - Campaign spawn property changes handled directly in the controller's `onPropertyChange` hook
     (bypasses room-data path since campaign spawn is not stored in room JSON).

8. **Inspector** (`src/editor/editorInspector.ts`):
   - `campaignSpawn` element shows xBlock/yBlock fields, editable via property change.

9. **New campaign sessions** (`src/editor/editableCampaignSession.ts`):
   - `createNewCampaignSession` pre-populates `campaignSpawn` at the starter room's spawn position.
   - `assembleExportCampaign` automatically includes `campaignSpawn` via `...session.campaign.campaign`.
   - `initialRoomId` is kept synchronized with `campaignSpawn.roomId` when a spawn is placed.

10. **Runtime start logic** (`src/game.ts`, `src/screens/gameScreen.ts`):
    - Main campaign: uses `getLoadedOfficialCampaignSpawn()` to set start room and position when
      the player has no save slot.
    - Custom campaign play: extracts `campaignSpawn` from packed campaign; passes room and block
      position as `startRoomId` and `campaignSpawnBlockOverride` to `startGameScreen`.
    - `startGameScreen` accepts new optional `campaignSpawnBlockOverride?` parameter.
    - `desiredSpawnBlock` uses `campaignSpawnBlockOverride` instead of `currentRoom.playerSpawnBlock`
      when available (save data still takes priority).
    - Death-respawn uses campaign spawn room and block when no save exists.

11. **Fade from black** (`src/screens/gameLoadingOverlay.ts`, `src/screens/gameScreen.ts`):
    - `GameLoadingOverlay.show(isCampaignInitialLoad?)` — when true, uses 700 ms fade (vs 300 ms).
    - `gameScreen.ts` calls `showLoadingOverlay()` on every initial game start (even when sprites
      are already cached), ensuring a deliberate fade-from-black at campaign start.
    - Subsequent room-load overlays (mid-session sprite cache misses) use the standard 300 ms fade.

---

## Remaining / Deferred Work

Items are grouped by risk and origin.

---

### Campaign & File System

#### ~~1. Dynamic `STARTING_ROOM_ID`~~ — **Superseded by Campaign Spawn (BUILD 318)**
**Resolution (BUILD 318):** The Campaign Spawn system is now the authoritative source for the
starting room and block position. `STARTING_ROOM_ID = 'lobby'` is retained as a last-resort fallback.

---

### Rendering — Seamless Crossing (Deferred — requires ENABLE_TWO_ROOM_CAMERA_CROSSING)

#### 1. Staged room hazards / enemies / ropes
**Files:** `src/screens/gameSeamlessStaging.ts`, `src/sim/world.ts`, enemy AI files  
**Issue:** Hazards (water/lava/spikes), enemies, falling blocks, and ropes from the staged
room are not preserved after `loadRoom()`. Players can walk through them without interaction.  
**Proposed path:** Before `loadRoom()` in `_finalizeCrossingSeamless`, snapshot the staged
room's hazard arrays and enemy clusters; after `loadRoom()`, re-append them at the staged
room's world-space offset. Enemy AI requires sim-layer awareness of the offset.  
**Blocker:** `ENABLE_TWO_ROOM_CAMERA_CROSSING = false` in `src/render/transitions/transitionConfig.ts`.
Re-enable crossing first, then address this sim-layer change.  
**Risk:** High — requires non-trivial sim-layer changes; defer to a dedicated pass.

---

### Rendering — Performance

#### 2. Spatial partitioning for DarkRoom particle-light loop
**File:** `src/render/effects/darkRoomOverlay.ts`, `src/screens/gameDarkRoomLighting.ts`  
**Issue:** The particle-light contribution loop in `renderDarkRoomLighting` scans all
particles linearly (O(n)). With thousands of particles this can be costly even though
viewport culling and `maxParticleLightCount` limit how many lights are emitted.  
**Proposed fix options:**
- Add a compact alive-Physical index list to `WorldSnapshot` (one sweep per frame, maintained
  during `updateSnapshotInPlace`), letting the render loop skip dead/non-Physical particles.
  Requires snapshot schema change but no cross-layer spatial coupling.
- Or: build a per-frame volatile spatial index from snapshot particle positions for the
  lighting pass only. Acceptable since it's render-only.  
**Blocker:** Any approach requires either snapshot schema changes or a per-frame allocation.
  The existing viewport-cull + quality-cap already limits practical cost to tens of particles
  per frame in most rooms.  
**Risk:** Medium — cross-layer or snapshot interface changes needed.

#### 3. Large-room stress-test room
**File:** New file in `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/` or editor export  
**Issue:** No dedicated profiler test room exists with high decoration, background block,
and liquid/hazard coverage to measure chunk-rebuild performance across builds.  
**Required steps (editor-only, cannot be hand-authored safely):**
  1. Open editor, create a new room ~120×80 blocks.
  2. Add 200+ decorations, 30+ background block defs, 10+ dust containers, 4 sunbeam emitters,
     representative liquid zones and spike hazards.
  3. Export room JSON to `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/dev_stress_test.json`.
  4. Add to the room registry (`src/levels/rooms.ts`) behind a dev flag so it is accessible
     from the editor visual map without appearing in the campaign path.  
**Risk:** Low — does not affect existing rooms. Must be done via editor, not hand-written JSON.

---

### Editor — Placement Performance

#### 4. Editor placement freeze — active-room-only edits (BUILD 340)
**Files:** `src/editor/editorController.ts`, `src/editor/editorHistory.ts`

**What was fixed in BUILD 340:**
- Placement/delete hot path now mutates only active room state and no longer calls `onLoadRoom` per placement.
- `applyEdits` now has `placement` vs `metadata` modes; placement mode marks dirty state only and skips room rebuild/reload.
- Added explicit boundary commit flow: `commitActiveRoomToCampaign(reason)` used for room switch, playtest/confirm, export, and manual save.
- Added richer placement perf log output:
  `[editor-perf] placeBlock total=... touchedCampaign=false committedRoom=false stringified=false localStorage=false dehydrated=false campaignValidated=false allRoomsLooped=false cacheInvalidation=local`
- Undo/redo snapshots switched from JSON stringify/parse to `structuredClone`, removing JSON serialization from placement hot path.

**Remaining work not completed in BUILD 340:**
1. Undo/redo is still full-room snapshot-based (now clone-based), not delta-based transactions by tile/tool.
2. No new measured timing capture has been recorded yet after BUILD 340 in a large-room stress run.

**Manual verification still needed:**
- Paint 100+ blocks in a large room and confirm no 1–2s freeze and immediate overlay response.
- Verify room switch + save/discard keeps/rolls back edits correctly with campaign sessions.
- Verify playtest and export include latest active-room edits without per-placement campaign commit.

**Compatibility risk to monitor:**
- Any future feature that relies on ROOM_REGISTRY being updated every placement may now need an explicit metadata sync point (currently done on metadata edits and map-open paths).

---

## BUILD 350 — Monolith Refactor Follow-up

### What was completed in BUILD 350

1. **Extracted render quality orchestration**
   - Added `src/screens/gameRenderQuality.ts`.
   - Moved adaptive quality config + renderer/system propagation + chunk-cache cap updates out of `gameRender.ts`.

2. **Extracted background/effect orchestration**
   - Added `src/screens/gameRenderBackgroundPass.ts`.
   - Moved staged/active room background draw flow and procedural background effects (Thero + Crystalline Cracks) out of `gameRender.ts`.

3. **Extracted scene-light pass orchestration**
   - Added `src/screens/gameRenderSceneLighting.ts`.
   - Moved scene-light initialization, room-change occluder dirty marking, and pass rendering out of `gameRender.ts`.

4. **Updated game renderer wiring only**
   - `src/screens/gameRender.ts` now delegates to the extracted modules without changing public interfaces or runtime feature set.

### Remaining / deferred from this pass

1. `src/screens/gameRender.ts` is still sizable and can be further split (for example clip-region and world-entity pass orchestration), but this was deferred to avoid high-risk render-order regressions.
2. `src/screens/gameScreen.ts` and `src/editor/editorController.ts` remain monolithic and are good candidates for future low-risk extraction passes.
3. Keep monitoring large-room and crossing scenarios manually to confirm no visual ordering regressions after additional renderer extractions.

### Validation to run/confirm for this build

1. `npm run build`
2. `npm run lint` (pre-existing lint errors may still appear in unrelated files)

---

## BUILD 351 — Additional Monolith Refactor Follow-up

### What was completed in BUILD 351

1. **Extracted editor backdrop renderer from `gameScreen.ts`**
   - Added `src/screens/gameScreenEditorBackdrop.ts`.
   - Moved the editor-consuming render branch into `renderEditorBackdrop(...)`.
   - Kept rendering behavior and pass ordering unchanged while reducing `gameScreen.ts` size/complexity.

### Remaining / deferred from this pass

1. `gameScreen.ts` still contains large room-loading and frame-update control flow that can be split further (e.g., load phases, transition/sim tick orchestration), but this was deferred to avoid risky control-flow regressions.
2. `editorController.ts` remains a large candidate for future low-risk extraction.

---

## BUILD 352 — Dialogue setup extraction follow-up

### What was completed in BUILD 352

1. Extracted room-load dialogue visit initialization from `gameScreen.ts` into `prepareRoomDialogueVisitState(...)` in `src/screens/gameDialogueHandler.ts`.
2. Kept `checkDialogueTriggers(...)` hot-path contract intact by continuing to feed pre-converted cached conversations.

### Remaining / deferred from this pass

1. `gameScreen.ts` still contains a large transition + fixed-tick orchestration branch that can be split further.
2. `editorController.ts` remains a large module suitable for additional low-risk decomposition.

---

## BUILD 353 — Cloak update extraction follow-up

### What was completed in BUILD 353

1. Extracted per-frame procedural cloak animation from `gameScreen.ts` into `src/screens/gamePlayerCloakUpdate.ts` via `updatePlayerCloaks(...)`.
2. Both `PlayerCloak` and `PhantomCloakExtension` continue to receive the render-interpolated player position; behavior is unchanged.

### Remaining / deferred from this pass

1. `gameScreen.ts` still contains the crumble-block debris event scan inside the physics tick loop — a small but coherent chunk that could be extracted in a future pass.
2. `gameScreen.ts` transition + sim-tick orchestration blocks remain good candidates for future decomposition.

---

## BUILD 354 — Crumble debris event extraction follow-up

### What was completed in BUILD 354

1. Extracted the per-tick crumble-block debris event scan from the physics accumulator loop in `gameScreen.ts` into `src/screens/gameCrumbleDebrisEvents.ts` via `tickCrumbleDebrisEvents(...)`.
2. The function compares `prevCrumbleActive`/`prevCrumbleHits` snapshots against the post-tick world state, fires `notifyBlockHit` on the `CrumbleDebrisRenderer`, updates the prev-state arrays, and calls `crumbleDebris.update(dtMs)` — all originally done inline.
3. No behavioral change; the pair `[scan → update]` was preserved and is still called once per fixed timestep.

### Remaining / deferred from this pass

1. `gameScreen.ts` physics accumulator loop still owns: cluster prev-position capture, falling-block prev-offset capture, and player-input forwarding. These could be extracted in a subsequent pass.
2. Post-loop camera, transition-reveal, and HUD update blocks also remain as future extraction candidates.

---

## BUILD 355 — Interpolation buffer capture extraction follow-up

### What was completed in BUILD 355

1. Extracted render-interpolation buffer management from `gameScreen.ts` into `src/screens/gameInterpolationBuffers.ts`.
2. Added `createGameInterpolationBuffers()`, `captureClusterInterpolationState(...)`, and `captureFallingBlockInterpolationState(...)`.
3. `gameScreen.ts` now delegates both room-load cluster snapshot capture and per-fixed-tick interpolation-state capture through the helper without changing timing or data flow.

### Remaining / deferred from this pass

1. `gameScreen.ts` fixed-tick loop still owns player-input forwarding, slime split handling, and per-system post-tick updates.
2. Post-loop camera, transition-reveal, and HUD update blocks remain future extraction candidates.

---

## BUILD 356 — Transition orchestration extraction follow-up

### What was completed in BUILD 356

1. Added `src/screens/gameRoomTransitionOrchestrator.ts` and moved the per-frame room-transition orchestration block out of `gameScreen.ts`.
2. `orchestrateRoomTransitions(...)` now owns cooldown decrement, transition trigger processing, camera-transition setup, velocity carry-over, transition reveal notifications, and transition debug-state updates.
3. `gameScreen.ts` now delegates this transition block while preserving existing room-load/preload and reveal-reset behavior.

### Remaining / deferred from this pass

1. `gameScreen.ts` still has a large fixed-step simulation loop containing input forwarding + per-system post-tick orchestration; this remains a high-value next extraction target.
2. Dialogue trigger checks and nearby camera/reveal orchestration are still inline in `gameScreen.ts` and can be extracted in a future low-risk pass.
3. `src/editor/editorController.ts` remains monolithic and is still a major candidate for decomposition.

### Validation follow-up

1. Re-run:
   - `npm run build`
   - `npm run lint`
2. Expectation: lint still reports only the known pre-existing issues in:
   - `src/editor/editorRoomBuilder.ts`
   - `src/screens/gameRoomFallingBlocks.ts`
   - `src/screens/gameTransitions.ts`

---

## BUILD 360 — Celeste-like wall-jump intent filtering

### What was completed in BUILD 360

1. Added `src/sim/clusters/playerWallJump.ts` — new module containing the wall-jump candidate helper with quality and intent checks:
   - `isValidWallJumpFace(playerTop, playerBottom, wallTop, wallBottom)` — rejects walls with insufficient vertical overlap (`WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD = 8 wu`) or whose top edge is within ledge-suppression range of the player's feet (`WALL_JUMP_LEDGE_SUPPRESS_WORLD = 4 wu`).
   - `hasWallJumpIntent(cluster, world, wallSideDir, usedProximity)` — requires at least one intent signal: wall sliding, away-from-wall input, or (direct-touch / grace only) falling with `airborneTicks >= WALL_JUMP_MIN_AIRBORNE_TICKS = 4`.
   - `getWallJumpCandidate(cluster, world)` — single public entry point; scans walls, applies quality + intent filters, returns `WallJumpCandidateResult` with per-side `canJumpFrom*`, distance for tie-breaking, and `dbgLeft`/`dbgRight` rejection reason strings.

2. Added new constants to `movementConstants.ts`:
   - `WALL_JUMP_REQUIRE_INTENT = true` — master toggle.
   - `WALL_JUMP_MIN_AIRBORNE_TICKS = 4` — minimum consecutive airborne ticks before a touch/grace wall jump is allowed without explicit away input.
   - `WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD = 8` — rejects single-small-block (3 wu) and single-medium-block (6 wu) side faces, requiring merged/tall walls.
   - `WALL_JUMP_LEDGE_SUPPRESS_WORLD = 4` — suppresses wall jumps off block tops near foot level.
   - `WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT = true` — proximity-only wall jumps need away-from-wall input or active wall slide.

3. Added `airborneTicks: number` to `ClusterState`; tracked at the top of `tickPlayerMovement` — increments while airborne, resets to 0 when grounded.

4. Updated `playerVerticalMovement.ts` to call `getWallJumpCandidate` instead of the old raw proximity scan + touch-flag check. The actual wall-jump application logic (velocity, force-time, lockout, etc.) is unchanged.

5. Removed the stale `getNearbyWallForWallJump` import from `playerVerticalMovement.ts` (now unused there; the function remains in `movementAxisResolvers.ts` for any other callers).

### Acceptance test notes

The following scenarios should be verified in-game:

| Scenario | Expected result |
|---|---|
| Running and jumping up a staircase of medium blocks | Ground jump fires each step; no accidental backward launch |
| Brushing the side of a 1-block ledge while jumping upward | Jump continues as ground/coyote jump; wall jump suppressed |
| Sliding down a tall wall, pressing jump | Strong wall jump fires (wall sliding = intent) |
| Airborne, pressing away from a tall wall, pressing jump | Wall jump fires (away input = intent) |
| Near a tall wall with `airborneTicks >= 4`, falling, pressing jump | Wall jump fires (airborne + falling = intent) |
| Wall-jump chains (skilled play) | Still possible; each jump builds airborneTicks before reaching next wall |
| Proximity wall jump near a ledge | Suppressed by quality filter + proximity intent check |

### Tuning recommendations (follow-up playtesting)

- **`WALL_JUMP_MIN_AIRBORNE_TICKS`** (currently 4): If players report that running up to a tall wall and jumping feels delayed, lower to 3. If stair clips still occasionally fire, raise to 5.
- **`WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD`** (currently 8): If any intentional wall-jump scenario against a short wall (height < 12 wu) fails, lower to 6. The 8 wu threshold intentionally blocks single-medium-block (6 wu) walls.
- **`WALL_JUMP_LEDGE_SUPPRESS_WORLD`** (currently 4): If ledge transitions feel sticky or jumps are blocked near block edges, lower to 3 or 2.
- **`WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT`** (currently true): If proximity wall jumps feel inaccessible in narrow corridors where the player faces into the wall, consider a separate narrow-passage exception.

### Debug visibility

The `WallJumpCandidateResult.dbgLeft` / `dbgRight` strings are ready to display in a movement debug overlay. Possible rejection values: `'lockout'`, `'no-wall-in-range'`, `'grace/touch+no-quality-wall'`, `'touch/grace+no-intent'`, `'proximity+no-intent'`. Acceptance values: `'touch+intent'`, `'grace+intent'`, `'proximity+intent'`.

To surface these in the debug HUD, pass the result from `getWallJumpCandidate` to the overlay renderer (render layer, read-only snapshot required).

### Remaining / deferred

1. The `dbgLeft`/`dbgRight` strings are not yet wired to the on-screen debug overlay. This is a render-layer task.
2. ~~`getNearbyWallForWallJump` in `movementAxisResolvers.ts` is now unused by the main player-movement path. It can be removed or repurposed in a future cleanup pass.~~ **Done in BUILD 366.**
3. Tuning values above should be validated against the full room set before merging to main.

---

## BUILD 367 — Upward transition velocity fix + depleted mote spent-state visual

### What Was Completed in BUILD 367

1. **Reduced upward room-transition velocity boost to 50 %**
   (`src/screens/gameRoomTransitionOrchestrator.ts`):
   - Changed multiplier from `1.0` to `0.5` for the upward-transition velocity carry-over.
   - `newPlayer.velocityYWorld = dir === 'up' ? preTransVY - PLAYER_JUMP_SPEED_WORLD * 0.5 : preTransVY;`
   - Resolves the over-boosted launch into the new room reported during play-testing.

2. **Depleted mote particle "spent" visual** (BUILD 359 remaining item):
   - Added `particleMoteSlotState: Uint8Array` to `ParticleSnapshot` in
     `src/render/snapshotTypes.ts` — per-particle flag: 0 = available, 1 = depleted.
   - Populated each frame in `updateSnapshotInPlace` (`src/render/snapshot.ts`) by
     scanning `world.moteSlotParticleIndex` and `world.moteSlotState` — O(MAX_MOTE_SLOTS)
     per frame, no allocation.
   - Also populated in `createSnapshot` (`src/render/snapshotAllocating.ts`) for the
     editor preview path.
   - Canvas 2D renderer (`src/render/particles/renderer.ts`): applies `alpha *= 0.25`
     for particles with `particleMoteSlotState[i] !== 0`.
   - WebGL renderer (`src/render/particles/webglRenderer.ts` + `shaders.ts`):
     - Added 7th float attribute `a_isSpent` to vertex format (`FLOATS_PER_VERTEX` 6 → 7).
     - Fragment shader multiplies `alpha` by `0.25` when `v_isSpent > 0.5`.
   - As documented in BUILD 359, the physical/logical invariant means the particle is
     usually dead during the depletion period; the spent visual mainly covers the ~1-tick
     window after airborne landing.

### Remaining / deferred

1. Mote kind colors for sword blade segments (`swordWeaveRenderer.ts`) — requires adding
   `particleMoteSlotKind: Uint8Array` to `ParticleSnapshot` following the same pattern.
2. Tuning values from BUILD 360 (`WALL_JUMP_MIN_AIRBORNE_TICKS`, etc.) should be
   validated against the full room set before merging to main.


