# DustWeaver — Next Steps

## BUILD 315 — Official Campaign File-Based Loading

### What Was Completed in BUILD 315

1. **Official campaign file renamed** (`ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/`):
   - Canonical runtime file: `DustweaverCampaign.dwcampaign.json`
   - Old dated file `dustweaver-campaign-DUSTWEAVER_CAMPAIGN-2026-05-15.json` is preserved
     for backward compatibility but is no longer loaded by the game.

2. **Campaign ID regex relaxed** (`src/levels/campaignSchema.ts`):
   - `CAMPAIGN_ID_SAFE_RE` updated to `/^[a-zA-Z0-9_-]+$/` (was lowercase-only).
   - Required because the official campaign id `DUSTWEAVER_CAMPAIGN` uses uppercase.

3. **Official campaign loader added** (`src/levels/packedCampaignLoader.ts`):
   - `fetchOfficialPackedCampaign()` fetches and validates the canonical file at
     `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json`.
   - Returns `null` (with a clear console message) if the file is missing or invalid.
   - No folder scanning; uses a hardcoded stable path.

4. **`initRoomRegistry()` updated** (`src/levels/rooms.ts`):
   - Primary path: loads all rooms from the packed campaign file. World names and
     map positions come from the campaign `worldMap` section.
   - Fallback: if the packed file is unavailable, falls back to individual room
     JSON files in `CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/` (same as before BUILD 315).
   - Both paths populate `ROOM_REGISTRY`, `WORLD_NAMES`, and `WORLD_MAP_POSITIONS`.

5. **Export filenames normalized** (`src/editor/editorExport.ts`):
   - Custom campaign exports: `<campaignId>.dwcampaign.json`
   - Main campaign dated backup exports: `DustweaverCampaign-YYYY-MM-DD.dwcampaign.json`
   - Both use the `.dwcampaign.json` suffix (no longer just `.json`).

### Manual Action Required

After exporting from the editor, rename the dated backup to the canonical name and
commit it to the repository:

```
ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json
```

The file is already present (copied from the 2026-05-15 export). If you make further
room edits in the editor and export again, you will get
`DustweaverCampaign-YYYY-MM-DD.dwcampaign.json` — rename that to
`DustweaverCampaign.dwcampaign.json` and overwrite the existing file.

---

## All Pending / Deferred Work

Items are grouped by risk and origin. The letter tags (A–C) and numbered task tags
reference the build where the item was first documented.

---

### Campaign & File System (Low Risk)

#### 1. Old dated campaign file cleanup
**File:** `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/dustweaver-campaign-DUSTWEAVER_CAMPAIGN-2026-05-15.json`  
**Issue:** Now that `DustweaverCampaign.dwcampaign.json` is the canonical runtime file, the
old dated export is no longer needed.  
**Fix:** Delete the file once the canonical file has been verified in production.  
**Risk:** Low — no code references the old filename.

#### 2. Dynamic `STARTING_ROOM_ID`
**File:** `src/levels/rooms.ts`  
**Issue:** `STARTING_ROOM_ID = 'lobby'` is a hard-coded fallback. Callers that use
`campaign.initialRoomId` are already correct, but code that reads `STARTING_ROOM_ID`
directly may silently break if the campaign's initial room changes.  
**Fix:** After `initRoomRegistry()` loads the campaign, update `STARTING_ROOM_ID` to
reflect `campaign.initialRoomId`.  
**Risk:** Low — purely a data-propagation change; no physics or render impact.

#### 3. Campaign import file picker cleanup
**File:** `src/ui/mainMenuCustomCampaigns.ts`  
**Issue:** The file picker accepts both `.json` and `.dwcampaign.json`. The bare `.json`
acceptance is a legacy path that may confuse users.  
**Fix:** Remove bare `.json` from the accepted file types in the import picker.  
**Risk:** Low — purely UX; does not affect existing saved campaigns.

---

### Rendering — Seamless Crossing (Medium Risk)

#### 4. Staged room background rendering (Task 7)
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

#### 5. Camera settling after small-room crossing finalization (Task 8)
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

#### 6. Environmental dust spatial partitioning
**File:** `src/render/environmentalDust.ts`  
**Issue:** The update path's wall-collision check may iterate all room walls for every
active particle (`O(particles × walls)`). In large rooms with many walls this can be costly.  
**Proposed fix:** Add a coarse grid (cell size ≈ 4× particle radius) keyed by cell position.
Each frame, look up only the ~4 neighbouring cells instead of iterating all walls. Similar to
`src/sim/spatial/`.  
**Risk:** Behavioural change if grid boundary handling is wrong. Worth a separate PR.

#### 7. Shadow occluder object allocations (Item A)
**File:** `src/render/effects/darkRoomOverlay.ts`, `buildPlayerShadowOccluders()`  
**Issue:** Up to 4 `{ baseAx, baseAy, … }` objects are pushed per frame in DarkRoom mode.  
**Fix:** Pre-allocate a pool of 4 mutable occluder objects; fill them in place instead of
calling `push` with object literals.  
**Risk:** Low — contained within a single function.

#### 8. Decoration bloom: per-frame object literals in BloomSystem (Item B)
**File:** `src/render/effects/wallDecorations.ts`, `BloomSystem`  
**Issue:** `addDecorationBloom()` creates `{ x, y, radius, glow: { … } }` descriptor
objects each frame, adding GC pressure.  
**Fix:** Pool the descriptor objects or replace with a flat typed-array draw queue.  
**Risk:** Low–Medium — requires updating all BloomSystem call sites.

#### 9. Spatial partitioning for DarkRoom particle-light loop (Item C)
**File:** `src/render/effects/darkRoomOverlay.ts`  
**Issue:** The particle-light loop scans all particles linearly (O(n)). With thousands of
particles this is costly.  
**Fix:** Use the spatial grid already present in `sim/spatial/` to query only
screen-visible particles for the light-contribution pass.  
**Risk:** Medium — cross-layer query (render reads from sim spatial index); needs a
read-only snapshot interface.

#### 10. Large-room stress-test room (Task 9)
**File:** New file in `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/` or editor export  
**Issue:** No dedicated profiler test room exists with high decoration, background block,
and liquid/hazard coverage to measure chunk-rebuild performance across builds.  
**Proposed path:** Use the room editor to author a ~120×80 room with 200+ decorations,
30+ background block defs, 10+ dust containers, 4 sunbeam emitters, and representative
liquid/hazard coverage; export and commit as a dev-only room.  
**Risk:** Low — does not affect existing rooms or room schema.

---

### Simulation — Seamless Crossing (High Risk, Deferred)

#### 11. Staged room hazards / enemies / ropes (Task 7 follow-up)
**Files:** `src/screens/gameSeamlessStaging.ts`, `src/sim/world.ts`, enemy AI files  
**Issue:** Hazards (water/lava/spikes), enemies, falling blocks, and ropes from the staged
room are not preserved after `loadRoom()`. Players can walk through them without interaction.  
**Proposed path:** Before `loadRoom()` in `_finalizeCrossingSeamless`, snapshot the staged
room's hazard arrays and enemy clusters; after `loadRoom()`, re-append them at the staged
room's world-space offset. Enemy AI requires sim-layer awareness of the offset.  
**Risk:** High — requires non-trivial sim-layer changes; defer to a dedicated pass.
