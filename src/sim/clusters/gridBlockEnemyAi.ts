/**
 * Grid Block Enemy AI.
 *
 * Two size variants (1×1 and 2×2 tiles) with three speed variants each.
 * Enemies stay perfectly aligned to the 8-unit tile grid at all times,
 * move only orthogonally, pathfind toward the player via BFS, and deal
 * contact damage.
 *
 * Movement is commit-and-interpolate:
 *   - The "committed" position is always an exact grid cell.
 *   - During a step the entity interpolates visually from the previous
 *     committed cell to the next; positionXWorld/Y are the interpolated values.
 *   - At the end of each step the position snaps exactly to the target cell.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

// ── Constants ─────────────────────────────────────────────────────────────────

const BS = BLOCK_SIZE_SMALL; // 8 world units per tile

/** Half-size (world units) per size variant. */
export const GRID_BLOCK_HALF_SIZE: readonly [number, number] = [
  BS * 0.5,  // 1×1 → half = 4
  BS * 1.0,  // 2×2 → half = 8
];

/** Ticks per movement step per speed variant. */
const MOVE_TICKS_PER_STEP: readonly [number, number, number] = [
  20, // slow
  12, // medium
  7,  // fast
];

/** Contact damage dealt per hit. */
const CONTACT_DAMAGE = 2;

/** Ticks between full BFS repath calculations. */
const REPATH_INTERVAL_TICKS = 30;

/** Maximum BFS search distance (in tiles). Keeps worst-case cost bounded. */
const BFS_MAX_CELLS = 512;

/** Tiny fudge applied when testing cell-wall overlap to avoid touching-edge false positives. */
const CELL_OVERLAP_EPSILON = 0.5;

/** Max ticks for the hit-flash visual. */
export const GRID_BLOCK_HIT_FLASH_TICKS = 8;

// ── BFS pathfinding ───────────────────────────────────────────────────────────

/**
 * Reusable scratch buffer for BFS — allocated once and reused each call to
 * avoid per-frame GC pressure.
 */
const _bfsQueue    = new Int32Array(BFS_MAX_CELLS * 2); // [gx, gy] pairs
const _bfsVisited  = new Uint8Array(512 * 512);          // worst-case coverage; indexed [gx + gy*roomW]
const _bfsDirX     = new Int8Array(BFS_MAX_CELLS);       // direction taken to reach each queued cell
const _bfsDirY     = new Int8Array(BFS_MAX_CELLS);

/** Orthogonal neighbour offsets: right, down, left, up. */
const DIR_DX = [1, 0, -1, 0];
const DIR_DY = [0, 1,  0, -1];

/**
 * Returns true if a single tile cell `(gx, gy)` is blocked by any solid wall.
 * Skips platforms, ramps, and invisible walls (same rules as squareStampedeAi).
 */
function isCellSolid(world: WorldState, gx: number, gy: number): boolean {
  const cellLeft   = gx * BS + CELL_OVERLAP_EPSILON;
  const cellRight  = (gx + 1) * BS - CELL_OVERLAP_EPSILON;
  const cellTop    = gy * BS + CELL_OVERLAP_EPSILON;
  const cellBottom = (gy + 1) * BS - CELL_OVERLAP_EPSILON;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1)         continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;
    if (world.wallIsInvisibleFlag[wi] === 1)        continue;

    const wx = world.wallXWorld[wi];
    const wy = world.wallYWorld[wi];
    const wr = wx + world.wallWWorld[wi];
    const wb = wy + world.wallHWorld[wi];

    if (cellRight > wx && cellLeft < wr && cellBottom > wy && cellTop < wb) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if a 2×2 tile footprint with its top-left at `(gx, gy)` is
 * entirely free of solid walls (all four cells must be passable).
 */
export function getGridBlockFootprintSize(sizeIndex: number): { w: number; h: number } {
  return sizeIndex === 1 ? { w: 2, h: 2 } : { w: 1, h: 1 };
}

export function isGridFootprintInBounds(world: WorldState, gx: number, gy: number, sizeIndex: number): boolean {
  const roomWidthBlocks  = Math.ceil(world.worldWidthWorld  / BS);
  const roomHeightBlocks = Math.ceil(world.worldHeightWorld / BS);
  const footprint = getGridBlockFootprintSize(sizeIndex);
  return (
    gx >= 0 &&
    gy >= 0 &&
    gx + footprint.w <= roomWidthBlocks &&
    gy + footprint.h <= roomHeightBlocks
  );
}

export function isGridFootprintPassable(world: WorldState, gx: number, gy: number, sizeIndex: number): boolean {
  const footprint = getGridBlockFootprintSize(sizeIndex);
  for (let fy = 0; fy < footprint.h; fy++) {
    for (let fx = 0; fx < footprint.w; fx++) {
      if (isCellSolid(world, gx + fx, gy + fy)) return false;
    }
  }
  return true;
}

/**
 * BFS from `(startGX, startGY)` toward `(targetGX, targetGY)`.
 *
 * @param sizeIndex  0 = 1×1 enemy, 1 = 2×2 enemy
 * @returns The direction [dx, dy] of the first step, or [0, 0] if no path.
 */
function bfsNextDirection(
  world: WorldState,
  startGX: number,
  startGY: number,
  targetGX: number,
  targetGY: number,
  sizeIndex: number,
): [number, number] {
  const roomWidthBlocks  = Math.ceil(world.worldWidthWorld  / BS);

  if (startGX === targetGX && startGY === targetGY) return [0, 0];

  // Track written cells for cleanup after BFS.
  const visitedCells: number[] = [];

  let head = 0;
  let tail = 0;

  _bfsQueue[head * 2]     = startGX;
  _bfsQueue[head * 2 + 1] = startGY;
  _bfsDirX[head] = 0;
  _bfsDirY[head] = 0;
  tail++;

  const startKey = startGX + startGY * roomWidthBlocks;
  _bfsVisited[startKey] = 1;
  visitedCells.push(startKey);

  let foundDX = 0;
  let foundDY = 0;
  let found   = false;

  while (head < tail && !found) {
    const cx  = _bfsQueue[head * 2];
    const cy  = _bfsQueue[head * 2 + 1];
    const cdx = _bfsDirX[head];
    const cdy = _bfsDirY[head];
    head++;

    for (let d = 0; d < 4; d++) {
      const nx = cx + DIR_DX[d];
      const ny = cy + DIR_DY[d];

      if (!isGridFootprintInBounds(world, nx, ny, sizeIndex)) continue;

      const key = nx + ny * roomWidthBlocks;
      if (_bfsVisited[key]) continue;

      if (!isGridFootprintPassable(world, nx, ny, sizeIndex)) continue;

      _bfsVisited[key] = 1;
      visitedCells.push(key);

      const stepDX = (cx === startGX && cy === startGY) ? DIR_DX[d] : cdx;
      const stepDY = (cx === startGX && cy === startGY) ? DIR_DY[d] : cdy;

      if (tail < BFS_MAX_CELLS) {
        _bfsQueue[tail * 2]     = nx;
        _bfsQueue[tail * 2 + 1] = ny;
        _bfsDirX[tail] = stepDX;
        _bfsDirY[tail] = stepDY;
        tail++;
      }

      if (nx === targetGX && ny === targetGY) {
        foundDX = stepDX;
        foundDY = stepDY;
        found   = true;
        break;
      }
    }
  }

  // Restore visited buffer.
  for (let i = 0; i < visitedCells.length; i++) {
    _bfsVisited[visitedCells[i]] = 0;
  }

  return found ? [foundDX, foundDY] : [0, 0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a committed grid X to the world-space center X for this size variant. */
function gridToWorldX(gx: number, sizeIndex: number): number {
  return gx * BS + (sizeIndex === 0 ? BS * 0.5 : BS);
}

/** Convert a committed grid Y to the world-space center Y for this size variant. */
function gridToWorldY(gy: number, sizeIndex: number): number {
  return gy * BS + (sizeIndex === 0 ? BS * 0.5 : BS);
}

// ── Public AI entry point ─────────────────────────────────────────────────────

export function applyGridBlockEnemyAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Locate player once.
  let playerXWorld = 0;
  let playerYWorld = 0;
  let playerHalfW  = 0;
  let playerHalfH  = 0;
  let playerRef: typeof world.clusters[0] | undefined;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerYWorld = c.positionYWorld;
      playerHalfW  = c.halfWidthWorld;
      playerHalfH  = c.halfHeightWorld;
      playerRef    = c;
      break;
    }
  }

  const playerFound = playerRef !== undefined;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isGridBlockEnemyFlag !== 1 || cluster.isAliveFlag === 0) continue;

    const sizeIndex  = cluster.gridBlockSizeIndex;
    const speedIndex = cluster.gridBlockSpeedIndex;
    const moveMax    = MOVE_TICKS_PER_STEP[speedIndex];

    // ── Advance glint animation ──────────────────────────────────────────────
    cluster.gridBlockGlintPhase = (cluster.gridBlockGlintPhase + dtSec * 2.0) % (Math.PI * 2);

    // ── Hit detection and flash ──────────────────────────────────────────────
    if (cluster.healthPoints < cluster.gridBlockPrevHealthPoints) {
      cluster.gridBlockHitFlashTicks = GRID_BLOCK_HIT_FLASH_TICKS;
    }
    cluster.gridBlockPrevHealthPoints = cluster.healthPoints;
    if (cluster.gridBlockHitFlashTicks > 0) cluster.gridBlockHitFlashTicks--;

    // ── Movement step ────────────────────────────────────────────────────────
    if (cluster.gridBlockMoveTicks > 0) {
      // Mid-step: interpolate visually.
      cluster.gridBlockMoveTicks--;
      const t      = 1.0 - (cluster.gridBlockMoveTicks / moveMax);
      const startX = gridToWorldX(cluster.gridBlockGridX,       sizeIndex);
      const startY = gridToWorldY(cluster.gridBlockGridY,       sizeIndex);
      const targX  = gridToWorldX(cluster.gridBlockTargetGridX, sizeIndex);
      const targY  = gridToWorldY(cluster.gridBlockTargetGridY, sizeIndex);
      cluster.positionXWorld = startX + (targX - startX) * t;
      cluster.positionYWorld = startY + (targY - startY) * t;

      if (cluster.gridBlockMoveTicks <= 0) {
        // Commit: snap to exact target cell.
        cluster.gridBlockGridX = cluster.gridBlockTargetGridX;
        cluster.gridBlockGridY = cluster.gridBlockTargetGridY;
        cluster.positionXWorld = gridToWorldX(cluster.gridBlockGridX, sizeIndex);
        cluster.positionYWorld = gridToWorldY(cluster.gridBlockGridY, sizeIndex);
      }
    } else {
      // ── Idle: repath then pick next step ──────────────────────────────────
      cluster.gridBlockRepathCooldownTicks--;
      if (cluster.gridBlockRepathCooldownTicks <= 0) {
        cluster.gridBlockRepathCooldownTicks = REPATH_INTERVAL_TICKS;

        if (playerFound) {
          let targGX = Math.floor(playerXWorld / BS);
          let targGY = Math.floor(playerYWorld / BS);

          // For 2×2 enemies, shift target so the center lines up near player.
          if (sizeIndex === 1) {
            targGX = Math.max(0, targGX - 1);
            targGY = Math.max(0, targGY - 1);
          }

          const [dx, dy] = bfsNextDirection(
            world,
            cluster.gridBlockGridX,
            cluster.gridBlockGridY,
            targGX,
            targGY,
            sizeIndex,
          );
          cluster.gridBlockNextDirX = dx;
          cluster.gridBlockNextDirY = dy;
        } else {
          cluster.gridBlockNextDirX = 0;
          cluster.gridBlockNextDirY = 0;
        }
      }

      // Attempt to start a move step in the cached direction.
      const ndx = cluster.gridBlockNextDirX;
      const ndy = cluster.gridBlockNextDirY;
      if (ndx !== 0 || ndy !== 0) {
        const newGX = cluster.gridBlockGridX + ndx;
        const newGY = cluster.gridBlockGridY + ndy;

        let canMove = isGridFootprintInBounds(world, newGX, newGY, sizeIndex);
        if (canMove) canMove = isGridFootprintPassable(world, newGX, newGY, sizeIndex);

        if (canMove) {
          cluster.gridBlockTargetGridX = newGX;
          cluster.gridBlockTargetGridY = newGY;
          cluster.gridBlockMoveTicks   = moveMax;
          cluster.gridBlockNextDirX    = 0;
          cluster.gridBlockNextDirY    = 0;
          // Reset repath so we get a fresh direction when this step lands.
          cluster.gridBlockRepathCooldownTicks = 0;
        }
      }
    }

    // ── Contact damage to player ─────────────────────────────────────────────
    if (playerFound && playerRef !== undefined && playerRef.invulnerabilityTicks <= 0) {
      const hw  = cluster.halfWidthWorld;
      const hh  = cluster.halfHeightWorld;
      const adx = Math.abs(cluster.positionXWorld - playerXWorld);
      const ady = Math.abs(cluster.positionYWorld - playerYWorld);
      if (adx < hw + playerHalfW && ady < hh + playerHalfH) {
        applyPlayerDamageWithKnockback(playerRef, CONTACT_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
      }
    }
  }
}
