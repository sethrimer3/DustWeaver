/**
 * Grid-aligned block and grid-snake enemies.
 *
 * Grid blocks are wall-slamming charge enemies: when resting they choose one
 * orthogonal slide, accelerate toward the last legal tile before a wall, slam,
 * recover, then plan again. Grid snakes keep the old tile-step BFS behavior
 * and add classic segment following.
 */

import { WorldState } from '../world';
import type { ClusterState } from './state';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

const BS = BLOCK_SIZE_SMALL;

export const GRID_BLOCK_HALF_SIZE: readonly [number, number] = [
  BS * 0.5,
  BS * 1.0,
];

export const GRID_SNAKE_HALF_SIZE = BS * 0.5;
export const DEFAULT_GRID_SNAKE_LENGTH = 4;

const GRID_SNAKE_MOVE_TICKS_PER_STEP = 12;
const GRID_SNAKE_REPATH_INTERVAL_TICKS = 20;
const GRID_SNAKE_CONTACT_DAMAGE = 2;

const GRID_BLOCK_CONTACT_DAMAGE = 2;
const GRID_BLOCK_STATE_RESTING = 0;
const GRID_BLOCK_STATE_CHARGING = 1;
const GRID_BLOCK_STATE_RECOVERING = 2;

const GRID_BLOCK_TOP_SPEED_WORLD: readonly [number, number, number] = [82, 112, 148];
const GRID_BLOCK_ACCEL_WORLD: readonly [number, number, number] = [720, 980, 1260];
const GRID_BLOCK_RECOVER_TICKS: readonly [number, number, number] = [24, 18, 13];

const REPATH_INTERVAL_TICKS = 30;
const BFS_MAX_CELLS = 512;
const CELL_OVERLAP_EPSILON = 0.5;
export const GRID_BLOCK_HIT_FLASH_TICKS = 8;

const DIR_DX = [1, 0, -1, 0] as const;
const DIR_DY = [0, 1, 0, -1] as const;

const _bfsQueue = new Int32Array(BFS_MAX_CELLS * 2);
const _bfsVisited = new Uint8Array(512 * 512);
const _bfsDirX = new Int8Array(BFS_MAX_CELLS);
const _bfsDirY = new Int8Array(BFS_MAX_CELLS);

const _slideQueue = new Int32Array(BFS_MAX_CELLS * 2);
const _slideVisited = new Uint8Array(512 * 512);
const _slideFirstDirX = new Int8Array(BFS_MAX_CELLS);
const _slideFirstDirY = new Int8Array(BFS_MAX_CELLS);

function clampSpeedIndex(speedIndex: number): 0 | 1 | 2 {
  return speedIndex === 1 ? 1 : speedIndex === 2 ? 2 : 0;
}

function isCellSolid(world: WorldState, gx: number, gy: number): boolean {
  const cellLeft = gx * BS + CELL_OVERLAP_EPSILON;
  const cellRight = (gx + 1) * BS - CELL_OVERLAP_EPSILON;
  const cellTop = gy * BS + CELL_OVERLAP_EPSILON;
  const cellBottom = (gy + 1) * BS - CELL_OVERLAP_EPSILON;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;
    if (world.wallIsInvisibleFlag[wi] === 1) continue;

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

export function getGridBlockFootprintSize(sizeIndex: number): { w: number; h: number } {
  return sizeIndex === 1 ? { w: 2, h: 2 } : { w: 1, h: 1 };
}

export function isGridFootprintInBounds(world: WorldState, gx: number, gy: number, sizeIndex: number): boolean {
  const roomWidthBlocks = Math.ceil(world.worldWidthWorld / BS);
  const roomHeightBlocks = Math.ceil(world.worldHeightWorld / BS);
  const footprint = getGridBlockFootprintSize(sizeIndex);
  return gx >= 0 && gy >= 0 && gx + footprint.w <= roomWidthBlocks && gy + footprint.h <= roomHeightBlocks;
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

function isGridFootprintLegal(world: WorldState, gx: number, gy: number, sizeIndex: number): boolean {
  return isGridFootprintInBounds(world, gx, gy, sizeIndex) && isGridFootprintPassable(world, gx, gy, sizeIndex);
}

function gridToWorldX(gx: number, sizeIndex: number): number {
  return gx * BS + (sizeIndex === 0 ? BS * 0.5 : BS);
}

function gridToWorldY(gy: number, sizeIndex: number): number {
  return gy * BS + (sizeIndex === 0 ? BS * 0.5 : BS);
}

function worldToGridX(xWorld: number, sizeIndex: number): number {
  return Math.round((xWorld - (sizeIndex === 0 ? BS * 0.5 : BS)) / BS);
}

function worldToGridY(yWorld: number, sizeIndex: number): number {
  return Math.round((yWorld - (sizeIndex === 0 ? BS * 0.5 : BS)) / BS);
}

function snakeGridToWorld(g: number): number {
  return g * BS + GRID_SNAKE_HALF_SIZE;
}

function bfsNextDirection(
  world: WorldState,
  startGX: number,
  startGY: number,
  targetGX: number,
  targetGY: number,
  sizeIndex: number,
): [number, number] {
  const roomWidthBlocks = Math.ceil(world.worldWidthWorld / BS);
  if (startGX === targetGX && startGY === targetGY) return [0, 0];

  const visitedCells: number[] = [];
  let head = 0;
  let tail = 0;

  _bfsQueue[0] = startGX;
  _bfsQueue[1] = startGY;
  _bfsDirX[0] = 0;
  _bfsDirY[0] = 0;
  tail++;

  const startKey = startGX + startGY * roomWidthBlocks;
  _bfsVisited[startKey] = 1;
  visitedCells.push(startKey);

  let foundDX = 0;
  let foundDY = 0;
  let found = false;

  while (head < tail && !found) {
    const cx = _bfsQueue[head * 2];
    const cy = _bfsQueue[head * 2 + 1];
    const cdx = _bfsDirX[head];
    const cdy = _bfsDirY[head];
    head++;

    for (let d = 0; d < 4; d++) {
      const nx = cx + DIR_DX[d];
      const ny = cy + DIR_DY[d];
      if (!isGridFootprintLegal(world, nx, ny, sizeIndex)) continue;

      const key = nx + ny * roomWidthBlocks;
      if (_bfsVisited[key]) continue;

      _bfsVisited[key] = 1;
      visitedCells.push(key);

      const stepDX = (cx === startGX && cy === startGY) ? DIR_DX[d] : cdx;
      const stepDY = (cx === startGX && cy === startGY) ? DIR_DY[d] : cdy;

      if (tail < BFS_MAX_CELLS) {
        _bfsQueue[tail * 2] = nx;
        _bfsQueue[tail * 2 + 1] = ny;
        _bfsDirX[tail] = stepDX;
        _bfsDirY[tail] = stepDY;
        tail++;
      }

      if (nx === targetGX && ny === targetGY) {
        foundDX = stepDX;
        foundDY = stepDY;
        found = true;
        break;
      }
    }
  }

  for (let i = 0; i < visitedCells.length; i++) {
    _bfsVisited[visitedCells[i]] = 0;
  }

  return found ? [foundDX, foundDY] : [0, 0];
}

function findPlayer(world: WorldState): typeof world.clusters[0] | undefined {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) return c;
  }
  return undefined;
}

function slideEnd(
  world: WorldState,
  startGX: number,
  startGY: number,
  dirX: number,
  dirY: number,
  sizeIndex: number,
): { gx: number; gy: number } {
  let gx = startGX;
  let gy = startGY;
  while (true) {
    const nx = gx + dirX;
    const ny = gy + dirY;
    if (!isGridFootprintLegal(world, nx, ny, sizeIndex)) return { gx, gy };
    gx = nx;
    gy = ny;
  }
}

function slideCrossesPlayer(
  startGX: number,
  startGY: number,
  endGX: number,
  endGY: number,
  dirX: number,
  dirY: number,
  sizeIndex: number,
  playerGX: number,
  playerGY: number,
): boolean {
  const footprint = getGridBlockFootprintSize(sizeIndex);
  if (dirX !== 0) {
    const minX = Math.min(startGX, endGX);
    const maxX = Math.max(startGX, endGX) + footprint.w - 1;
    return playerGY >= startGY && playerGY < startGY + footprint.h && playerGX >= minX && playerGX <= maxX;
  }
  if (dirY !== 0) {
    const minY = Math.min(startGY, endGY);
    const maxY = Math.max(startGY, endGY) + footprint.h - 1;
    return playerGX >= startGX && playerGX < startGX + footprint.w && playerGY >= minY && playerGY <= maxY;
  }
  return false;
}

function findDirectSlideDirection(
  world: WorldState,
  gx: number,
  gy: number,
  sizeIndex: number,
  playerGX: number,
  playerGY: number,
): [number, number] {
  for (let d = 0; d < 4; d++) {
    const end = slideEnd(world, gx, gy, DIR_DX[d], DIR_DY[d], sizeIndex);
    if (end.gx === gx && end.gy === gy) continue;
    if (slideCrossesPlayer(gx, gy, end.gx, end.gy, DIR_DX[d], DIR_DY[d], sizeIndex, playerGX, playerGY)) {
      return [DIR_DX[d], DIR_DY[d]];
    }
  }
  return [0, 0];
}

function findPlannedSlideDirection(
  world: WorldState,
  startGX: number,
  startGY: number,
  sizeIndex: number,
  playerGX: number,
  playerGY: number,
): [number, number] {
  const direct = findDirectSlideDirection(world, startGX, startGY, sizeIndex, playerGX, playerGY);
  if (direct[0] !== 0 || direct[1] !== 0) return direct;

  const roomWidthBlocks = Math.ceil(world.worldWidthWorld / BS);
  const visitedCells: number[] = [];
  let head = 0;
  let tail = 0;

  _slideQueue[0] = startGX;
  _slideQueue[1] = startGY;
  _slideFirstDirX[0] = 0;
  _slideFirstDirY[0] = 0;
  tail++;

  const startKey = startGX + startGY * roomWidthBlocks;
  _slideVisited[startKey] = 1;
  visitedCells.push(startKey);

  let outDX = 0;
  let outDY = 0;
  let found = false;

  while (head < tail && !found) {
    const cx = _slideQueue[head * 2];
    const cy = _slideQueue[head * 2 + 1];
    const cdx = _slideFirstDirX[head];
    const cdy = _slideFirstDirY[head];
    head++;

    const setup = findDirectSlideDirection(world, cx, cy, sizeIndex, playerGX, playerGY);
    if (setup[0] !== 0 || setup[1] !== 0) {
      outDX = cdx;
      outDY = cdy;
      found = true;
      break;
    }

    for (let d = 0; d < 4; d++) {
      const end = slideEnd(world, cx, cy, DIR_DX[d], DIR_DY[d], sizeIndex);
      if (end.gx === cx && end.gy === cy) continue;
      const key = end.gx + end.gy * roomWidthBlocks;
      if (_slideVisited[key]) continue;

      _slideVisited[key] = 1;
      visitedCells.push(key);

      const firstDX = (cx === startGX && cy === startGY) ? DIR_DX[d] : cdx;
      const firstDY = (cx === startGX && cy === startGY) ? DIR_DY[d] : cdy;
      if (tail < BFS_MAX_CELLS) {
        _slideQueue[tail * 2] = end.gx;
        _slideQueue[tail * 2 + 1] = end.gy;
        _slideFirstDirX[tail] = firstDX;
        _slideFirstDirY[tail] = firstDY;
        tail++;
      }
    }
  }

  for (let i = 0; i < visitedCells.length; i++) {
    _slideVisited[visitedCells[i]] = 0;
  }

  if (found && (outDX !== 0 || outDY !== 0)) return [outDX, outDY];

  for (let d = 0; d < 4; d++) {
    const end = slideEnd(world, startGX, startGY, DIR_DX[d], DIR_DY[d], sizeIndex);
    if (end.gx !== startGX || end.gy !== startGY) return [DIR_DX[d], DIR_DY[d]];
  }
  return [0, 0];
}

function overlapsPlayer(
  xWorld: number,
  yWorld: number,
  halfW: number,
  halfH: number,
  player: ClusterState,
): boolean {
  return (
    Math.abs(xWorld - player.positionXWorld) < halfW + player.halfWidthWorld &&
    Math.abs(yWorld - player.positionYWorld) < halfH + player.halfHeightWorld
  );
}

export function initializeGridSnakeSegments(
  cluster: ClusterState,
  length: number,
): void {
  const safeLength = Math.max(1, Math.min(12, Math.floor(length)));
  cluster.gridSnakeLength = safeLength;
  cluster.gridSnakeSegmentGridX = new Array<number>(safeLength);
  cluster.gridSnakeSegmentGridY = new Array<number>(safeLength);
  for (let i = 0; i < safeLength; i++) {
    cluster.gridSnakeSegmentGridX[i] = Math.max(0, cluster.gridSnakeGridX - i - 1);
    cluster.gridSnakeSegmentGridY[i] = cluster.gridSnakeGridY;
  }
}

export function applyGridSnakeEnemyAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;
  const player = findPlayer(world);

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isGridSnakeEnemyFlag !== 1 || cluster.isAliveFlag === 0) continue;

    cluster.gridSnakePhase = (cluster.gridSnakePhase + dtSec * 4.0) % (Math.PI * 2);
    if (cluster.gridSnakeSegmentGridX.length !== cluster.gridSnakeLength) {
      initializeGridSnakeSegments(cluster, cluster.gridSnakeLength || DEFAULT_GRID_SNAKE_LENGTH);
    }

    if (cluster.healthPoints < cluster.gridSnakePrevHealthPoints) {
      cluster.gridBlockHitFlashTicks = GRID_BLOCK_HIT_FLASH_TICKS;
    }
    cluster.gridSnakePrevHealthPoints = cluster.healthPoints;
    if (cluster.gridBlockHitFlashTicks > 0) cluster.gridBlockHitFlashTicks--;

    if (cluster.gridSnakeMoveTicks > 0) {
      cluster.gridSnakeMoveTicks--;
      const t = 1.0 - cluster.gridSnakeMoveTicks / GRID_SNAKE_MOVE_TICKS_PER_STEP;
      const startX = snakeGridToWorld(cluster.gridSnakeGridX);
      const startY = snakeGridToWorld(cluster.gridSnakeGridY);
      const targX = snakeGridToWorld(cluster.gridSnakeTargetGridX);
      const targY = snakeGridToWorld(cluster.gridSnakeTargetGridY);
      cluster.positionXWorld = startX + (targX - startX) * t;
      cluster.positionYWorld = startY + (targY - startY) * t;

      if (cluster.gridSnakeMoveTicks <= 0) {
        const oldHeadX = cluster.gridSnakeGridX;
        const oldHeadY = cluster.gridSnakeGridY;
        for (let i = cluster.gridSnakeLength - 1; i >= 1; i--) {
          cluster.gridSnakeSegmentGridX[i] = cluster.gridSnakeSegmentGridX[i - 1];
          cluster.gridSnakeSegmentGridY[i] = cluster.gridSnakeSegmentGridY[i - 1];
        }
        cluster.gridSnakeSegmentGridX[0] = oldHeadX;
        cluster.gridSnakeSegmentGridY[0] = oldHeadY;
        cluster.gridSnakeGridX = cluster.gridSnakeTargetGridX;
        cluster.gridSnakeGridY = cluster.gridSnakeTargetGridY;
        cluster.positionXWorld = snakeGridToWorld(cluster.gridSnakeGridX);
        cluster.positionYWorld = snakeGridToWorld(cluster.gridSnakeGridY);
      }
    } else {
      cluster.gridSnakeRepathCooldownTicks--;
      if (cluster.gridSnakeRepathCooldownTicks <= 0) {
        cluster.gridSnakeRepathCooldownTicks = GRID_SNAKE_REPATH_INTERVAL_TICKS;
        if (player !== undefined) {
          const [dx, dy] = bfsNextDirection(
            world,
            cluster.gridSnakeGridX,
            cluster.gridSnakeGridY,
            Math.floor(player.positionXWorld / BS),
            Math.floor(player.positionYWorld / BS),
            0,
          );
          cluster.gridSnakeNextDirX = dx;
          cluster.gridSnakeNextDirY = dy;
        } else {
          cluster.gridSnakeNextDirX = 0;
          cluster.gridSnakeNextDirY = 0;
        }
      }

      const nx = cluster.gridSnakeGridX + cluster.gridSnakeNextDirX;
      const ny = cluster.gridSnakeGridY + cluster.gridSnakeNextDirY;
      if ((cluster.gridSnakeNextDirX !== 0 || cluster.gridSnakeNextDirY !== 0) && isGridFootprintLegal(world, nx, ny, 0)) {
        cluster.gridSnakeTargetGridX = nx;
        cluster.gridSnakeTargetGridY = ny;
        cluster.gridSnakeMoveTicks = GRID_SNAKE_MOVE_TICKS_PER_STEP;
        cluster.gridSnakeNextDirX = 0;
        cluster.gridSnakeNextDirY = 0;
        cluster.gridSnakeRepathCooldownTicks = 0;
      }
    }

    if (player !== undefined && player.invulnerabilityTicks <= 0) {
      if (overlapsPlayer(cluster.positionXWorld, cluster.positionYWorld, cluster.halfWidthWorld, cluster.halfHeightWorld, player)) {
        applyPlayerDamageWithKnockback(player, GRID_SNAKE_CONTACT_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
      } else {
        for (let i = 0; i < cluster.gridSnakeLength; i++) {
          const sx = snakeGridToWorld(cluster.gridSnakeSegmentGridX[i]);
          const sy = snakeGridToWorld(cluster.gridSnakeSegmentGridY[i]);
          if (overlapsPlayer(sx, sy, GRID_SNAKE_HALF_SIZE, GRID_SNAKE_HALF_SIZE, player)) {
            applyPlayerDamageWithKnockback(player, GRID_SNAKE_CONTACT_DAMAGE, sx, sy);
            break;
          }
        }
      }
    }
  }
}

export function applyGridBlockEnemyAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;
  const player = findPlayer(world);

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isGridBlockEnemyFlag !== 1 || cluster.isAliveFlag === 0) continue;

    const sizeIndex = cluster.gridBlockSizeIndex === 1 ? 1 : 0;
    const speedIndex = clampSpeedIndex(cluster.gridBlockSpeedIndex);
    cluster.gridBlockSizeIndex = sizeIndex;
    cluster.gridBlockSpeedIndex = speedIndex;

    cluster.gridBlockGlintPhase = (cluster.gridBlockGlintPhase + dtSec * 2.0) % (Math.PI * 2);
    if (cluster.healthPoints < cluster.gridBlockPrevHealthPoints) {
      cluster.gridBlockHitFlashTicks = GRID_BLOCK_HIT_FLASH_TICKS;
    }
    cluster.gridBlockPrevHealthPoints = cluster.healthPoints;
    if (cluster.gridBlockHitFlashTicks > 0) cluster.gridBlockHitFlashTicks--;

    if (cluster.gridBlockAiState === GRID_BLOCK_STATE_CHARGING) {
      const targetX = gridToWorldX(cluster.gridBlockTargetGridX, sizeIndex);
      const targetY = gridToWorldY(cluster.gridBlockTargetGridY, sizeIndex);
      const dx = targetX - cluster.positionXWorld;
      const dy = targetY - cluster.positionYWorld;
      const remaining = Math.abs(dx) + Math.abs(dy);

      cluster.gridBlockChargeSpeedWorld = Math.min(
        GRID_BLOCK_TOP_SPEED_WORLD[speedIndex],
        cluster.gridBlockChargeSpeedWorld + GRID_BLOCK_ACCEL_WORLD[speedIndex] * dtSec,
      );
      const step = cluster.gridBlockChargeSpeedWorld * dtSec;

      if (remaining <= step || remaining <= 0.001) {
        cluster.gridBlockGridX = cluster.gridBlockTargetGridX;
        cluster.gridBlockGridY = cluster.gridBlockTargetGridY;
        cluster.positionXWorld = targetX;
        cluster.positionYWorld = targetY;
        cluster.velocityXWorld = 0;
        cluster.velocityYWorld = 0;
        cluster.gridBlockChargeSpeedWorld = 0;
        cluster.gridBlockRecoverTicks = GRID_BLOCK_RECOVER_TICKS[speedIndex];
        cluster.gridBlockAiState = GRID_BLOCK_STATE_RECOVERING;
        cluster.gridBlockHitFlashTicks = GRID_BLOCK_HIT_FLASH_TICKS;
      } else {
        cluster.positionXWorld += cluster.gridBlockChargeDirX * step;
        cluster.positionYWorld += cluster.gridBlockChargeDirY * step;
        cluster.velocityXWorld = cluster.gridBlockChargeDirX * cluster.gridBlockChargeSpeedWorld;
        cluster.velocityYWorld = cluster.gridBlockChargeDirY * cluster.gridBlockChargeSpeedWorld;
      }
    } else if (cluster.gridBlockAiState === GRID_BLOCK_STATE_RECOVERING) {
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;
      cluster.gridBlockRecoverTicks--;
      if (cluster.gridBlockRecoverTicks <= 0) {
        cluster.gridBlockAiState = GRID_BLOCK_STATE_RESTING;
        cluster.gridBlockRepathCooldownTicks = 0;
      }
    } else {
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;
      cluster.gridBlockGridX = worldToGridX(cluster.positionXWorld, sizeIndex);
      cluster.gridBlockGridY = worldToGridY(cluster.positionYWorld, sizeIndex);
      cluster.positionXWorld = gridToWorldX(cluster.gridBlockGridX, sizeIndex);
      cluster.positionYWorld = gridToWorldY(cluster.gridBlockGridY, sizeIndex);

      cluster.gridBlockRepathCooldownTicks--;
      if (cluster.gridBlockRepathCooldownTicks <= 0) {
        cluster.gridBlockRepathCooldownTicks = REPATH_INTERVAL_TICKS;
        if (player !== undefined) {
          const [dx, dy] = findPlannedSlideDirection(
            world,
            cluster.gridBlockGridX,
            cluster.gridBlockGridY,
            sizeIndex,
            Math.floor(player.positionXWorld / BS),
            Math.floor(player.positionYWorld / BS),
          );
          cluster.gridBlockNextDirX = dx;
          cluster.gridBlockNextDirY = dy;
        } else {
          cluster.gridBlockNextDirX = 0;
          cluster.gridBlockNextDirY = 0;
        }
      }

      if (cluster.gridBlockNextDirX !== 0 || cluster.gridBlockNextDirY !== 0) {
        const end = slideEnd(
          world,
          cluster.gridBlockGridX,
          cluster.gridBlockGridY,
          cluster.gridBlockNextDirX,
          cluster.gridBlockNextDirY,
          sizeIndex,
        );
        if (end.gx !== cluster.gridBlockGridX || end.gy !== cluster.gridBlockGridY) {
          cluster.gridBlockTargetGridX = end.gx;
          cluster.gridBlockTargetGridY = end.gy;
          cluster.gridBlockChargeDirX = cluster.gridBlockNextDirX;
          cluster.gridBlockChargeDirY = cluster.gridBlockNextDirY;
          cluster.gridBlockChargeSpeedWorld = 0;
          cluster.gridBlockAiState = GRID_BLOCK_STATE_CHARGING;
          cluster.gridBlockNextDirX = 0;
          cluster.gridBlockNextDirY = 0;
        }
      }
    }

    if (player !== undefined && player.invulnerabilityTicks <= 0) {
      if (overlapsPlayer(cluster.positionXWorld, cluster.positionYWorld, cluster.halfWidthWorld, cluster.halfHeightWorld, player)) {
        applyPlayerDamageWithKnockback(player, GRID_BLOCK_CONTACT_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
      }
    }
  }
}
