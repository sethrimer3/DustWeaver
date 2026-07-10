/**
 * Keeps the pixel-material solid mask in sync with runtime wall geometry that
 * can change AFTER room load (as opposed to static walls, which are baked
 * once by `loadRoomPixelMaterials` and never move).
 *
 * Dynamic solid-geometry sources currently supported:
 *   - Falling block groups (`WorldState.fallingBlockGroups`) — their reserved
 *     wall slot (`group.wallIndex`) moves every tick while falling.
 *   - Crumble blocks (`world.crumbleBlockWallIndex`) — their wall slot is
 *     zeroed out (`wallWWorld`/`wallHWorld` set to 0) when destroyed.
 *   - Breakable blocks (`world.breakableBlockWallIndex`) — same zero-out
 *     pattern as crumble blocks.
 *
 * Intentionally NOT dynamic (documented, not oversights):
 *   - Kinetic blocks: `kineticBlockSim.ts` only advances an animation phase
 *     for their visual, never moves `wallXWorld/Y/W/H` — their wall slot is
 *     static for the room's lifetime, so no sync is needed.
 *   - Grapple-carry blocks: NOT wall-array entries at all (see
 *     gameRoomHazards.ts) — sand does not collide with them, matching how
 *     the player/particles' own collision treats them (a separate carry-block
 *     physics system, not the wall array).
 *   - Ramps: static once loaded; only their rest position matters, already
 *     covered by the initial `buildSolidMaskFromWorld` call.
 *   - Editor authoring (placing/removing tiles or falling blocks in the
 *     editor UI): the editor mutates `EditorRoomData`, not a live
 *     `WorldState` — there is no "live preview world" kept in sync while
 *     authoring. Each time the editor calls `loadRoom()` (e.g. jumping into
 *     a room), `loadRoomPixelMaterials` builds a brand-new solid mask from
 *     scratch, so edits are always correctly reflected the next time the
 *     room is (re)loaded. See docs/pixelMaterials.md.
 *
 * Strategy: rather than diffing individual wall rectangles precisely (which
 * would require plumbing change-notifications through every hazard/falling-
 * block system), this module compares a small set of *known-dynamic* wall
 * slots against their previous tick's rect every tick. Comparing is O(number
 * of dynamic slots), which is small (bounded by MAX_FALLING_BLOCK_GROUPS +
 * crumble/breakable counts — typically a few dozen at most), so this is cheap
 * even though it runs unconditionally. Rebuilding the mask itself only
 * happens when something actually changed, and is a full `buildSolidMaskFromWorld`
 * pass (O(wallCount), also small) rather than an in-place patch — correctness
 * over micro-optimization for this pass, as called out in the task.
 */

import type { WorldState } from '../world';
import { buildSolidMaskFromWorld } from './pixelMaterialSolid';

/** Wakes sleeping sand within this many extra native pixels around a changed rect. */
const WAKE_MARGIN_PX = 2;

/**
 * Call once per fixed sim step, before `tickPixelMaterials(world)` steps the
 * sand simulation, so the mask sand queries this tick already reflects any
 * falling-block/crumble/breakable changes made earlier in the same tick
 * (falling blocks tick before this; crumble/breakable destruction happens in
 * `applyHazards`, which runs AFTER pixel materials — so a block destroyed
 * this tick is reflected starting next tick, a one-tick lag documented here
 * rather than reordering the whole pipeline for it).
 */
export function syncPixelMaterialSolidGeometry(world: WorldState): void {
  const system = world.pixelMaterialSystem;
  const snapshots = system.dynamicWallSnapshots;

  let changed = false;
  let unionX0 = Infinity;
  let unionY0 = Infinity;
  let unionX1 = -Infinity;
  let unionY1 = -Infinity;

  const checkSlot = (wi: number): void => {
    if (wi < 0 || wi >= world.wallCount) return;
    const x = world.wallXWorld[wi];
    const y = world.wallYWorld[wi];
    const w = world.wallWWorld[wi];
    const h = world.wallHWorld[wi];
    const prev = snapshots.get(wi);
    if (prev !== undefined && prev.x === x && prev.y === y && prev.w === w && prev.h === h) {
      return; // unchanged
    }
    changed = true;
    if (prev !== undefined) {
      unionX0 = Math.min(unionX0, prev.x);
      unionY0 = Math.min(unionY0, prev.y);
      unionX1 = Math.max(unionX1, prev.x + prev.w);
      unionY1 = Math.max(unionY1, prev.y + prev.h);
    }
    unionX0 = Math.min(unionX0, x);
    unionY0 = Math.min(unionY0, y);
    unionX1 = Math.max(unionX1, x + w);
    unionY1 = Math.max(unionY1, y + h);
    if (prev === undefined) snapshots.set(wi, { x, y, w, h });
    else { prev.x = x; prev.y = y; prev.w = w; prev.h = h; }
  };

  for (const g of world.fallingBlockGroups) checkSlot(g.wallIndex);
  for (let i = 0; i < world.crumbleBlockCount; i++) checkSlot(world.crumbleBlockWallIndex[i]);
  for (let i = 0; i < world.breakableBlockCount; i++) checkSlot(world.breakableBlockWallIndex[i]);

  if (!changed) return;

  notifySolidGeometryChanged(world, {
    x0: unionX0 - WAKE_MARGIN_PX,
    y0: unionY0 - WAKE_MARGIN_PX,
    x1: unionX1 + WAKE_MARGIN_PX,
    y1: unionY1 + WAKE_MARGIN_PX,
  });
}

/**
 * Rebuilds the pixel-material solid mask from current wall geometry and
 * wakes sleeping particles within `bounds` (or, if omitted, does a full
 * rebuild with no targeted wake — used for room-wide changes where the
 * affected region isn't cheaply known, e.g. none currently, kept for API
 * completeness / future callers).
 */
export function notifySolidGeometryChanged(
  world: WorldState,
  bounds?: { x0: number; y0: number; x1: number; y1: number },
): void {
  const system = world.pixelMaterialSystem;
  system.solid = buildSolidMaskFromWorld(world, system.widthPx, system.heightPx);
  if (bounds !== undefined) {
    system.wakeRegion(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
  }
}
