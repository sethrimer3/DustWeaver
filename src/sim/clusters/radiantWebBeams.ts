/**
 * Radiant Web — beam attack system (main beams, branch beams, energize, rope decay).
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import {
  RW_RAYCAST_STEP_WORLD,
  RW_BRANCH_START_OFFSET_WORLD,
  RW_MAIN_BEAM_COUNT,
  RW_MAIN_BEAM_GROW_SPEED_WORLD,
  RW_MAIN_BEAM_MAX_RANGE_WORLD,
  RW_BRANCH_BEAMS_PER_MAIN,
  RW_BRANCH_BEAM_ANGLE_OFFSET_RAD,
  RW_BRANCH_BEAM_GROW_SPEED_WORLD,
  RW_BRANCH_BEAM_MAX_RANGE_WORLD,
  RW_BRANCH_ENERGIZE_DELAY_TICKS,
  RW_BRANCH_DAMAGE,
  RW_BRANCH_HITBOX_HALF_WIDTH_WORLD,
  RW_BRANCH_IFRAMES_TICKS,
  RW_BRANCH_ROPE_LIFETIME_TICKS,
  RW_BRANCH_ROPE_GRAVITY_WORLD,
  RW_BRANCH_ROPE_DRAG,
  RW_BEAM_JITTER_RAD,
  RW_BEAM_ANGLE_SPACING_RAD,
  RW_SECONDARY_BEAM_JITTER_RAD,
} from './radiantWebConfig';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { closestPointOnSegment } from '../physics/collision';

export interface MainBeam {
  originXWorld: number;
  originYWorld: number;
  dirXWorld: number;
  dirYWorld: number;
  currentLengthWorld: number;
  maxLengthWorld: number;
  hitXWorld: number;
  hitYWorld: number;
  normalXWorld: number;
  normalYWorld: number;
  hasHitWall: 0 | 1;
  isActiveFlag: 0 | 1;
  puffProgress: number;
}

export interface BranchBeam {
  startXWorld: number;
  startYWorld: number;
  dirXWorld: number;
  dirYWorld: number;
  currentLengthWorld: number;
  maxLengthWorld: number;
  hasHitWall: 0 | 1;
  isActiveFlag: 0 | 1;
  isEnergizedFlag: 0 | 1;
  energizeTicks: number;
  isRopeFlag: 0 | 1;
  ropeAnchorXWorld: number;
  ropeAnchorYWorld: number;
  ropeFreeEndXWorld: number;
  ropeFreeEndYWorld: number;
  ropeFreeEndVelXWorld: number;
  ropeFreeEndVelYWorld: number;
  ropeLengthWorld: number;
  ropeLifetimeTicks: number;
  ropeTotalLifetimeTicks: number;
}

export interface RadiantWebBeamState {
  mainBeams: MainBeam[];
  branchBeams: BranchBeam[];
  attackPhaseTicks: number;
  attackPhase: number;
  branchPlayerIframeTicks: number;
}

export function createRadiantWebBeamState(): RadiantWebBeamState {
  const mainBeams: MainBeam[] = [];
  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    mainBeams.push(createInactiveMainBeam());
  }
  const branchBeams: BranchBeam[] = [];
  const branchBeamCount = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < branchBeamCount; i++) {
    branchBeams.push(createInactiveBranchBeam());
  }
  return {
    mainBeams,
    branchBeams,
    attackPhaseTicks: 0,
    attackPhase: 0,
    branchPlayerIframeTicks: 0,
  };
}

function createInactiveMainBeam(): MainBeam {
  return {
    originXWorld: 0, originYWorld: 0,
    dirXWorld: 0, dirYWorld: 0,
    currentLengthWorld: 0, maxLengthWorld: 0,
    hitXWorld: 0, hitYWorld: 0,
    normalXWorld: 0, normalYWorld: 0,
    hasHitWall: 0, isActiveFlag: 0, puffProgress: 0,
  };
}

function createInactiveBranchBeam(): BranchBeam {
  return {
    startXWorld: 0, startYWorld: 0,
    dirXWorld: 0, dirYWorld: 0,
    currentLengthWorld: 0, maxLengthWorld: 0,
    hasHitWall: 0, isActiveFlag: 0, isEnergizedFlag: 0,
    energizeTicks: 0,
    isRopeFlag: 0,
    ropeAnchorXWorld: 0, ropeAnchorYWorld: 0,
    ropeFreeEndXWorld: 0, ropeFreeEndYWorld: 0,
    ropeFreeEndVelXWorld: 0, ropeFreeEndVelYWorld: 0,
    ropeLengthWorld: 0,
    ropeLifetimeTicks: 0, ropeTotalLifetimeTicks: 0,
  };
}

export function raycastToWallWithNormal(
  world: WorldState,
  startXWorld: number, startYWorld: number,
  dirXWorld: number, dirYWorld: number,
  maxRangeWorld: number,
): { xWorld: number; yWorld: number; normalXWorld: number; normalYWorld: number } | null {
  const step = RW_RAYCAST_STEP_WORLD;
  const steps = Math.ceil(maxRangeWorld / step);
  let prevX = startXWorld;
  let prevY = startYWorld;
  let x = startXWorld;
  let y = startYWorld;
  for (let s = 0; s < steps; s++) {
    prevX = x;
    prevY = y;
    x += dirXWorld * step;
    y += dirYWorld * step;
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];
      if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh) {
        // Pick the wall face normal that points OUT of the wall toward the incoming
        // ray's origin — i.e. the face normal n where (n · rayDir) is most negative
        // (most opposing the ray).  Equivalently, maximise (n · (-rayDir)):
        //   left  n=(-1,0): (-1)*(-dirX) = dirX    → dotLeft  = +dirXWorld
        //   right n=(+1,0): (+1)*(-dirX) = -dirX   → dotRight = -dirXWorld
        //   top   n=(0,-1): (-1)*(-dirY) = dirY    → dotTop   = +dirYWorld
        //   bot   n=(0,+1): (+1)*(-dirY) = -dirY   → dotBottom= -dirYWorld
        const dotLeft   =  dirXWorld;
        const dotRight  = -dirXWorld;
        const dotTop    =  dirYWorld;
        const dotBottom = -dirYWorld;
        let normalXWorld = 0;
        let normalYWorld = 0;
        const best = Math.max(dotLeft, dotRight, dotTop, dotBottom);
        if (best === dotLeft)        { normalXWorld = -1; normalYWorld =  0; }
        else if (best === dotRight)  { normalXWorld =  1; normalYWorld =  0; }
        else if (best === dotTop)    { normalXWorld =  0; normalYWorld = -1; }
        else                         { normalXWorld =  0; normalYWorld =  1; }
        return { xWorld: prevX, yWorld: prevY, normalXWorld, normalYWorld };
      }
    }
  }
  return null;
}

const _BEAM_RETRY_COUNT = 4;
const _BEAM_RETRY_OFFSET_RAD = 0.15;

export function startBeamAttack(
  bs: RadiantWebBeamState,
  world: WorldState,
  bossXWorld: number, bossYWorld: number,
  playerXWorld: number, playerYWorld: number,
): void {
  bs.attackPhaseTicks = 0;
  bs.attackPhase = 0;

  const dxP = playerXWorld - bossXWorld;
  const dyP = playerYWorld - bossYWorld;
  const baseAngleRad = Math.atan2(dyP, dxP);
  const jitter = (nextFloat(world.rng) - 0.5) * RW_BEAM_JITTER_RAD;
  const beam0Angle = baseAngleRad + jitter;

  const angles = [
    beam0Angle,
    beam0Angle + RW_BEAM_ANGLE_SPACING_RAD + (nextFloat(world.rng) - 0.5) * RW_SECONDARY_BEAM_JITTER_RAD,
    beam0Angle - RW_BEAM_ANGLE_SPACING_RAD + (nextFloat(world.rng) - 0.5) * RW_SECONDARY_BEAM_JITTER_RAD,
  ];

  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    const mb = bs.mainBeams[i];
    mb.isActiveFlag = 0;
    mb.currentLengthWorld = 0;
    mb.hasHitWall = 0;
    mb.puffProgress = 0;

    let hit: { xWorld: number; yWorld: number; normalXWorld: number; normalYWorld: number } | null = null;
    let chosenAngle = angles[i];
    for (let r = 0; r <= _BEAM_RETRY_COUNT; r++) {
      const tryAngle = r === 0
        ? angles[i]
        : angles[i] + (r % 2 === 0 ? 1 : -1) * Math.ceil(r / 2) * _BEAM_RETRY_OFFSET_RAD;
      const dX = Math.cos(tryAngle);
      const dY = Math.sin(tryAngle);
      hit = raycastToWallWithNormal(world, bossXWorld, bossYWorld, dX, dY, RW_MAIN_BEAM_MAX_RANGE_WORLD);
      if (hit !== null) {
        chosenAngle = tryAngle;
        break;
      }
    }

    if (hit === null) continue; // No wall found even after retries — skip beam

    const dX = Math.cos(chosenAngle);
    const dY = Math.sin(chosenAngle);
    // Store origin at fire time — rendering always uses this fixed point so beams
    // do not drift if the boss moves while they are growing.
    mb.originXWorld = bossXWorld;
    mb.originYWorld = bossYWorld;
    mb.dirXWorld = dX;
    mb.dirYWorld = dY;
    mb.maxLengthWorld = Math.sqrt(
      (hit.xWorld - bossXWorld) * (hit.xWorld - bossXWorld) +
      (hit.yWorld - bossYWorld) * (hit.yWorld - bossYWorld),
    );
    mb.hitXWorld = hit.xWorld;
    mb.hitYWorld = hit.yWorld;
    mb.normalXWorld = hit.normalXWorld;
    mb.normalYWorld = hit.normalYWorld;
    mb.isActiveFlag = 1;
  }
}

export function tickBeamGrow(bs: RadiantWebBeamState): boolean {
  bs.attackPhaseTicks++;
  let allHit = true;
  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    const mb = bs.mainBeams[i];
    if (mb.isActiveFlag === 0) continue;
    if (mb.hasHitWall === 0) {
      mb.currentLengthWorld += RW_MAIN_BEAM_GROW_SPEED_WORLD;
      if (mb.currentLengthWorld >= mb.maxLengthWorld) {
        mb.currentLengthWorld = mb.maxLengthWorld;
        mb.hasHitWall = 1;
      } else {
        allHit = false;
      }
    }
  }
  let anyActive = false;
  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    if (bs.mainBeams[i].isActiveFlag === 1) { anyActive = true; break; }
  }
  return !anyActive || allHit;
}

export function startBranchGrow(bs: RadiantWebBeamState, world: WorldState): void {
  bs.attackPhaseTicks = 0;
  bs.attackPhase = 1;

  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    const mb = bs.mainBeams[i];
    if (mb.isActiveFlag === 0 || mb.hasHitWall === 0) {
      for (let b = 0; b < RW_BRANCH_BEAMS_PER_MAIN; b++) {
        bs.branchBeams[i * RW_BRANCH_BEAMS_PER_MAIN + b].isActiveFlag = 0;
      }
      continue;
    }

    const hitX = mb.hitXWorld;
    const hitY = mb.hitYWorld;
    const nx = mb.normalXWorld;
    const ny = mb.normalYWorld;

    for (let b = 0; b < RW_BRANCH_BEAMS_PER_MAIN; b++) {
      const angle = b === 0
        ? -RW_BRANCH_BEAM_ANGLE_OFFSET_RAD
        : RW_BRANCH_BEAM_ANGLE_OFFSET_RAD;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const dirX = nx * cosA - ny * sinA;
      const dirY = nx * sinA + ny * cosA;

      const slotIndex = i * RW_BRANCH_BEAMS_PER_MAIN + b;
      const bb = bs.branchBeams[slotIndex];

      const startX = hitX + dirX * RW_BRANCH_START_OFFSET_WORLD;
      const startY = hitY + dirY * RW_BRANCH_START_OFFSET_WORLD;

      let branchHit: { xWorld: number; yWorld: number; normalXWorld: number; normalYWorld: number } | null = null;
      let chosenDirX = dirX;
      let chosenDirY = dirY;
      for (let r = 0; r <= _BEAM_RETRY_COUNT; r++) {
        if (r === 0) {
          branchHit = raycastToWallWithNormal(world, startX, startY, dirX, dirY, RW_BRANCH_BEAM_MAX_RANGE_WORLD);
          if (branchHit !== null) break;
        } else {
          const offset = (r % 2 === 0 ? 1 : -1) * Math.ceil(r / 2) * _BEAM_RETRY_OFFSET_RAD;
          const retryAngle = Math.atan2(dirY, dirX) + offset;
          const rdX = Math.cos(retryAngle);
          const rdY = Math.sin(retryAngle);
          branchHit = raycastToWallWithNormal(world, startX, startY, rdX, rdY, RW_BRANCH_BEAM_MAX_RANGE_WORLD);
          if (branchHit !== null) {
            chosenDirX = rdX;
            chosenDirY = rdY;
            break;
          }
        }
      }

      if (branchHit === null) {
        bb.isActiveFlag = 0;
        continue;
      }

      bb.startXWorld = hitX;
      bb.startYWorld = hitY;
      bb.dirXWorld = chosenDirX;
      bb.dirYWorld = chosenDirY;
      bb.currentLengthWorld = 0;
      bb.maxLengthWorld = Math.sqrt(
        (branchHit.xWorld - startX) * (branchHit.xWorld - startX) +
        (branchHit.yWorld - startY) * (branchHit.yWorld - startY),
      ) + RW_BRANCH_START_OFFSET_WORLD;
      bb.hasHitWall = 0;
      bb.isActiveFlag = 1;
      bb.isEnergizedFlag = 0;
      bb.energizeTicks = 0;
      bb.isRopeFlag = 0;
    }
  }
}

export function tickBranchGrow(bs: RadiantWebBeamState): boolean {
  bs.attackPhaseTicks++;
  let allDone = true;
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0) continue;
    if (bb.hasHitWall === 0) {
      bb.currentLengthWorld += RW_BRANCH_BEAM_GROW_SPEED_WORLD;
      if (bb.currentLengthWorld >= bb.maxLengthWorld) {
        bb.currentLengthWorld = bb.maxLengthWorld;
        bb.hasHitWall = 1;
      } else {
        allDone = false;
      }
    }
  }
  let anyActive = false;
  for (let i = 0; i < count; i++) {
    if (bs.branchBeams[i].isActiveFlag === 1) { anyActive = true; break; }
  }
  return !anyActive || allDone;
}

export function startEnergizePhase(bs: RadiantWebBeamState): void {
  bs.attackPhaseTicks = 0;
  bs.attackPhase = 2;
  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    bs.mainBeams[i].puffProgress = 1.0;
    bs.mainBeams[i].isActiveFlag = 0;
  }
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0) continue;
    bb.isEnergizedFlag = 1;
    bb.energizeTicks = RW_BRANCH_ENERGIZE_DELAY_TICKS;
  }
}

export function tickEnergizePhase(bs: RadiantWebBeamState): void {
  bs.attackPhaseTicks++;
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isEnergizedFlag === 0) continue;
    if (bb.energizeTicks > 0) bb.energizeTicks--;
  }
}

export function startRopeDecay(bs: RadiantWebBeamState): void {
  bs.attackPhaseTicks = 0;
  bs.attackPhase = 3;
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isEnergizedFlag === 0) continue;
    bb.isRopeFlag = 1;
    bb.isEnergizedFlag = 0;
    bb.ropeAnchorXWorld = bb.startXWorld;
    bb.ropeAnchorYWorld = bb.startYWorld;
    bb.ropeFreeEndXWorld = bb.startXWorld + bb.dirXWorld * bb.currentLengthWorld;
    bb.ropeFreeEndYWorld = bb.startYWorld + bb.dirYWorld * bb.currentLengthWorld;
    bb.ropeFreeEndVelXWorld = 0;
    bb.ropeFreeEndVelYWorld = 0;
    bb.ropeLengthWorld = bb.currentLengthWorld;
    bb.ropeLifetimeTicks = RW_BRANCH_ROPE_LIFETIME_TICKS;
    bb.ropeTotalLifetimeTicks = RW_BRANCH_ROPE_LIFETIME_TICKS;
  }
}

export function tickRopeDecay(bs: RadiantWebBeamState): boolean {
  bs.attackPhaseTicks++;
  let anyAlive = false;
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isRopeFlag === 0) continue;
    bb.ropeLifetimeTicks--;
    if (bb.ropeLifetimeTicks <= 0) {
      bb.isActiveFlag = 0;
      bb.isRopeFlag = 0;
      continue;
    }
    anyAlive = true;
    bb.ropeFreeEndVelYWorld += RW_BRANCH_ROPE_GRAVITY_WORLD;
    bb.ropeFreeEndVelXWorld *= RW_BRANCH_ROPE_DRAG;
    bb.ropeFreeEndVelYWorld *= RW_BRANCH_ROPE_DRAG;
    bb.ropeFreeEndXWorld += bb.ropeFreeEndVelXWorld;
    bb.ropeFreeEndYWorld += bb.ropeFreeEndVelYWorld;
    const dx = bb.ropeFreeEndXWorld - bb.ropeAnchorXWorld;
    const dy = bb.ropeFreeEndYWorld - bb.ropeAnchorYWorld;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > bb.ropeLengthWorld && dist > 0.01) {
      const scale = bb.ropeLengthWorld / dist;
      bb.ropeFreeEndXWorld = bb.ropeAnchorXWorld + dx * scale;
      bb.ropeFreeEndYWorld = bb.ropeAnchorYWorld + dy * scale;
      const nx = dx / dist;
      const ny = dy / dist;
      const dot = bb.ropeFreeEndVelXWorld * nx + bb.ropeFreeEndVelYWorld * ny;
      if (dot > 0) {
        bb.ropeFreeEndVelXWorld -= dot * nx;
        bb.ropeFreeEndVelYWorld -= dot * ny;
      }
    }
  }
  return !anyAlive;
}

export function resetBeamAttackState(bs: RadiantWebBeamState): void {
  for (let i = 0; i < RW_MAIN_BEAM_COUNT; i++) {
    const mb = bs.mainBeams[i];
    mb.isActiveFlag = 0;
    mb.hasHitWall = 0;
    mb.currentLengthWorld = 0;
    mb.puffProgress = 0;
  }
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    bb.isActiveFlag = 0;
    bb.isEnergizedFlag = 0;
    bb.isRopeFlag = 0;
    bb.hasHitWall = 0;
    bb.currentLengthWorld = 0;
    bb.energizeTicks = 0;
    bb.ropeLifetimeTicks = 0;
  }
  bs.attackPhaseTicks = 0;
  bs.attackPhase = 0;
  bs.branchPlayerIframeTicks = 0;
}

export function tickBranchPlayerCollision(bs: RadiantWebBeamState, world: WorldState): void {
  if (bs.branchPlayerIframeTicks > 0) {
    bs.branchPlayerIframeTicks--;
    return;
  }
  let player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag !== 1) {
    for (let i = 0; i < world.clusters.length; i++) {
      const c = world.clusters[i];
      if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) { player = c; break; }
    }
  }
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag !== 1) return;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const playerRadius = Math.max(player.halfWidthWorld, player.halfHeightWorld);
  const hitRadius = RW_BRANCH_HITBOX_HALF_WIDTH_WORLD + playerRadius;
  const hitRadiusSq = hitRadius * hitRadius;
  const count = RW_MAIN_BEAM_COUNT * RW_BRANCH_BEAMS_PER_MAIN;

  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isEnergizedFlag === 0 || bb.isRopeFlag === 1) continue;
    if (bb.energizeTicks > 0) continue;
    const endX = bb.startXWorld + bb.dirXWorld * bb.currentLengthWorld;
    const endY = bb.startYWorld + bb.dirYWorld * bb.currentLengthWorld;
    const closest = closestPointOnSegment(px, py, bb.startXWorld, bb.startYWorld, endX, endY);
    if (closest.distSq <= hitRadiusSq) {
      applyBranchDamage(player, bs, world, closest.xWorld, closest.yWorld);
      return;
    }
  }
  for (let i = 0; i < count; i++) {
    const bb = bs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isRopeFlag === 0) continue;
    const closest = closestPointOnSegment(
      px, py, bb.ropeAnchorXWorld, bb.ropeAnchorYWorld,
      bb.ropeFreeEndXWorld, bb.ropeFreeEndYWorld,
    );
    if (closest.distSq <= hitRadiusSq) {
      applyBranchDamage(player, bs, world, closest.xWorld, closest.yWorld);
      return;
    }
  }
}

function applyBranchDamage(
  player: { healthPoints: number; isAliveFlag: 0 | 1; entityId: number; positionXWorld: number; positionYWorld: number; velocityXWorld: number; velocityYWorld: number; isGroundedFlag: 0 | 1; invulnerabilityTicks: number; hurtTicks: number },
  bs: RadiantWebBeamState,
  world: WorldState,
  sourceXWorld: number,
  sourceYWorld: number,
): void {
  let playerDustCount = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.ownerEntityId[i] === player.entityId && world.isAliveFlag[i] === 1 && world.isTransientFlag[i] === 0) {
      playerDustCount++;
    }
  }
  const armor = Math.floor(playerDustCount / 4);
  const damage = Math.max(1, RW_BRANCH_DAMAGE - armor);
  applyPlayerDamageWithKnockback(player, damage, sourceXWorld, sourceYWorld);
  bs.branchPlayerIframeTicks = RW_BRANCH_IFRAMES_TICKS;
}
