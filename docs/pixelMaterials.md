# Pixel-Material System (falling sand)

A pixel-scale physics layer separate from the existing tile/collision/entity
architecture. Initial scope: one material (1×1 sand).

> **Phase 2 update**: editor/runtime solid parity hardening, room-resize
> clipping, right-click erase, allocation-free rendering, movement-driven
> wind currents, dev diagnostics, and a footprint abstraction prepping for
> future 2×2 materials. See the sections below for what changed; the
> "Phase 1" sections above them are unchanged in behavior except where noted.
>
> **Phase 3 update**: `MATERIAL_SAND_2X2` is now a real multi-cell material.
> `PixelMaterialSystem` occupancy is now `particles: Set` (one entry per
> particle) + `occupancy: Map<cell, particle>` (one entry per OCCUPIED CELL —
> N*N for an N×N footprint, all pointing at the same particle). Placement,
> movement, wind, wake, and the editor solid-check are all footprint-aware via
> `getMaterialFootprintSize(material)` — no material-specific branching at any
> call site. The editor's pixel-material solid-check was also upgraded from
> block-cell to native-pixel-AABB precision (`isPixelMaterialSolidAtPixel`),
> fixing a parity bug where half-width pillars (4px-wide wall rects) were
> incorrectly treated as fully solid across the whole 8×8 block.
>
> **Phase 4 update** (pre-water cleanup pass): `applyWindForce` now dedupes
> multi-cell particles via a reusable scratch `Set` (cleared at the start and
> end of every call) instead of allocating a new `Set` per impulse. Materials
> now also have a `windResponse` multiplier (`pixelMaterialTypes.ts`) — 2×2
> sand accumulates noticeably less wind momentum than 1×1 sand from an
> identical gust, so it reads as heavier.

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
- Ramps are conservatively treated as full solid rectangles (matches how they
  are stored in the wall arrays — `rampOrientationIndex` only affects
  rendering/movement-surface logic elsewhere, the base AABB rect is always
  solid unless it's a platform). A real triangular occupancy test is still a
  documented follow-up.
- Room bounds: `SolidMask.isSolid()` returns `true` for any out-of-bounds
  query, so sand cannot leave the room without special-casing edges.
- Rebuilt from scratch on every room load (`loadRoomPixelMaterials` in
  `screens/gameRoomPixelMaterials.ts`), after wall/falling-block loading so
  falling-block wall slots are included.

### Dynamic solid geometry (Phase 2)

Static walls only need the one-time rebuild above. `sim/pixelMaterials/pixelMaterialSolidSync.ts`
additionally keeps the mask correct for geometry that changes **after** room
load, called every fixed tick (`syncPixelMaterialSolidGeometry`, right before
`tickPixelMaterials`):

- **Falling blocks** — a group's wall slot (`group.wallIndex`) moves every
  tick while falling; the sync detects the rect change and rebuilds.
- **Crumble / breakable blocks** — destruction zeroes out their wall slot
  (`wallWWorld`/`wallHWorld = 0`); the sync detects this and rebuilds. This
  happens in `applyHazards`, which runs *after* pixel materials in the tick
  order, so there is a documented one-tick lag before sand reacts to a block
  breaking — acceptable, not reordering the whole pipeline for it.
- On any detected change, `notifySolidGeometryChanged(world, bounds)` rebuilds
  the full mask (cheap — `wallCount` is small) and calls
  `PixelMaterialSystem.wakeRegion()` to wake sleeping sand in the union of the
  slot's old+new rect (± a small margin), not the whole room.
- Change detection is O(number of dynamic wall slots) every tick — bounded by
  `MAX_FALLING_BLOCK_GROUPS` + crumble/breakable counts, typically a few dozen
  — so it's cheap even though it runs unconditionally every tick. Rooms with
  no falling/crumble/breakable blocks pay zero cost (the loops are empty).

**Intentionally NOT dynamic** (documented in `pixelMaterialSolidSync.ts`,
not oversights):
- Kinetic blocks — `kineticBlockSim.ts` only animates a visual phase, never
  moves the wall rect.
- Grapple-carry blocks — not wall-array entries at runtime at all; sand
  passes through them exactly like the player's own collision does.
- Editor authoring (placing/removing tiles or falling blocks in the editor
  UI) — the editor mutates `EditorRoomData`, not a live `WorldState`. There is
  no continuously-synced preview world while authoring; each `loadRoom()`
  call (e.g. jumping into a room) builds a brand-new solid mask from scratch
  via `loadRoomPixelMaterials`, so edits are always correct the next time the
  room loads.

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

### Movement-driven wind (Phase 2)

`sim/pixelMaterials/pixelMaterialMovementWind.ts: applyMovementWindToPixelMaterials(world)`
is the production caller of `applyWindForce` — it converts every alive
cluster's current velocity (`WorldState.clusters`, shared by player and
enemies alike, no special-casing by `isPlayerFlag`) into local wind impulses.
Wired into `sim/tick.ts` right after cluster movement/dynamic-solid-sync and
before `tickPixelMaterials` steps sand, so disturbance and settling read as
one frame.

Per moving cluster (skipped entirely below `MIN_SPEED_WORLD`):
- Speed → a 0–1 ramp between `MIN_SPEED_WORLD` (60 wu/s) and
  `MAX_SCALING_SPEED_WORLD` (420 wu/s, i.e. sprint/grapple/zip territory).
- Radius and force scale with that ramp, clamped to `[MIN_RADIUS_PX,
  MAX_RADIUS_PX]` (3–11 px) and `[MIN_FORCE, MAX_FORCE]` (24–130) respectively
  — a single entity can never blast sand across the room.
- The strongest ("trailing") impulse is centered slightly *behind* the
  entity's direction of travel (a wake), plus a weaker perpendicular
  "lateral turbulence" impulse for a less mechanical look.
- The lateral impulse's side alternates deterministically via
  `(world.tick + clusterIndex) & 1` — no `Math.random()`, matching the
  existing deterministic diagonal-fall chooser.
- Locality: `applyWindForce` already only scans the small AABB around its
  center, so looping over `world.clusters` (typically a handful of entities)
  never scans the whole room.

## Wind tuning constants

All in `pixelMaterialMovementWind.ts` unless noted:

| Constant | Value | Meaning |
|---|---|---|
| `MIN_SPEED_WORLD` | 60 wu/s | Below this, no wind at all (standing/walking). |
| `MAX_SCALING_SPEED_WORLD` | 420 wu/s | Speed at which radius/force reach max. |
| `MIN_RADIUS_PX` / `MAX_RADIUS_PX` | 3 / 11 px | Clamped wind-impulse radius. |
| `MIN_FORCE` / `MAX_FORCE` | 24 / 130 | Clamped wind-impulse magnitude. |
| `TRAIL_OFFSET_FACTOR` | 0.55 | Trailing impulse center offset (× radius, behind entity). |
| `LATERAL_FORCE_FACTOR` | 0.32 | Lateral impulse strength, relative to the trailing force. |
| `LATERAL_OFFSET_FACTOR` | 0.45 | Lateral impulse center offset (× radius). |
| `LATERAL_RADIUS_FACTOR` | 0.6 | Lateral impulse radius, relative to the trailing radius. |
| `WIND_MOMENTUM_DAMPING` (pixelMaterialTypes.ts) | 0.85/step | Per-step momentum decay (limited momentum, returns to gravity). |
| `WIND_MOMENTUM_EPSILON` (pixelMaterialTypes.ts) | 4 px/s | Momentum snap-to-zero threshold. |
| `MATERIAL_DEFS[MATERIAL_SAND].windResponse` | 1 | Full wind response (unchanged from Phase 1–3). |
| `MATERIAL_DEFS[MATERIAL_SAND_2X2].windResponse` | 0.55 | 2×2 sand accumulates ~55% of the momentum 1×1 sand would from the same gust — feels heavier. |

### Multi-cell wind + dedupe (Phase 3/4)

A particle is affected by a wind call if ANY of its footprint cells falls
within the force radius (matches how collision/wake already do per-cell
lookups). Force is applied to each affected particle **exactly once per
`applyWindForce` call**, scaled by `getMaterialWindResponse(material)` —
never once per covered cell, which would let a 2×2 particle receive up to 4×
the momentum of a 1×1 particle for the same gust. Dedup uses a reusable
scratch `Set` (`windAffectedScratch`) cleared at the start and end of every
call, instead of allocating a new `Set` per impulse — movement wind can emit
several impulses per moving cluster per tick (trailing + lateral), so this
avoids per-impulse allocator churn.

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
- Validity (`editorHitTest.ts: canPlacePixelMaterialAt`, delegating to
  `isPixelMaterialSolidAtBlockCell`): in bounds, not inside anything that
  becomes solid runtime wall geometry, not already occupied. See "Editor/
  runtime solid parity" below.
- Right-click (one-shot) erases the exact native pixel under the cursor when
  the Sand 1×1 palette item is selected, instead of the generic block-grid
  `deleteAtCursor`. Dragging with the **Delete** tool already used the same
  pixel-level Bresenham erase path since Phase 1. There is currently no
  drag-erase while *holding* right-click — `EditorInputState` only tracks a
  one-shot `isRightClickFired` flag, not a persistent "right button held"
  state (see the comment above the right-click handler in
  `editorController.ts`).
- Undo/redo: covered for free — `editorHistory.ts` snapshots the entire
  `EditorRoomData` object (including `pixelMaterials`) on every edit.
- Room resize (`editorRoomResize.ts`): `applyRoomDimensionChange` filters out
  any `pixelMaterials` entry that falls outside the new native-pixel bounds
  (entries are removed, not clamped — clamping would pile every out-of-bounds
  grain onto the new edge). `applyEdgeResize` shifts `pixelMaterials` by
  `shiftX/Y * BLOCK_SIZE_SMALL` (native-pixel units) when the top/left edge
  moves, matching how every other element array shifts. Export
  (`roomJsonSerializer.ts`) also filters out-of-bounds entries defensively,
  independent of resize, as a last line of defense before data leaves the
  editor.

### Editor/runtime solid parity

`editor/editorHitTest.ts: isPixelMaterialSolidAtBlockCell(room, bx, by)` is the
single shared helper for "does this editor-authored block cell become solid,
non-platform runtime wall geometry" — mirroring exactly what
`buildSolidMaskFromWorld` does when it scans the live `WorldState` wall
arrays. It covers interior walls (including ramps — matching the runtime
full-rect policy), crumble blocks, bounce pads, kinetic blocks, and falling
block tiles; it deliberately excludes grapple-carry blocks and phantasmal
tiles (not wall-array entries at runtime) and one-way platforms (sand falls
through them at runtime too).

This is intentionally a **different, newer** helper than the pre-existing
`cellOverlapsSolidWall` (used by grapple-carry-block/phantasmal-tile
placement, which has its own older policy that excludes ramps) — rather than
changing `cellOverlapsSolidWall`'s behavior for unrelated tools, pixel
materials get their own helper that can evolve independently to keep tracking
runtime solid-mask policy exactly.
- Pixel grid overlay (`editorRendererHelpers.ts: drawPixelGrid`): editor-only
  screen-space canvas overlay, one `stroke()` call, hidden below 3× zoom to
  avoid visual noise, never rendered during gameplay or in native output.
- Cursor preview: a single highlighted native pixel at the exact cell that
  will be painted (`editorPlacementPreviewDrawer.ts`).

## Rendering

`render/pixelMaterials/pixelMaterialRenderer.ts` — one `fillRect` per
occupied cell, drawn directly from `PixelMaterialSystem.forEachParticle`'s own
internal `Map` iteration (no intermediate `{x,y}` array or per-material
grouping `Map` is built every frame — both existed in Phase 1 and were
removed in Phase 2). `fillStyle` is only reassigned when the material
actually changes between consecutive particles in iteration order, which
with a single material today is equivalent to one assignment for the whole
draw. Visual properties are centralized in
`sim/pixelMaterials/pixelMaterialTypes.ts: MATERIAL_VISUALS` (now a view over
`MATERIAL_DEFS`, see "Future 2×2 materials" below) so future materials only
need one new table entry. Cell size is `Math.round(zoom)` (not raw `zoom`) so
every particle renders at an identical whole-pixel size — fractional zoom
would otherwise round different cells inconsistently.

## Diagnostics (Phase 2)

`PixelMaterialSystem` exposes, all dev-only / zero-cost-when-unused:
- `activeCount`, `sleepingCount`, `occupiedCount` getters.
- `windImpulsesThisTick` / `windParticlesAffectedThisTick` — reset once per
  tick via `resetWindDiagnostics()` (called from `sim/tick.ts` before the
  movement-wind emitter runs), incremented inside `applyWindForce`.
- A fixed-capacity (24-slot) ring buffer of recent wind events (center,
  radius, direction, age-in-steps) in pre-allocated `Float32Array`s — `O(1)`
  writes, no per-event allocation.

**To enable the visual debug overlay**: it's gated behind the existing
debug-mode flag in `screens/gameRender.ts` — `renderPixelMaterialDebug(ctx,
world, ox, oy, zoom)` is called only `if (isDebugMode)`, right after the
normal sand render call. Toggle debug mode via the game's existing debug UI;
no separate flag was introduced. It draws: a fading circle + direction line
per recent wind event, and a one-line `sand: occ=… active=… sleep=… wind=…
hit=…` counter readout in the top-left corner. Disabled (and therefore
zero-cost) outside debug mode.

## Future 2×2 materials (Phase 2 prep, not implemented)

`pixelMaterialTypes.ts` now defines `MaterialDef { footprintSize, color }`
and `MATERIAL_DEFS`/`getMaterialFootprintSize()` instead of a bare
color-only table. `PixelMaterialSystem.place()` already asks the material for
its footprint (`isRegionFree(x, y, size)`) rather than hard-coding "1 cell" —
for every material today (`footprintSize: 1`) this is behaviorally identical
to the old single-cell check.

**What this does NOT yet do**: `stepParticle()`/`moveParticle()` still only
implement single-cell movement. A real `footprintSize: 2` material would need:
1. `stepParticle` to test/reserve all 4 footprint cells atomically before
   moving (not just the anchor cell).
2. `moveParticle` to clear the old 2×2 footprint and occupy the new one.
3. Placement/erase/wake-neighbor logic to operate over the whole footprint,
   not a single (x,y).
4. The editor's `isPixelMaterialSolidAtBlockCell`/`canPlacePixelMaterialAt`
   already operate in native-pixel space, so a 2×2 placement would just need
   to check a 2×2 pixel region instead of 1×1 — no architecture change there.

Recommended next step: add a `MATERIAL_SAND_2X2` id with `footprintSize: 2`,
then extend `stepParticle`/`moveParticle` to branch on footprint size (a
generic N×N rigid-footprint mover, since sand's gravity/diagonal rules stay
the same — only the number of cells checked/moved changes).

- Material-specific movement rules (water spreading sideways, smoke rising,
  fire spreading) belong in `stepParticle()` gated on `p.material`, or split
  into a per-material step function dispatched by material id once there is
  more than one behavior.
- Reactions between materials: would hook into `stepParticle()`'s neighbor
  checks (currently only used for wake propagation) to test neighbor
  material ids before/after movement.
