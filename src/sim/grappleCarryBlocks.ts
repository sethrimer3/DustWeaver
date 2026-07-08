import type { WorldState } from './world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

export const GRAPPLE_CARRY_BLOCK_SIZE_WORLD = BLOCK_SIZE_MEDIUM;

const HALF = GRAPPLE_CARRY_BLOCK_SIZE_WORLD * 0.5;
const GRAVITY_WORLD_PER_SEC2 = 520;
const MAX_SPEED_WORLD_PER_SEC = 260;
const FLOOR_FRICTION_PER_SEC = 7.5;

export const enum GrappleCarryContactFlag {
  Left = 1,
  Right = 2,
  Top = 4,
  Bottom = 8,
}

function clampSpeed(v: number): number {
  return Math.max(-MAX_SPEED_WORLD_PER_SEC, Math.min(MAX_SPEED_WORLD_PER_SEC, v));
}

function overlaps(cx: number, cy: number, left: number, top: number, right: number, bottom: number): boolean {
  return cx + HALF > left && cx - HALF < right && cy + HALF > top && cy - HALF < bottom;
}

function forEachCarrySolid(world: WorldState, cb: (left: number, top: number, right: number, bottom: number) => void): void {
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;
    const left = world.wallXWorld[wi];
    const top = world.wallYWorld[wi];
    cb(left, top, left + world.wallWWorld[wi], top + world.wallHWorld[wi]);
  }
  for (let i = 0; i < world.phantasmalTileCount; i++) {
    const left = world.phantasmalTileXWorld[i];
    const top = world.phantasmalTileYWorld[i];
    cb(left, top, left + BLOCK_SIZE_MEDIUM, top + BLOCK_SIZE_MEDIUM);
  }
}

function moveX(world: WorldState, index: number, dtSec: number): void {
  const startX = world.grappleCarryBlockXWorld[index];
  let x = startX;
  const y = world.grappleCarryBlockYWorld[index];
  const vx = world.grappleCarryBlockVelXWorld[index];
  const steps = Math.max(1, Math.ceil(Math.abs(vx * dtSec) / HALF));
  const dt = dtSec / steps;
  for (let s = 0; s < steps; s++) {
    const prevX = x;
    x += vx * dt;
    forEachCarrySolid(world, (left, top, right, bottom) => {
      if (!overlaps(x, y, left, top, right, bottom)) return;
      if (prevX + HALF <= left && vx > 0) {
        x = left - HALF;
        world.grappleCarryBlockVelXWorld[index] = 0;
        world.grappleCarryBlockContactFlags[index] |= GrappleCarryContactFlag.Right;
      } else if (prevX - HALF >= right && vx < 0) {
        x = right + HALF;
        world.grappleCarryBlockVelXWorld[index] = 0;
        world.grappleCarryBlockContactFlags[index] |= GrappleCarryContactFlag.Left;
      }
    });
  }
  world.grappleCarryBlockXWorld[index] = x;
}

function moveY(world: WorldState, index: number, dtSec: number): void {
  const x = world.grappleCarryBlockXWorld[index];
  let y = world.grappleCarryBlockYWorld[index];
  const vy = world.grappleCarryBlockVelYWorld[index];
  const steps = Math.max(1, Math.ceil(Math.abs(vy * dtSec) / HALF));
  const dt = dtSec / steps;
  for (let s = 0; s < steps; s++) {
    const prevY = y;
    y += vy * dt;
    forEachCarrySolid(world, (left, top, right, bottom) => {
      if (!overlaps(x, y, left, top, right, bottom)) return;
      if (prevY + HALF <= top && vy > 0) {
        y = top - HALF;
        world.grappleCarryBlockVelYWorld[index] = 0;
        world.grappleCarryBlockGroundedFlag[index] = 1;
        world.grappleCarryBlockContactFlags[index] |= GrappleCarryContactFlag.Bottom;
      } else if (prevY - HALF >= bottom && vy < 0) {
        y = bottom + HALF;
        world.grappleCarryBlockVelYWorld[index] = 0;
        world.grappleCarryBlockContactFlags[index] |= GrappleCarryContactFlag.Top;
      }
    });
  }
  world.grappleCarryBlockYWorld[index] = y;
}

export function tickGrappleCarryBlocks(world: WorldState): void {
  const dtSec = world.dtMs / 1000;
  for (let i = 0; i < world.grappleCarryBlockCount; i++) {
    world.grappleCarryBlockGroundedFlag[i] = 0;
    world.grappleCarryBlockContactFlags[i] = 0;
    world.grappleCarryBlockVelYWorld[i] = clampSpeed(world.grappleCarryBlockVelYWorld[i] + GRAVITY_WORLD_PER_SEC2 * dtSec);
    world.grappleCarryBlockVelXWorld[i] = clampSpeed(world.grappleCarryBlockVelXWorld[i]);
    moveX(world, i, dtSec);
    moveY(world, i, dtSec);
    if (world.grappleCarryBlockGroundedFlag[i] === 1) {
      const f = Math.max(0, 1 - FLOOR_FRICTION_PER_SEC * dtSec);
      world.grappleCarryBlockVelXWorld[i] *= f;
    }
  }
}

export function isGrappleCarryBlockPinnedToward(world: WorldState, index: number, dirX: number, dirY: number): boolean {
  const flags = world.grappleCarryBlockContactFlags[index];
  return (dirX < -0.15 && (flags & GrappleCarryContactFlag.Left) !== 0)
    || (dirX > 0.15 && (flags & GrappleCarryContactFlag.Right) !== 0)
    || (dirY < -0.15 && (flags & GrappleCarryContactFlag.Top) !== 0)
    || (dirY > 0.15 && (flags & GrappleCarryContactFlag.Bottom) !== 0);
}

export function findGrappleCarryBlockRayHit(
  world: WorldState,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
): { index: number; t: number; x: number; y: number } | null {
  let bestT = Number.POSITIVE_INFINITY;
  let bestIndex = -1;
  for (let i = 0; i < world.grappleCarryBlockCount; i++) {
    const minX = world.grappleCarryBlockXWorld[i] - HALF;
    const minY = world.grappleCarryBlockYWorld[i] - HALF;
    const maxX = minX + GRAPPLE_CARRY_BLOCK_SIZE_WORLD;
    const maxY = minY + GRAPPLE_CARRY_BLOCK_SIZE_WORLD;
    let tMin = 0;
    let tMax = maxDist;
    if (Math.abs(dx) < 1e-6) {
      if (ox < minX || ox > maxX) continue;
    } else {
      const a = (minX - ox) / dx;
      const b = (maxX - ox) / dx;
      tMin = Math.max(tMin, Math.min(a, b));
      tMax = Math.min(tMax, Math.max(a, b));
    }
    if (Math.abs(dy) < 1e-6) {
      if (oy < minY || oy > maxY) continue;
    } else {
      const a = (minY - oy) / dy;
      const b = (maxY - oy) / dy;
      tMin = Math.max(tMin, Math.min(a, b));
      tMax = Math.min(tMax, Math.max(a, b));
    }
    if (tMin <= tMax && tMin >= 0 && tMin < bestT) {
      bestT = tMin;
      bestIndex = i;
    }
  }
  return bestIndex >= 0 ? { index: bestIndex, t: bestT, x: ox + dx * bestT, y: oy + dy * bestT } : null;
}
