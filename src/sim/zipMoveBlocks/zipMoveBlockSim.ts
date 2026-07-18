import type { WorldState } from '../world';
import { releaseGrapple } from '../clusters/grappleShared';
import {
  ZIP_MOVE_BLOCK_ACCEL_WORLD_PER_SEC2,
  ZIP_MOVE_BLOCK_ACTIVE_EASE_PER_SEC,
  ZIP_MOVE_BLOCK_TOP_SPEED_WORLD_PER_SEC,
  directionForZipSide,
  type ZipMoveBlockRuntime,
  type ZipMoveBlockSide,
} from './zipMoveBlockTypes';
import { FB_STATE_IDLE_STABLE, FB_STATE_REMOVED, FB_STATE_WARNING } from '../fallingBlocks/fallingBlockTypes';
import { updateWallSlot } from '../fallingBlocks/fallingBlockSim';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

const EPS = 0.001;

function sideFromResolvedNormal(nx: number, ny: number): ZipMoveBlockSide {
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'right' : 'left';
  return ny >= 0 ? 'bottom' : 'top';
}

function pointTouchesBlockFace(block: ZipMoveBlockRuntime, side: ZipMoveBlockSide, x: number, y: number): boolean {
  const margin = 2;
  if (side === 'top' || side === 'bottom') {
    const faceY = side === 'top' ? block.yWorld : block.yWorld + block.hWorld;
    return x >= block.xWorld - margin && x <= block.xWorld + block.wWorld + margin && Math.abs(y - faceY) <= margin;
  }
  const faceX = side === 'left' ? block.xWorld : block.xWorld + block.wWorld;
  return y >= block.yWorld - margin && y <= block.yWorld + block.hWorld + margin && Math.abs(x - faceX) <= margin;
}

export function tryActivateZipMoveBlock(block: ZipMoveBlockRuntime, side: ZipMoveBlockSide): boolean {
  if (block.state !== 'dormant') return false;
  const direction = directionForZipSide(block.variant, side);
  block.activationSide = side;
  block.velocityXWorld = direction.x * EPS;
  block.velocityYWorld = direction.y * EPS;
  block.state = 'accelerating';
  return true;
}

function moveSwept(world: WorldState, block: ZipMoveBlockRuntime, dx: number, dy: number): { dx: number; dy: number; blocked: boolean } {
  // Pixel sandstone is a pass-through destructible. Convert every cell in the
  // swept footprint before solid resolution so thick regions cannot stop or
  // tunnel the block and each cell converts at most once.
  const sweepLeft = Math.floor(Math.min(block.xWorld, block.xWorld + dx));
  const sweepRight = Math.ceil(Math.max(block.xWorld + block.wWorld, block.xWorld + block.wWorld + dx));
  const sweepTop = Math.floor(Math.min(block.yWorld, block.yWorld + dy));
  const sweepBottom = Math.ceil(Math.max(block.yWorld + block.hWorld, block.yWorld + block.hWorld + dy));
  for (let y = sweepTop; y <= sweepBottom; y++) {
    for (let x = sweepLeft; x <= sweepRight; x++) world.pixelMaterialSystem.fractureSandstoneAtCell(x, y);
  }
  // The authored `crumbling` falling-block variant is the weakest existing
  // walk/contact-triggered type. A moving zip block removes it immediately;
  // tough/sensitive groups enter their canonical warning state and remain solid.
  for (const group of world.fallingBlockGroups) {
    if (group.state === FB_STATE_REMOVED) continue;
    const gx = group.restXWorld;
    const gy = group.restYWorld + group.offsetYWorld;
    if (sweepRight <= gx || sweepLeft >= gx + group.wWorld || sweepBottom <= gy || sweepTop >= gy + group.hWorld) continue;
    if (group.variant === 'crumbling') {
      group.state = FB_STATE_REMOVED;
      group.velocityYWorld = 0;
      updateWallSlot(group, world);
    } else if (group.state === FB_STATE_IDLE_STABLE) {
      group.state = FB_STATE_WARNING;
      group.stateTimerTicks = 0;
    }
  }
  let allowed = dx !== 0 ? Math.abs(dx) : Math.abs(dy);
  const sign = dx !== 0 ? Math.sign(dx) : Math.sign(dy);
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (wi === block.wallIndex || world.wallWWorld[wi] <= 0 || world.wallHWorld[wi] <= 0) continue;
    const wx = world.wallXWorld[wi], wy = world.wallYWorld[wi];
    const ww = world.wallWWorld[wi], wh = world.wallHWorld[wi];
    if (dx !== 0) {
      if (block.yWorld + block.hWorld <= wy + EPS || block.yWorld >= wy + wh - EPS) continue;
      const gap = sign > 0 ? wx - (block.xWorld + block.wWorld) : block.xWorld - (wx + ww);
      if (gap >= -EPS && gap < allowed) allowed = Math.max(0, gap);
    } else {
      if (block.xWorld + block.wWorld <= wx + EPS || block.xWorld >= wx + ww - EPS) continue;
      const gap = sign > 0 ? wy - (block.yWorld + block.hWorld) : block.yWorld - (wy + wh);
      if (gap >= -EPS && gap < allowed) allowed = Math.max(0, gap);
    }
  }
  const requested = dx !== 0 ? Math.abs(dx) : Math.abs(dy);
  return { dx: dx !== 0 ? allowed * sign : 0, dy: dy !== 0 ? allowed * sign : 0, blocked: allowed + EPS < requested };
}

function pushOrCrushClusters(world: WorldState, block: ZipMoveBlockRuntime, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const cluster of world.clusters) {
    if (cluster.isAliveFlag === 0) continue;
    const left = cluster.positionXWorld - cluster.halfWidthWorld;
    const right = cluster.positionXWorld + cluster.halfWidthWorld;
    const top = cluster.positionYWorld - cluster.halfHeightWorld;
    const bottom = cluster.positionYWorld + cluster.halfHeightWorld;
    if (right <= block.xWorld + EPS || left >= block.xWorld + block.wWorld - EPS || bottom <= block.yWorld + EPS || top >= block.yWorld + block.hWorld - EPS) continue;
    cluster.positionXWorld += dx;
    cluster.positionYWorld += dy;
    let trapped = false;
    for (let wi = 0; wi < world.wallCount; wi++) {
      if (wi === block.wallIndex || world.wallWWorld[wi] <= 0 || world.wallHWorld[wi] <= 0) continue;
      const nl = cluster.positionXWorld - cluster.halfWidthWorld;
      const nr = cluster.positionXWorld + cluster.halfWidthWorld;
      const nt = cluster.positionYWorld - cluster.halfHeightWorld;
      const nb = cluster.positionYWorld + cluster.halfHeightWorld;
      if (nr > world.wallXWorld[wi] + EPS && nl < world.wallXWorld[wi] + world.wallWWorld[wi] - EPS
          && nb > world.wallYWorld[wi] + EPS && nt < world.wallYWorld[wi] + world.wallHWorld[wi] - EPS) { trapped = true; break; }
    }
    if (trapped) {
      if (cluster.isPlayerFlag === 1) {
        // Match the established falling-block crush pathway so challenge
        // returns, hurt/death presentation, and player bookkeeping stay canonical.
        applyPlayerDamageWithKnockback(cluster, Math.max(1, cluster.healthPoints),
          block.xWorld + block.wWorld * 0.5, block.yWorld + block.hWorld * 0.5);
      } else {
        cluster.healthPoints = 0;
        cluster.isAliveFlag = 0;
      }
    }
  }
}

export function tickZipMoveBlocks(world: WorldState, dtMs: number): void {
  const dt = dtMs / 1000;
  const impacted = world.hasZipImpactedSurfaceFlag === 1;
  const side = impacted ? sideFromResolvedNormal(world.grappleZipNormalXWorld, world.grappleZipNormalYWorld) : null;
  for (const block of world.zipMoveBlocks) {
    if (!impacted) block.zipImpactLatched = false;
    if (impacted && !block.zipImpactLatched && side !== null
        && pointTouchesBlockFace(block, side, world.grappleAnchorXWorld, world.grappleAnchorYWorld)) {
      block.zipImpactLatched = true;
      if (tryActivateZipMoveBlock(block, side)) releaseGrapple(world, false);
    }
    const activeTarget = block.state === 'dormant' ? 0 : 1;
    block.activeAmount += (activeTarget - block.activeAmount) * (1 - Math.exp(-ZIP_MOVE_BLOCK_ACTIVE_EASE_PER_SEC * dt));
    if (block.state === 'dormant') continue;
    const dir = directionForZipSide(block.variant, block.activationSide!);
    const speed = Math.min(ZIP_MOVE_BLOCK_TOP_SPEED_WORLD_PER_SEC,
      Math.hypot(block.velocityXWorld, block.velocityYWorld) + ZIP_MOVE_BLOCK_ACCEL_WORLD_PER_SEC2 * dt);
    block.velocityXWorld = dir.x * speed;
    block.velocityYWorld = dir.y * speed;
    if (speed >= ZIP_MOVE_BLOCK_TOP_SPEED_WORLD_PER_SEC - EPS) block.state = 'moving';
    const movement = moveSwept(world, block, block.velocityXWorld * dt, block.velocityYWorld * dt);
    block.xWorld += movement.dx;
    block.yWorld += movement.dy;
    world.wallXWorld[block.wallIndex] = block.xWorld;
    world.wallYWorld[block.wallIndex] = block.yWorld;
    pushOrCrushClusters(world, block, movement.dx, movement.dy);
    if (movement.blocked) {
      block.velocityXWorld = 0;
      block.velocityYWorld = 0;
      block.state = 'dormant';
    }
  }
}
