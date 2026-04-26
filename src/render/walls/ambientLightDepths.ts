/**
 * Ambient-light depth solver for the block sprite renderer.
 *
 * Extracted from blockSpriteRenderer.ts to keep that module focused on sprite
 * loading and drawing. This module is a pure computation layer with no DOM or
 * browser dependencies — it reads only tile-occupancy data and room dimensions.
 *
 * Two-phase algorithm:
 *   1. Lit-air flood: BFS from room edges that face the ambient-light source
 *      through empty cells not blocked by authored `ambientLightBlockers`.
 *   2. Solid-depth BFS: starting from solid cells adjacent to lit-air,
 *      assigns an incrementing depth to each deeper solid tile. Depth drives
 *      the exponential darkness tint in `getDarknessAlphaFromAirDepth`.
 */

import type { AmbientLightDirection } from '../../levels/roomDef';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns the string key for a tile grid coordinate. */
function _tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Returns true if the cell at (col, row) is occupied by a solid wall block. */
function _isOccupied(occupied: Set<string>, col: number, row: number): boolean {
  return occupied.has(_tileKey(col, row));
}

function _isInsideRoom(col: number, row: number, widthBlocks: number, heightBlocks: number): boolean {
  return col >= 0 && col < widthBlocks && row >= 0 && row < heightBlocks;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Unit 2-D vector associated with each {@link AmbientLightDirection} value.
 *
 * The vector points in the direction light TRAVELS (e.g. `'down-right'` →
 * (+1, +1) normalised, meaning light enters the room from the upper-left
 * and moves toward the lower-right). The `'omni'` value returns (0,0),
 * signalling the solver to skip directional biasing.
 */
export function ambientDirectionVector(dir: AmbientLightDirection): { dx: number; dy: number } {
  switch (dir) {
    case 'omni':       return { dx:  0, dy:  0 };
    case 'down':       return { dx:  0, dy:  1 };
    case 'down-right': return { dx:  1, dy:  1 };
    case 'down-left':  return { dx: -1, dy:  1 };
    case 'up':         return { dx:  0, dy: -1 };
    case 'up-right':   return { dx:  1, dy: -1 };
    case 'up-left':    return { dx: -1, dy: -1 };
    case 'left':       return { dx: -1, dy:  0 };
    case 'right':      return { dx:  1, dy:  0 };
  }
}

/**
 * Converts open-air distance (in tiles) into darkness alpha.
 * Darkness accelerates with depth: each additional tile from open air
 * contributes twice the darkness of the previous tile.
 */
export function getDarknessAlphaFromAirDepth(airDepth: number): number {
  if (airDepth <= 0) return 0;
  const BASE_DARKNESS_STEP = 0.1;
  const acceleratedAlpha = BASE_DARKNESS_STEP * (Math.pow(2, airDepth) - 1);
  return Math.min(1, acceleratedAlpha);
}

/**
 * Unified ambient-light depth solver.
 *
 * Two-phase algorithm that replaces the legacy split between `'DEFAULT'`
 * (omni BFS from any air-touching solid) and `'Above'` (vertical scan only):
 *
 * 1. **Lit-air flood**: compute the set of in-room AIR cells that are
 *    "connected to the sky". Seeds are air cells on a room edge that faces
 *    the ambient-light direction (or every edge, for `'omni'`). The flood
 *    propagates through empty cells only, skipping solids and skipping
 *    `ambientBlockers`. When a direction is set, a cell only propagates into
 *    neighbours whose offset dot-producted with the direction vector is
 *    `≥ 0`, so light naturally spills in a diagonal cone instead of bending
 *    around arbitrary corners.
 *
 * 2. **Solid depth BFS**: every solid cell 8-adjacent to a lit-air cell is
 *    depth 0 ("directly exposed"). BFS outward through adjacent solids
 *    assigns each deeper solid an incrementing depth, which drives the
 *    exponential darkness tint in {@link getDarknessAlphaFromAirDepth}.
 *
 * Air cells inside an enclosed/blocked pocket never enter the lit-air set, so
 * solid walls adjacent to them stay at `maxFallbackDepth` (fully dark). When
 * a breakable wall is destroyed its tile becomes empty, the wall-layout
 * signature changes, and this function is re-run — light then spills in
 * naturally on the next bake. See `ambientLightBlockers` docs in
 * `roomDef.ts` for the full authoring model.
 *
 * @param occupied         Set of `"col,row"` keys for solid tiles.
 * @param blockers         Authored ambient-light blocker keys — opaque to
 *                         both the air flood and the final rendering.
 * @param direction        Ambient-light travel direction.
 * @param roomWidthBlocks  Room width in tile units.
 * @param roomHeightBlocks Room height in tile units.
 * @returns Map from tile key to integer depth (0 = surface-exposed).
 */
export function buildAmbientDepths(
  occupied: Set<string>,
  blockers: ReadonlySet<string>,
  direction: AmbientLightDirection,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
): Map<string, number> {
  const depths = new Map<string, number>();
  if (roomWidthBlocks <= 0 || roomHeightBlocks <= 0) return depths;

  const { dx: directionVectorX, dy: directionVectorY } = ambientDirectionVector(direction);
  const isOmni = directionVectorX === 0 && directionVectorY === 0;

  // ── Phase 1: flood-fill "lit air" cells ──────────────────────────────────
  // `litAir` tracks which empty cells are connected to the sky.
  const litAir = new Set<string>();
  const airQueueCols: number[] = [];
  const airQueueRows: number[] = [];
  let airQueueIndex = 0;

  const pushAirSeed = (c: number, r: number): void => {
    if (!_isInsideRoom(c, r, roomWidthBlocks, roomHeightBlocks)) return;
    const key = _tileKey(c, r);
    if (litAir.has(key)) return;
    if (occupied.has(key)) return;       // solid: not a sky-seed
    if (blockers.has(key)) return;       // authored blocker: opaque to ambient
    litAir.add(key);
    airQueueCols.push(c);
    airQueueRows.push(r);
  };

  // Seed the "sky side" of the room.
  //
  // For `'omni'` mode we preserve the legacy `'DEFAULT'` semantics by seeding
  // EVERY non-blocker air cell — so a fully-enclosed room with only interior
  // air still has lit walls around the air, and authored hidden pockets are
  // created exclusively by painting `ambientLightBlockers` over the pocket's
  // air cells (those cells fail the `!blockers.has(key)` check and stay dark).
  //
  // For a directional mode, seeds come from the edges facing the sky (i.e.
  // the sides opposite to the direction vector); the flood then propagates
  // inward through connected air, so a hidden pocket walled off from the
  // sky-facing edge naturally stays dark.
  if (isOmni) {
    for (let r = 0; r < roomHeightBlocks; r++) {
      for (let c = 0; c < roomWidthBlocks; c++) {
        const key = _tileKey(c, r);
        if (occupied.has(key)) continue;
        if (blockers.has(key)) continue;
        litAir.add(key);
      }
    }
    // Omni mode doesn't need to flood — every eligible air cell is already
    // in `litAir` — so skip the queue-based propagation below.
  } else {
    const seedTop    = directionVectorY > 0;  // light moves downward ⇒ enters from top
    const seedBottom = directionVectorY < 0;
    const seedLeft   = directionVectorX > 0;
    const seedRight  = directionVectorX < 0;

    if (seedTop) {
      for (let c = 0; c < roomWidthBlocks; c++) pushAirSeed(c, 0);
    }
    if (seedBottom) {
      for (let c = 0; c < roomWidthBlocks; c++) pushAirSeed(c, roomHeightBlocks - 1);
    }
    if (seedLeft) {
      for (let r = 0; r < roomHeightBlocks; r++) pushAirSeed(0, r);
    }
    if (seedRight) {
      for (let r = 0; r < roomHeightBlocks; r++) pushAirSeed(roomWidthBlocks - 1, r);
    }
  }

  // Flood-fill through empty cells. Directional bias: only step into a
  // neighbour whose offset has a non-negative dot product with the direction
  // vector (i.e. light keeps travelling generally with the direction). The
  // check allows perpendicular spread for a natural soft cone.
  while (airQueueIndex < airQueueCols.length) {
    const col = airQueueCols[airQueueIndex];
    const row = airQueueRows[airQueueIndex];
    airQueueIndex++;

    for (let ny = -1; ny <= 1; ny++) {
      for (let nx = -1; nx <= 1; nx++) {
        if (nx === 0 && ny === 0) continue;
        if (!isOmni) {
          // dot(neighbourOffset, direction) >= 0 — skip stepping "uphill"
          const dot = nx * directionVectorX + ny * directionVectorY;
          if (dot < 0) continue;
        }
        const c = col + nx;
        const r = row + ny;
        if (!_isInsideRoom(c, r, roomWidthBlocks, roomHeightBlocks)) continue;
        const key = _tileKey(c, r);
        if (litAir.has(key)) continue;
        if (occupied.has(key)) continue;
        if (blockers.has(key)) continue;
        litAir.add(key);
        airQueueCols.push(c);
        airQueueRows.push(r);
      }
    }
  }

  // ── Phase 2: BFS depth into solid cells from lit-air neighbours ─────────
  const solidQueueCols: number[] = [];
  const solidQueueRows: number[] = [];
  const solidQueueDepths: number[] = [];
  let qIndex = 0;

  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideRoom(col, row, roomWidthBlocks, roomHeightBlocks)) continue;

    // Solid cell is "exposed" if any 8-neighbour is a lit-air cell.
    let touchesLitAir = false;
    for (let dy = -1; dy <= 1 && !touchesLitAir; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks)) continue;
        if (litAir.has(_tileKey(nc, nr))) {
          touchesLitAir = true;
          break;
        }
      }
    }

    if (touchesLitAir) {
      depths.set(key, 0);
      solidQueueCols.push(col);
      solidQueueRows.push(row);
      solidQueueDepths.push(0);
    }
  }

  while (qIndex < solidQueueCols.length) {
    const col = solidQueueCols[qIndex];
    const row = solidQueueRows[qIndex];
    const depth = solidQueueDepths[qIndex];
    qIndex++;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks) || !_isOccupied(occupied, nc, nr)) continue;
        const neighborKey = _tileKey(nc, nr);
        if (depths.has(neighborKey)) continue;
        const nextDepth = depth + 1;
        depths.set(neighborKey, nextDepth);
        solidQueueCols.push(nc);
        solidQueueRows.push(nr);
        solidQueueDepths.push(nextDepth);
      }
    }
  }

  // Solid cells never reached by the flood are authored dark pockets
  // (enclosed by walls or by a blocker field). Assign the maximum fallback
  // depth so the darkness tint saturates.
  const maxFallbackDepth = Math.max(roomWidthBlocks, roomHeightBlocks);
  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideRoom(col, row, roomWidthBlocks, roomHeightBlocks)) continue;
    if (!depths.has(key)) depths.set(key, maxFallbackDepth);
  }

  return depths;
}
