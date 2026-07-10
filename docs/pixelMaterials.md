# Pixel-Material System (falling sand)

A pixel-scale physics layer separate from the existing tile/collision/entity
architecture. Initial scope: one material (1×1 sand).

## Coordinate space

- 1 pixel-material cell = 1 native game pixel = 1 world unit (same convention
  the rest of the sim already uses — see ARCHITECTURE.md's render pipeline).
- An 8×8 world tile (`BLOCK_SIZE_SMALL`, `levels/roomDef.ts`) therefore covers
  an 8×8 block of pixel-material cells (64 cells).
- The system's grid is sized to the room's world dimensions
  (`worldWidthWorld` × `worldHeightWorld`), not the fixed 480×270 viewport —
  rooms can be larger than one screen.

## Ownership

`PixelMaterialSystem` (`src/sim/pixelMaterials/pixelMaterialSystem.ts`) owns:
- Material occupancy + material id per occupied cell (sparse `Map` keyed by
  `y * width + x`, not one object per pixel of the 480×270 grid).
- Active/sleeping particle tracking (`Set` of awake particle records).
- Its own fixed-step `step()` — called once per sim tick from
  `sim/tick.ts` (step "0.07"), which is already the fixed-timestep pipeline
  (see the accumulator loop in `gameScreen.ts`).
- Collision queries against the world's solid mask.
- Wind (external force) application.
- Serialization (`serialize()` / `loadFromDefs()`).

`WorldState.pixelMaterialSystem` (`sim/world.ts`) holds the live instance.
It is fully replaced (not mutated) on every room load, so no state leaks
between rooms/transitions/restarts.

## Update order

Inside `sim/tick.ts`, right after falling-block/kinetic-block ticking and
before hazards:

```
0.06 tickKineticBlocks / tickGrappleCarryBlocks
0.07 tickPixelMaterials(world)   <-- world.pixelMaterialSystem.step()
0.1  applyHazards
```

## Solid occupancy

`buildSolidMaskFromWorld()` (`sim/pixelMaterials/pixelMaterialSolid.ts`)
rasterizes the *existing* `WorldState.wallXWorld/Y/W/H` rectangles into a
`Uint8Array` boolean mask at native-pixel resolution. World tiles are never
converted into particles — this is a read-only query surface over the
existing wall arrays.

- An 8×8 or 16×16 wall rect marks the corresponding 8×8/16×16 pixel block
  solid — internal tile boundaries don't matter, only occupied/unoccupied.
- One-way platforms (`wallIsPlatformFlag`) are excluded — sand falls through
  them, matching their gameplay semantics.
- Ramps are conservatively treated as full solid rectangles in this first
  version (a known simplification; ramps will need a triangular occupancy
  test in a follow-up).
- Room bounds: `SolidMask.isSolid()` returns `true` for any out-of-bounds
  query, so sand cannot leave the room without special-casing edges.
- Rebuilt from scratch on every room load (`loadRoomPixelMaterials` in
  `screens/gameRoomPixelMaterials.ts`), after wall/falling-block loading so
  falling-block wall slots are included.

## Sand simulation

Per active particle, per fixed step (`PixelMaterialSystem.stepParticle`):
1. Attempt straight down.
2. Attempt diagonal down-left/down-right. Preference alternates
   deterministically (`(stepCounter + x) & 1`, no RNG) so piles don't lean
   consistently to one side.
3. Attempt a wind-driven upward step, if wind momentum is pushing up.
4. Attempt a wind-driven horizontal step, if wind momentum is nonzero.
5. Otherwise remain stationary and accumulate toward sleep.

## Sleeping and reactivation

- A particle that hasn't moved for `SLEEP_DELAY_STEPS` (20) consecutive fixed
  steps, and has no residual wind momentum, goes to sleep (removed from the
  active `Set`, but stays in the occupancy map — still collidable).
- Reactivation ("wake") happens when:
  - A neighboring cell (any of the 8 neighbors) changes — a particle moves
    out of it, or it's placed/erased directly (`wakeNeighbors`).
  - Wind force is applied within `radiusPx` of the particle (`applyWindForce`
    wakes every particle it touches, in addition to adding momentum).

## Wind interface

`PixelMaterialSystem.applyWindForce({ centerXPx, centerYPx, radiusPx, forceX,
forceY, falloff?, sourceId? })` — reusable by any future caller (player dash,
enemy ability, environmental gust). Adds momentum to affected particles and
wakes them; momentum decays multiplicatively each step
(`WIND_MOMENTUM_DAMPING`) and snaps to zero below `WIND_MOMENTUM_EPSILON`, so
sand naturally returns to gravity-driven settling once the force passes.

No live in-game debug trigger is wired yet (out of scope for this pass) — the
interface is exercised directly by `src/tests/pixelMaterials.test.ts`
("wind wakes/displaces sand", "sand returns to settling after wind
dissipates"), which doubles as the test harness proving it works.

## Serialization (room data)

`RoomDef.pixelMaterials?: readonly RoomPixelMaterialDef[]` — a sparse list of
`{ xPixel, yPixel, material }` entries (native-pixel coordinates, NOT block
units). Sparse by construction: only authored/placed cells are stored, never
a dense 480×270 (or room-sized) array.

Plumbing (mirrors the existing `grappleCarryBlocks`/`phantasmalTiles`
pattern):
- `editor/editorElementTypes.ts` — `EditorPixelMaterial` + `EditorRoomData.pixelMaterials`.
- `editor/roomJsonSchema.ts` — `RoomJsonPixelMaterial` + `RoomJsonDef.pixelMaterials`.
- `editor/roomJsonSerializer.ts` — `EditorRoomData -> JSON`.
- `editor/roomJson.ts` — `JSON -> EditorRoomData` (filters non-finite entries).
- `editor/editorRoomImporter.ts` — `RoomDef -> EditorRoomData` (for TS-authored rooms).
- `editor/editorRoomBuilder.ts` — `EditorRoomData -> RoomDef` (editor live preview).
- `levels/roomJsonToRoomDef.ts` — `JSON -> RoomDef` (real gameplay load path;
  filters non-finite/NaN entries so malformed data can't crash room loading).

Runtime particle state (velocity, sleep counters, active flags) is **not**
serialized — only initial placement. `PixelMaterialSystem.loadFromDefs()`
places each authored cell as a fresh active particle, which then falls/settles
normally on room load.

Backward compatibility: the field is optional; rooms authored before this
system existed simply have no `pixelMaterials` key, and load unchanged.

## Editor placement

- Palette entry: "Sand 1×1" (`editorDropdownData.ts`, `isPixelMaterialItem: 1`).
- Placement/erase/drag-paint live in `editor/editorPixelMaterialTool.ts` and
  are wired into `editorController.ts` as dedicated branches (checked before
  the normal block-grid Place/Delete paths), so **existing tile editing is
  untouched**.
- Coordinates: `state.cursorWorldX/Y` are already native-pixel units (1 world
  unit = 1 native px), so `Math.floor(cursorWorldX/Y)` gives the exact pixel
  — no new cursor-tracking machinery needed.
- Drag painting uses Bresenham line interpolation
  (`paintPixelMaterialLine`) between the last and current pixel each frame,
  so fast mouse movement can't skip cells.
- Validity (`editorHitTest.ts: canPlacePixelMaterialAt`): in bounds, not
  inside solid geometry (non-platform wall or falling-block tile), not
  already occupied.
- Undo/redo: covered for free — `editorHistory.ts` snapshots the entire
  `EditorRoomData` object (including `pixelMaterials`) on every edit.
- Pixel grid overlay (`editorRendererHelpers.ts: drawPixelGrid`): editor-only
  screen-space canvas overlay, one `stroke()` call, hidden below 3× zoom to
  avoid visual noise, never rendered during gameplay or in native output.
- Cursor preview: a single highlighted native pixel at the exact cell that
  will be painted (`editorPlacementPreviewDrawer.ts`).

## Rendering

`render/pixelMaterials/pixelMaterialRenderer.ts` — one `fillRect` per
occupied cell, batched by material color (one `fillStyle` assignment per
material, not per particle), drawn on the existing 2D virtual canvas so it
stays pixel-crisp through the existing upscale pass. Visual properties are
centralized in `sim/pixelMaterials/pixelMaterialTypes.ts: MATERIAL_VISUALS`
so future materials only need one new entry.

## Diagnostics

`PixelMaterialSystem` exposes `activeCount`, `sleepingCount`, and
`occupiedCount` getters for development-only HUD/debug overlays (not yet
wired into the debug HUD — a follow-up). `forEachParticle()` gives read
access for a debug active-cell/occupancy visualization.

## Extension points (future materials, 2×2 sand)

- New material: add an id constant + `MaterialVisual` entry in
  `pixelMaterialTypes.ts`, no renderer changes needed beyond that.
- Material-specific movement rules (water spreading sideways, smoke rising,
  fire spreading) belong in `stepParticle()` gated on `p.material`, or split
  into a per-material step function dispatched by material id once there is
  more than one behavior.
- 2×2 particles: would need either (a) four 1×1 cells moved as a rigid unit
  (requires a small "footprint" abstraction over the occupancy map), or (b) a
  coarser secondary grid layered over the same solid mask. Not attempted
  here per scope.
- Reactions between materials: would hook into `stepParticle()`'s neighbor
  checks (currently only used for wake propagation) to test neighbor
  material ids before/after movement.
