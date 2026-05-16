# DustWeaver — Next Steps

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
