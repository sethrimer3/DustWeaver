/**
 * Weave Combat System — activates bound dust according to the equipped Weave pattern.
 *
 * This module replaces the old per-element attack/block system with a Weave-driven
 * model. When a Weave is activated:
 *   1. Only dust particles bound to that Weave respond
 *   2. Particles move according to the Weave's pattern, not their dust type
 *   3. Dust type still governs visual appearance and elemental interactions
 *
 * Behavior modes:
 *   0 = passive orbit (dust type motion)
 *   1 = attack (legacy — used by enemies only)
 *   2 = block  (legacy — used by enemies only)
 *   3 = weave active (particle executing a Weave pattern)
 *   4 = returning (transitioning from weave back to passive)
 *
 * Weave patterns:
 *   - Aegis:   orbiting shield ring around player (sustained)
 *   - Bastion: directional wall in front of player (sustained)
 *   - Spire:   straight line shot in aimed direction (burst)
 */

import { WorldState } from '../world';
import {
  WeaveId,
  getWeaveDefinition,
  WEAVE_AEGIS,
  WEAVE_BASTION,
  WEAVE_SPIRE,
} from './weaveDefinition';
import { WEAVE_SLOT_PRIMARY, WEAVE_SLOT_SECONDARY } from './playerLoadout';

// ---- Constants --------------------------------------------------------------

/** Spring strength pulling weave-active particles toward their pattern positions. */
const WEAVE_SPRING_STRENGTH = 400.0;

/** Distance from owner center for Aegis orbit ring (world units). */
const AEGIS_ORBIT_DIST_WORLD = 8.0;
/** Aegis orbital angular velocity (radians per tick). */
const AEGIS_ORBIT_SPEED_RAD = 0.06;

/** Distance from owner center for Bastion wall (world units). */
const BASTION_WALL_DIST_WORLD = 7.5;
/** Spacing between Bastion wall particles (world units). */
const BASTION_SPACING_WORLD = 10.0 / 6.0;

/** Speed for returning particles (pulling back to orbit). */
const RETURN_SPRING_STRENGTH = 200.0;
/** Ticks for return transition. */
const RETURN_DURATION_TICKS = 20;

// ---- Aegis pattern (orbiting shield) ----------------------------------------

function applyAegisPattern(
  world: WorldState,
  playerEntityId: number,
  playerX: number,
  playerY: number,
  weaveSlot: number,
): void {
  const {
    isAliveFlag, ownerEntityId,
    positionXWorld, positionYWorld,
    forceX, forceY,
    behaviorMode, weaveSlotId, isTransientFlag,
    particleCount,
  } = world;

  // Count bound particles for this weave
  let total = 0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === playerEntityId
      && weaveSlotId[i] === weaveSlot && isTransientFlag[i] === 0) {
      total++;
    }
  }
  if (total === 0) return;

  let slotIdx = 0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;
    if (weaveSlotId[i] !== weaveSlot) continue;
    if (isTransientFlag[i] === 1) continue;

    behaviorMode[i] = 3; // weave active

    // Distribute evenly around the circle, rotating each tick
    const angleRad = (slotIdx / total) * Math.PI * 2.0 + world.tick * AEGIS_ORBIT_SPEED_RAD;
    const targetX = playerX + Math.cos(angleRad) * AEGIS_ORBIT_DIST_WORLD;
    const targetY = playerY + Math.sin(angleRad) * AEGIS_ORBIT_DIST_WORLD;

    const dx = targetX - positionXWorld[i];
    const dy = targetY - positionYWorld[i];
    forceX[i] += dx * WEAVE_SPRING_STRENGTH;
    forceY[i] += dy * WEAVE_SPRING_STRENGTH;

    slotIdx++;
  }
}

// ---- Bastion pattern (directional wall) -------------------------------------

function applyBastionPattern(
  world: WorldState,
  playerEntityId: number,
  playerX: number,
  playerY: number,
  dirX: number,
  dirY: number,
  weaveSlot: number,
): void {
  const {
    isAliveFlag, ownerEntityId,
    positionXWorld, positionYWorld,
    forceX, forceY,
    behaviorMode, weaveSlotId, isTransientFlag,
    particleCount,
  } = world;

  // Perpendicular to aim direction
  const perpX = -dirY;
  const perpY =  dirX;

  // Count bound particles
  let total = 0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === playerEntityId
      && weaveSlotId[i] === weaveSlot && isTransientFlag[i] === 0) {
      total++;
    }
  }
  if (total === 0) return;

  let slotIdx = 0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;
    if (weaveSlotId[i] !== weaveSlot) continue;
    if (isTransientFlag[i] === 1) continue;

    behaviorMode[i] = 3; // weave active

    // Straight wall perpendicular to aim direction
    const halfCount = (total - 1) * 0.5;
    const slotOffset = (slotIdx - halfCount) * BASTION_SPACING_WORLD;

    const targetX = playerX + dirX * BASTION_WALL_DIST_WORLD + perpX * slotOffset;
    const targetY = playerY + dirY * BASTION_WALL_DIST_WORLD + perpY * slotOffset;

    const dx = targetX - positionXWorld[i];
    const dy = targetY - positionYWorld[i];
    forceX[i] += dx * WEAVE_SPRING_STRENGTH;
    forceY[i] += dy * WEAVE_SPRING_STRENGTH;

    slotIdx++;
  }
}

// ---- Spire pattern (straight line shot) -------------------------------------

function triggerSpireLaunch(
  world: WorldState,
  playerEntityId: number,
  dirX: number,
  dirY: number,
  weaveSlot: number,
): void {
  const {
    isAliveFlag, ownerEntityId,
    velocityXWorld, velocityYWorld,
    behaviorMode, weaveSlotId, attackModeTicksLeft, isTransientFlag,
    particleCount,
  } = world;

  const weaveDef = getWeaveDefinition(WEAVE_SPIRE);
  const speed = weaveDef.deploySpeedWorld;
  const halfSpread = weaveDef.spreadRad;
  const duration = weaveDef.durationTicks;

  // Count bound particles
  let total = 0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === playerEntityId
      && weaveSlotId[i] === weaveSlot && isTransientFlag[i] === 0
      && behaviorMode[i] === 0) {
      total++;
    }
  }
  if (total === 0) return;

  const baseAngleRad = Math.atan2(dirY, dirX);
  let slotIdx = 0;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;
    if (weaveSlotId[i] !== weaveSlot) continue;
    if (isTransientFlag[i] === 1) continue;
    if (behaviorMode[i] !== 0) continue; // skip particles already in flight

    // Distribute within the narrow spread
    let angleOffset: number;
    if (total === 1) {
      angleOffset = 0;
    } else {
      angleOffset = -halfSpread + (slotIdx / (total - 1)) * halfSpread * 2.0;
    }

    const launchAngle = baseAngleRad + angleOffset;
    velocityXWorld[i] = Math.cos(launchAngle) * speed;
    velocityYWorld[i] = Math.sin(launchAngle) * speed;

    behaviorMode[i] = 3; // weave active
    attackModeTicksLeft[i] = duration;

    slotIdx++;
  }
}

// ---- Weave activation tick-down (for burst weaves) --------------------------

/**
 * Ticks down weave-active particles that have a finite duration.
 * When their time runs out, transitions them to returning state.
 */
function tickWeaveActiveParticles(world: WorldState): void {
  const { isAliveFlag, behaviorMode, attackModeTicksLeft, particleCount } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (behaviorMode[i] !== 3) continue;

    // Only tick down burst-type weave particles (duration > 0 at launch)
    if (attackModeTicksLeft[i] > 0) {
      attackModeTicksLeft[i] -= 1.0;
      if (attackModeTicksLeft[i] <= 0) {
        // Transition to returning
        behaviorMode[i] = 4;
        attackModeTicksLeft[i] = RETURN_DURATION_TICKS;
      }
    }
    // Sustained weaves (attackModeTicksLeft === 0) stay in mode 3 until released
  }
}

/**
 * Applies gentle return-to-orbit forces for particles in returning state (mode 4).
 * After RETURN_DURATION_TICKS, reverts to passive orbit (mode 0).
 */
function tickReturningParticles(world: WorldState): void {
  const {
    isAliveFlag, ownerEntityId, clusters,
    positionXWorld, positionYWorld,
    forceX, forceY,
    anchorAngleRad, anchorRadiusWorld,
    behaviorMode, attackModeTicksLeft,
    particleCount,
  } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (behaviorMode[i] !== 4) continue;

    attackModeTicksLeft[i] -= 1.0;
    if (attackModeTicksLeft[i] <= 0) {
      behaviorMode[i] = 0; // back to passive orbit
      attackModeTicksLeft[i] = 0;
      continue;
    }

    // Pull toward anchor position on owner
    const ownerId = ownerEntityId[i];
    let ownerX = 0;
    let ownerY = 0;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusters[ci].entityId === ownerId) {
        ownerX = clusters[ci].positionXWorld;
        ownerY = clusters[ci].positionYWorld;
        break;
      }
    }

    const anchorX = ownerX + Math.cos(anchorAngleRad[i]) * anchorRadiusWorld[i];
    const anchorY = ownerY + Math.sin(anchorAngleRad[i]) * anchorRadiusWorld[i];

    const dx = anchorX - positionXWorld[i];
    const dy = anchorY - positionYWorld[i];
    forceX[i] += dx * RETURN_SPRING_STRENGTH;
    forceY[i] += dy * RETURN_SPRING_STRENGTH;
  }
}

// ---- Release sustained weave ------------------------------------------------

/**
 * Releases all particles in a sustained weave (Aegis/Bastion) back to passive.
 * Called when the player releases the input for a sustained weave.
 */
function releaseSustainedWeave(
  world: WorldState,
  playerEntityId: number,
  weaveSlot: number,
): void {
  const { isAliveFlag, ownerEntityId, behaviorMode, weaveSlotId, attackModeTicksLeft, particleCount } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;
    if (weaveSlotId[i] !== weaveSlot) continue;
    if (behaviorMode[i] !== 3) continue;

    // Transition to returning
    behaviorMode[i] = 4;
    attackModeTicksLeft[i] = RETURN_DURATION_TICKS;
  }
}

// ---- Main entry point -------------------------------------------------------

/**
 * Returns true if the given weave is a sustained (hold) type.
 * Sustained weaves have durationTicks === 0.
 */
function isSustainedWeave(weaveId: WeaveId): boolean {
  return getWeaveDefinition(weaveId).durationTicks === 0;
}

/**
 * Applies weave combat forces for the player each tick.
 *
 * This is called from tick.ts in place of the old player attack/block logic.
 * Enemy combat still uses the legacy system.
 */
export function applyPlayerWeaveCombat(world: WorldState): void {
  // Find the player cluster
  let playerEntityId = -1;
  let playerX = 0;
  let playerY = 0;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].isPlayerFlag === 1 && world.clusters[ci].isAliveFlag === 1) {
      playerEntityId = world.clusters[ci].entityId;
      playerX = world.clusters[ci].positionXWorld;
      playerY = world.clusters[ci].positionYWorld;
      break;
    }
  }
  if (playerEntityId === -1) return;

  // ── Primary Weave ─────────────────────────────────────────────────────────
  if (world.playerPrimaryWeaveTriggeredFlag === 1) {
    world.playerPrimaryWeaveTriggeredFlag = 0;
    const weaveId = world.playerPrimaryWeaveId;
    if (isSustainedWeave(weaveId)) {
      world.isPlayerPrimaryWeaveActiveFlag = 1;
    } else {
      // Burst weave — trigger once
      applyBurstWeave(world, playerEntityId, weaveId,
        world.playerWeaveAimDirXWorld, world.playerWeaveAimDirYWorld,
        WEAVE_SLOT_PRIMARY);
    }
  }

  if (world.isPlayerPrimaryWeaveActiveFlag === 1) {
    const weaveId = world.playerPrimaryWeaveId;
    applySustainedWeave(world, playerEntityId, playerX, playerY, weaveId,
      world.playerWeaveAimDirXWorld, world.playerWeaveAimDirYWorld,
      WEAVE_SLOT_PRIMARY);
  }

  if (world.playerPrimaryWeaveEndFlag === 1) {
    world.playerPrimaryWeaveEndFlag = 0;
    world.isPlayerPrimaryWeaveActiveFlag = 0;
    releaseSustainedWeave(world, playerEntityId, WEAVE_SLOT_PRIMARY);
  }

  // ── Secondary Weave ───────────────────────────────────────────────────────
  if (world.playerSecondaryWeaveTriggeredFlag === 1) {
    world.playerSecondaryWeaveTriggeredFlag = 0;
    const weaveId = world.playerSecondaryWeaveId;
    if (isSustainedWeave(weaveId)) {
      world.isPlayerSecondaryWeaveActiveFlag = 1;
    } else {
      applyBurstWeave(world, playerEntityId, weaveId,
        world.playerWeaveAimDirXWorld, world.playerWeaveAimDirYWorld,
        WEAVE_SLOT_SECONDARY);
    }
  }

  if (world.isPlayerSecondaryWeaveActiveFlag === 1) {
    const weaveId = world.playerSecondaryWeaveId;
    applySustainedWeave(world, playerEntityId, playerX, playerY, weaveId,
      world.playerWeaveAimDirXWorld, world.playerWeaveAimDirYWorld,
      WEAVE_SLOT_SECONDARY);
  }

  if (world.playerSecondaryWeaveEndFlag === 1) {
    world.playerSecondaryWeaveEndFlag = 0;
    world.isPlayerSecondaryWeaveActiveFlag = 0;
    releaseSustainedWeave(world, playerEntityId, WEAVE_SLOT_SECONDARY);
  }

  // ── Tick-down and return transitions ───────────────────────────────────────
  tickWeaveActiveParticles(world);
  tickReturningParticles(world);
}

// ---- Helpers ----------------------------------------------------------------

function applySustainedWeave(
  world: WorldState,
  playerEntityId: number,
  playerX: number,
  playerY: number,
  weaveId: WeaveId,
  aimDirX: number,
  aimDirY: number,
  weaveSlot: number,
): void {
  switch (weaveId) {
    case WEAVE_AEGIS:
      applyAegisPattern(world, playerEntityId, playerX, playerY, weaveSlot);
      break;
    case WEAVE_BASTION:
      applyBastionPattern(world, playerEntityId, playerX, playerY, aimDirX, aimDirY, weaveSlot);
      break;
    default:
      // Fallback for any sustained weave that doesn't have a specific pattern
      applyAegisPattern(world, playerEntityId, playerX, playerY, weaveSlot);
      break;
  }
}

function applyBurstWeave(
  world: WorldState,
  playerEntityId: number,
  weaveId: WeaveId,
  aimDirX: number,
  aimDirY: number,
  weaveSlot: number,
): void {
  switch (weaveId) {
    case WEAVE_SPIRE:
      triggerSpireLaunch(world, playerEntityId, aimDirX, aimDirY, weaveSlot);
      break;
    default:
      // Fallback for burst weaves without specific pattern — use Spire
      triggerSpireLaunch(world, playerEntityId, aimDirX, aimDirY, weaveSlot);
      break;
  }
}
