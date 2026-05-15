# DustWeaver — Next Steps

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

## All Pending / Deferred Work

Items are grouped by risk and origin. The letter tags (A–C) and numbered task tags
reference the build where the item was first documented.

---

### Campaign & File System (Low Risk)

#### 1. ~~Dynamic `STARTING_ROOM_ID`~~ — **Superseded by Campaign Spawn (BUILD 318)**
**File:** `src/levels/rooms.ts`  
~~**Issue:** `STARTING_ROOM_ID = 'lobby'` is a hard-coded fallback. Callers that use
`campaign.initialRoomId` are already correct, but code that reads `STARTING_ROOM_ID`
directly may silently break if the campaign's initial room changes.~~  
**Resolution (BUILD 318):** The Campaign Spawn system (`campaignSpawn` field in
`SavedCampaignMetadata`) is now the authoritative source for the starting room and
block position. `game.ts` reads `getLoadedOfficialCampaignSpawn()` and `campaign.campaignSpawn`
instead of hard-coded `STARTING_ROOM_ID`. The `STARTING_ROOM_ID = 'lobby'` constant is
retained as a last-resort fallback but is no longer the primary mechanism.

---

### Rendering — Seamless Crossing (Medium Risk)

#### 2. Staged room background rendering (Task 7)
**Files:** `src/screens/gameScreen.ts`, `src/screens/gameRender.ts`, background renderer files  
**Issue:** When a previous room is staged after seamless crossing, its background is not drawn.
The active room background fills the expanded clip rect, producing visual discontinuity
between rooms with different backgrounds.  
**Proposed fix:** Detect `stagingState.stagedRooms.length > 0` in `renderFrame()`, call
the background render pass a second time at the staged room's world-space origin offset
(`stagedRoom.originXWorld`, `stagedRoom.originYWorld`). The background renderer API may
need an `originOffsetWorld` parameter.  
**Risk:** Medium — need to verify the background renderer handles world-space offsets
correctly without bleed. Do not re-enable edge-extension preview in the same pass.

#### 3. Camera settling after small-room crossing finalization (Task 8)
**Files:** `src/render/camera.ts`, `src/screens/gameScreen.ts`, `src/screens/twoRoomCrossing.ts`  
**Issue:** Rooms narrower or shorter than 480×270 px snap the camera to room center when
`_finalizeCrossingSeamless()` replaces the union camera bounds with the new room's bounds.  
**Proposed fix:** After finalization, keep a `camSettlingFramesLeft` counter (e.g. 21 frames
= 0.35 s at 60 fps). While > 0, lerp the effective camera bounds toward the new room bounds
each frame instead of snapping. `updateCameraWithBounds` already smooths; only the bounds
swap needs the settling window.  
**Risk:** Low — isolated to the finalization path; `preserveCamera`, `loadRoom`, and
long-transition paths are unaffected.

---

### Rendering — Performance (Low–Medium Risk)

#### 4. Environmental dust spatial partitioning
**File:** `src/render/environmentalDust.ts`  
**Issue:** The update path's wall-collision check may iterate all room walls for every
active particle (`O(particles × walls)`). In large rooms with many walls this can be costly.  
**Proposed fix:** Add a coarse grid (cell size ≈ 4× particle radius) keyed by cell position.
Each frame, look up only the ~4 neighbouring cells instead of iterating all walls. Similar to
`src/sim/spatial/`.  
**Risk:** Behavioural change if grid boundary handling is wrong. Worth a separate PR.

#### 5. Shadow occluder object allocations (Item A)
**File:** `src/render/effects/darkRoomOverlay.ts`, `buildPlayerShadowOccluders()`  
**Issue:** Up to 4 `{ baseAx, baseAy, … }` objects are pushed per frame in DarkRoom mode.  
**Fix:** Pre-allocate a pool of 4 mutable occluder objects; fill them in place instead of
calling `push` with object literals.  
**Risk:** Low — contained within a single function.

#### 6. Decoration bloom: per-frame object literals in BloomSystem (Item B)
**File:** `src/render/effects/wallDecorations.ts`, `BloomSystem`  
**Issue:** `addDecorationBloom()` creates `{ x, y, radius, glow: { … } }` descriptor
objects each frame, adding GC pressure.  
**Fix:** Pool the descriptor objects or replace with a flat typed-array draw queue.  
**Risk:** Low–Medium — requires updating all BloomSystem call sites.

#### 7. Spatial partitioning for DarkRoom particle-light loop (Item C)
**File:** `src/render/effects/darkRoomOverlay.ts`  
**Issue:** The particle-light loop scans all particles linearly (O(n)). With thousands of
particles this is costly.  
**Fix:** Use the spatial grid already present in `sim/spatial/` to query only
screen-visible particles for the light-contribution pass.  
**Risk:** Medium — cross-layer query (render reads from sim spatial index); needs a
read-only snapshot interface.

#### 8. Large-room stress-test room (Task 9)
**File:** New file in `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/` or editor export  
**Issue:** No dedicated profiler test room exists with high decoration, background block,
and liquid/hazard coverage to measure chunk-rebuild performance across builds.  
**Proposed path:** Use the room editor to author a ~120×80 room with 200+ decorations,
30+ background block defs, 10+ dust containers, 4 sunbeam emitters, and representative
liquid/hazard coverage; export and commit as a dev-only room.  
**Risk:** Low — does not affect existing rooms or room schema.

---

### Simulation — Seamless Crossing (High Risk, Deferred)

#### 9. Staged room hazards / enemies / ropes (Task 7 follow-up)
**Files:** `src/screens/gameSeamlessStaging.ts`, `src/sim/world.ts`, enemy AI files  
**Issue:** Hazards (water/lava/spikes), enemies, falling blocks, and ropes from the staged
room are not preserved after `loadRoom()`. Players can walk through them without interaction.  
**Proposed path:** Before `loadRoom()` in `_finalizeCrossingSeamless`, snapshot the staged
room's hazard arrays and enemy clusters; after `loadRoom()`, re-append them at the staged
room's world-space offset. Enemy AI requires sim-layer awareness of the offset.  
**Risk:** High — requires non-trivial sim-layer changes; defer to a dedicated pass.
