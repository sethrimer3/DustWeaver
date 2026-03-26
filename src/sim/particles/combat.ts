/**
 * Combat forces — attack launch and block shield positioning.
 *
 * Attack (behaviorMode = 1):
 *   Called once when playerAttackTriggeredFlag is set.  Gives each player
 *   particle a large velocity impulse in the attack direction, with per-element
 *   spread and speed characteristics.  Sets attackModeTicksLeft so particles
 *   stay in attack mode long enough to reach the enemy, then return to orbit.
 *
 * Block (behaviorMode = 2):
 *   Called every tick while isPlayerBlockingFlag is set.  Applies strong
 *   spring forces toward per-element shield-formation target positions instead
 *   of the normal anchor targets, forming defensive walls, circles, etc.
 */

import { WorldState } from '../world';
import { ParticleKind, PARTICLE_KIND_COUNT } from './kinds';

// ---- Constants ----------------------------------------------------------

/** Distance from owner center where shield particles form. */
const SHIELD_DIST_WORLD   = 50.0;
/** Spacing between shield particles in a line/arc formation. */
const SHIELD_SPACING_WORLD = 9.0;
/** Spring strength pulling block particles toward their shield position. */
const SHIELD_SPRING_STRENGTH = 400.0;

/** Ticks a particle stays in attack-launch mode before returning to orbit. */
const ATTACK_DURATION_TICKS = 45;

// ---- Pre-allocated scratch buffers (no per-tick allocations) ------------
// Per-kind counters reused across triggerAttackLaunch and applyBlockForces
const _kindParticleIndex   = new Uint16Array(PARTICLE_KIND_COUNT);
const _kindTotal           = new Uint16Array(PARTICLE_KIND_COUNT);
const _blockKindCount      = new Uint16Array(PARTICLE_KIND_COUNT);
const _blockKindSlotIdx    = new Uint16Array(PARTICLE_KIND_COUNT);

// ---- Attack launch -------------------------------------------------------

/** Returns the per-element speed and spread parameters for the attack launch. */
function getAttackParams(kind: number): { speedWorld: number; halfSpreadRad: number; loopStrength: number } {
  switch (kind as ParticleKind) {
    case ParticleKind.Physical:  return { speedWorld: 420, halfSpreadRad: 0.10, loopStrength: 0.0  };
    case ParticleKind.Fire:      return { speedWorld: 220, halfSpreadRad: 0.40, loopStrength: 1.0  }; // fire loops
    case ParticleKind.Ice:       return { speedWorld: 320, halfSpreadRad: 1.05, loopStrength: 0.0  }; // wide arc ~120° total
    case ParticleKind.Lightning: return { speedWorld: 750, halfSpreadRad: 0.08, loopStrength: 0.0  }; // tight streak
    case ParticleKind.Poison:    return { speedWorld: 90,  halfSpreadRad: 1.57, loopStrength: 0.0  }; // cloud burst (~180°)
    case ParticleKind.Arcane:    return { speedWorld: 260, halfSpreadRad: 0.52, loopStrength: 0.5  }; // spiral
    case ParticleKind.Wind:      return { speedWorld: 380, halfSpreadRad: 0.52, loopStrength: 0.0  }; // cone gust ~30°
    case ParticleKind.Holy:      return { speedWorld: 210, halfSpreadRad: 3.14, loopStrength: 0.0  }; // full radial
    case ParticleKind.Shadow:    return { speedWorld: 520, halfSpreadRad: 0.26, loopStrength: 0.0  }; // dark lunge
    case ParticleKind.Metal:     return { speedWorld: 180, halfSpreadRad: 0.17, loopStrength: 0.0  }; // heavy beam
    case ParticleKind.Earth:     return { speedWorld: 160, halfSpreadRad: 0.35, loopStrength: 0.0  }; // rock spread
    case ParticleKind.Nature:    return { speedWorld: 160, halfSpreadRad: 0.78, loopStrength: 0.3  }; // curving vines
    case ParticleKind.Crystal:   return { speedWorld: 380, halfSpreadRad: 1.57, loopStrength: 0.0  }; // wide shards ~180° total
    case ParticleKind.Void:      return { speedWorld: 270, halfSpreadRad: 0.70, loopStrength: -0.5 }; // inward spiral
    case ParticleKind.Water:     return { speedWorld: 240, halfSpreadRad: 0.65, loopStrength: 0.3  }; // flowing burst
    case ParticleKind.Lava:      return { speedWorld: 120, halfSpreadRad: 0.30, loopStrength: 0.0  }; // slow heavy lob
    case ParticleKind.Stone:     return { speedWorld: 300, halfSpreadRad: 0.50, loopStrength: 0.0  }; // shard scatter
    default:                     return { speedWorld: 200, halfSpreadRad: 0.50, loopStrength: 0.0  };
  }
}

/** Returns how many ticks the attack launch lasts per element. */
function getAttackDurationTicks(kind: number): number {
  switch (kind as ParticleKind) {
    case ParticleKind.Lightning: return 18;
    case ParticleKind.Fire:      return 65;
    case ParticleKind.Poison:    return 90;
    case ParticleKind.Metal:     return 70;
    case ParticleKind.Earth:     return 75;
    case ParticleKind.Lava:      return 90;   // lava lingers long
    case ParticleKind.Stone:     return 40;   // stone shard flies then falls
    default:                     return ATTACK_DURATION_TICKS;
  }
}

/**
 * Triggers an attack launch on all alive player particles.
 * Called once per attack trigger (playerAttackTriggeredFlag).
 */
export function triggerAttackLaunch(world: WorldState): void {
  const {
    isAliveFlag, ownerEntityId, kindBuffer, clusters,
    velocityXWorld, velocityYWorld,
    behaviorMode, attackModeTicksLeft, isTransientFlag,
    playerAttackDirXWorld: adx, playerAttackDirYWorld: ady,
  } = world;

  // Find the player cluster entity ID
  let playerEntityId = -1;
  for (let ci = 0; ci < clusters.length; ci++) {
    if (clusters[ci].isPlayerFlag === 1 && clusters[ci].isAliveFlag === 1) {
      playerEntityId = clusters[ci].entityId;
      break;
    }
  }
  if (playerEntityId === -1) return;

  // Count per-kind particles to spread them within their spread arc
  // (exclude transient particles — shards and trail fire)
  _kindParticleIndex.fill(0);
  _kindTotal.fill(0);
  for (let i = 0; i < world.particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === playerEntityId && isTransientFlag[i] === 0) {
      const k = kindBuffer[i];
      if (k < PARTICLE_KIND_COUNT) _kindTotal[k]++;
    }
  }

  for (let i = 0; i < world.particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;
    if (isTransientFlag[i] === 1) continue;   // skip transient shards / trail fire
    if (behaviorMode[i] !== 0) continue;      // already mid-flight — wait for orbit reset

    const kind = kindBuffer[i];
    const { speedWorld, halfSpreadRad, loopStrength } = getAttackParams(kind);


    const total = _kindTotal[kind] > 0 ? _kindTotal[kind] : 1;
    const idx   = _kindParticleIndex[kind]++;

    // Distribute particles evenly within ±halfSpreadRad of attack direction
    let angleOffsetRad: number;
    if (total === 1) {
      angleOffsetRad = 0.0;
    } else {
      // Holy: full-circle radial burst — spread 0 to 2π
      if (kind === ParticleKind.Holy) {
        angleOffsetRad = (idx / total) * Math.PI * 2.0;
      } else {
        angleOffsetRad = -halfSpreadRad + (idx / (total - 1)) * halfSpreadRad * 2.0;
      }
    }

    const baseAngleRad = Math.atan2(ady, adx);
    const launchAngleRad = baseAngleRad + angleOffsetRad;

    velocityXWorld[i] = Math.cos(launchAngleRad) * speedWorld;
    velocityYWorld[i] = Math.sin(launchAngleRad) * speedWorld;

    // Fire loops: add a sinusoidal perpendicular component that changes per tick.
    // We add it as an initial perpendicular kick here; element forces provide the rest.
    if (loopStrength !== 0.0) {
      const perpX = -Math.sin(launchAngleRad);
      const perpY =  Math.cos(launchAngleRad);
      const kick = loopStrength * speedWorld * 0.25 * ((idx % 2 === 0) ? 1.0 : -1.0);
      velocityXWorld[i] += perpX * kick;
      velocityYWorld[i] += perpY * kick;
    }

    behaviorMode[i]        = 1;
    attackModeTicksLeft[i] = getAttackDurationTicks(kind);
  }
}

// ---- Per-tick attack continuation ----------------------------------------

/**
 * Each tick: tick down attackModeTicksLeft; return particles to orbit when expired.
 * Also applies per-element special forces during attack mode (fire looping, etc.)
 */
export function tickAttackMode(world: WorldState): void {
  const {
    isAliveFlag, ownerEntityId, kindBuffer, clusters,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    behaviorMode, attackModeTicksLeft,
    particleCount,
  } = world;

  let playerEntityId = -1;
  for (let ci = 0; ci < clusters.length; ci++) {
    if (clusters[ci].isPlayerFlag === 1 && clusters[ci].isAliveFlag === 1) {
      playerEntityId = clusters[ci].entityId;
      break;
    }
  }

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (behaviorMode[i] !== 1) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;

    attackModeTicksLeft[i] -= 1.0;
    if (attackModeTicksLeft[i] <= 0) {
      behaviorMode[i] = 0;
      attackModeTicksLeft[i] = 0;
      continue;
    }

    const kind = kindBuffer[i];

    // Fire: apply curl-like looping force perpendicular to velocity
    if (kind === ParticleKind.Fire) {
      const speed = Math.sqrt(velocityXWorld[i] ** 2 + velocityYWorld[i] ** 2);
      if (speed > 1.0) {
        const invSpeed = 1.0 / speed;
        const perpX = -velocityYWorld[i] * invSpeed;
        const perpY =  velocityXWorld[i] * invSpeed;
        const loopSign = (i % 2 === 0) ? 1.0 : -1.0;
        forceX[i] += perpX * 120.0 * loopSign;
        forceY[i] += perpY * 120.0 * loopSign;
      }
    }

    // Arcane / Nature / Void: spiral force component
    if (kind === ParticleKind.Arcane || kind === ParticleKind.Nature || kind === ParticleKind.Void) {
      const speed = Math.sqrt(velocityXWorld[i] ** 2 + velocityYWorld[i] ** 2);
      if (speed > 1.0) {
        const invSpeed = 1.0 / speed;
        const perpX = -velocityYWorld[i] * invSpeed;
        const perpY =  velocityXWorld[i] * invSpeed;
        const spiralDir = (kind === ParticleKind.Void) ? -1.0 : 1.0;
        forceX[i] += perpX * 60.0 * spiralDir;
        forceY[i] += perpY * 60.0 * spiralDir;
      }
    }
  }
}

// ---- Block shield positioning --------------------------------------------

/** Returns the target shield position for a particle in block mode. */
function computeShieldTarget(
  ownerXWorld: number,
  ownerYWorld: number,
  blockDirXWorld: number,
  blockDirYWorld: number,
  particleIndex: number,
  totalParticles: number,
  kind: number,
): { targetXWorld: number; targetYWorld: number } {
  // Perpendicular to block direction
  const perpX = -blockDirYWorld;
  const perpY =  blockDirXWorld;

  // Half-width in particle slots
  const halfCount = (totalParticles - 1) * 0.5;
  const slotOffset = (particleIndex - halfCount) * SHIELD_SPACING_WORLD;

  switch (kind as ParticleKind) {
    case ParticleKind.Physical: {
      // Semicircular arc in front — distribute over ±45° around block direction
      const arcAngle = Math.atan2(blockDirYWorld, blockDirXWorld);
      const spread = Math.PI * 0.5; // ±45°
      const t = totalParticles > 1 ? (particleIndex / (totalParticles - 1)) : 0.5;
      const angle = arcAngle - spread * 0.5 + t * spread;
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * SHIELD_DIST_WORLD,
        targetYWorld: ownerYWorld + Math.sin(angle) * SHIELD_DIST_WORLD,
      };
    }
    case ParticleKind.Fire: {
      // Circle around owner (ignores block direction — fire swirls protectively)
      const angle = (particleIndex / totalParticles) * Math.PI * 2.0;
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * SHIELD_DIST_WORLD,
        targetYWorld: ownerYWorld + Math.sin(angle) * SHIELD_DIST_WORLD,
      };
    }
    case ParticleKind.Ice:
    case ParticleKind.Metal: {
      // Straight wall perpendicular to block direction
      return {
        targetXWorld: ownerXWorld + blockDirXWorld * SHIELD_DIST_WORLD + perpX * slotOffset,
        targetYWorld: ownerYWorld + blockDirYWorld * SHIELD_DIST_WORLD + perpY * slotOffset,
      };
    }
    case ParticleKind.Crystal: {
      // Hexagonal-pattern crystalline wall — two offset rows
      const row = particleIndex % 2;
      const col = Math.floor(particleIndex / 2);
      const colCount = Math.ceil(totalParticles / 2);
      const halfCol = (colCount - 1) * 0.5;
      const xOff = (col - halfCol) * SHIELD_SPACING_WORLD;
      const rowOff = row === 0 ? 0.0 : SHIELD_SPACING_WORLD * 0.5;
      const depthOff = row === 0 ? SHIELD_DIST_WORLD : SHIELD_DIST_WORLD + SHIELD_SPACING_WORLD;
      return {
        targetXWorld: ownerXWorld + blockDirXWorld * depthOff + perpX * (xOff + rowOff),
        targetYWorld: ownerYWorld + blockDirYWorld * depthOff + perpY * (xOff + rowOff),
      };
    }
    case ParticleKind.Lightning: {
      // Two concentric rings — odd/even particles on inner/outer ring
      const ringRadius = (particleIndex % 2 === 0) ? SHIELD_DIST_WORLD * 0.7 : SHIELD_DIST_WORLD;
      const angle = Math.atan2(blockDirYWorld, blockDirXWorld)
        + (particleIndex / totalParticles) * Math.PI * 2.0;
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * ringRadius,
        targetYWorld: ownerYWorld + Math.sin(angle) * ringRadius,
      };
    }
    case ParticleKind.Holy: {
      // Wide hemisphere — spread over front 180°
      const arcAngle = Math.atan2(blockDirYWorld, blockDirXWorld);
      const t = totalParticles > 1 ? (particleIndex / (totalParticles - 1)) : 0.5;
      const angle = arcAngle - Math.PI * 0.5 + t * Math.PI;
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * SHIELD_DIST_WORLD,
        targetYWorld: ownerYWorld + Math.sin(angle) * SHIELD_DIST_WORLD,
      };
    }
    case ParticleKind.Shadow: {
      // Dark curtain in block direction (spread slightly outward)
      const spread = Math.PI * 0.6;
      const arcAngle = Math.atan2(blockDirYWorld, blockDirXWorld);
      const t = totalParticles > 1 ? (particleIndex / (totalParticles - 1)) : 0.5;
      const angle = arcAngle - spread * 0.5 + t * spread;
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * SHIELD_DIST_WORLD,
        targetYWorld: ownerYWorld + Math.sin(angle) * SHIELD_DIST_WORLD,
      };
    }
    case ParticleKind.Earth: {
      // Thick clump — cluster in block direction with tight packing
      const t = totalParticles > 1 ? (particleIndex / (totalParticles - 1)) : 0.5;
      const offX = perpX * slotOffset * 0.5;
      const offY = perpY * slotOffset * 0.5;
      const depthMod = SHIELD_DIST_WORLD * (0.85 + 0.3 * (t < 0.5 ? t : 1.0 - t));
      return {
        targetXWorld: ownerXWorld + blockDirXWorld * depthMod + offX,
        targetYWorld: ownerYWorld + blockDirYWorld * depthMod + offY,
      };
    }
    case ParticleKind.Void: {
      // Ring formation — particles orbit in a ring in front
      const angle = Math.atan2(blockDirYWorld, blockDirXWorld)
        + (particleIndex / totalParticles) * Math.PI * 1.5 - Math.PI * 0.25;
      return {
        targetXWorld: ownerXWorld + blockDirXWorld * SHIELD_DIST_WORLD * 0.5 + Math.cos(angle) * SHIELD_DIST_WORLD * 0.5,
        targetYWorld: ownerYWorld + blockDirYWorld * SHIELD_DIST_WORLD * 0.5 + Math.sin(angle) * SHIELD_DIST_WORLD * 0.5,
      };
    }
    case ParticleKind.Arcane: {
      // Spiral formation — Fibonacci-like spiral offset in block direction
      const spiralAngle = (particleIndex / totalParticles) * Math.PI * 4.0
        + Math.atan2(blockDirYWorld, blockDirXWorld);
      const spiralR = SHIELD_DIST_WORLD * (0.3 + 0.7 * (particleIndex / totalParticles));
      return {
        targetXWorld: ownerXWorld + Math.cos(spiralAngle) * spiralR,
        targetYWorld: ownerYWorld + Math.sin(spiralAngle) * spiralR,
      };
    }
    case ParticleKind.Wind: {
      // Cone / vortex in front — wide spread in block direction
      const arcAngle = Math.atan2(blockDirYWorld, blockDirXWorld);
      const t = totalParticles > 1 ? (particleIndex / (totalParticles - 1)) : 0.5;
      const angle = arcAngle - Math.PI * 0.35 + t * Math.PI * 0.7;
      const r = SHIELD_DIST_WORLD * (0.5 + 0.5 * Math.abs(t - 0.5) * 2.0);
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * r,
        targetYWorld: ownerYWorld + Math.sin(angle) * r,
      };
    }
    case ParticleKind.Poison: {
      // Expanding cloud — spread widely in all directions biased toward block dir
      const angle = Math.atan2(blockDirYWorld, blockDirXWorld)
        + (particleIndex / totalParticles) * Math.PI * 2.0;
      const r = SHIELD_DIST_WORLD * (0.6 + 0.4 * (particleIndex % 3) / 2.0);
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * r,
        targetYWorld: ownerYWorld + Math.sin(angle) * r,
      };
    }
    case ParticleKind.Nature: {
      // Branching — staggered arcs like branches
      const branch = particleIndex % 3;
      const branchAngle = Math.atan2(blockDirYWorld, blockDirXWorld)
        + (branch - 1) * Math.PI * 0.3;
      const depth = SHIELD_DIST_WORLD * (0.5 + 0.5 * (Math.floor(particleIndex / 3) / Math.max(1, Math.floor(totalParticles / 3))));
      return {
        targetXWorld: ownerXWorld + Math.cos(branchAngle) * depth,
        targetYWorld: ownerYWorld + Math.sin(branchAngle) * depth,
      };
    }
    case ParticleKind.Lava: {
      // Lava shield: loose circular formation — molten ring around the owner
      const angle = (particleIndex / totalParticles) * Math.PI * 2.0
        + Math.atan2(blockDirYWorld, blockDirXWorld);
      return {
        targetXWorld: ownerXWorld + Math.cos(angle) * SHIELD_DIST_WORLD * 0.85,
        targetYWorld: ownerYWorld + Math.sin(angle) * SHIELD_DIST_WORLD * 0.85,
      };
    }
    case ParticleKind.Stone: {
      // Stone shield: dense straight wall (like Ice/Metal)
      return {
        targetXWorld: ownerXWorld + blockDirXWorld * SHIELD_DIST_WORLD + perpX * slotOffset,
        targetYWorld: ownerYWorld + blockDirYWorld * SHIELD_DIST_WORLD + perpY * slotOffset,
      };
    }
    default: {
      // Generic wall (fallback)
      return {
        targetXWorld: ownerXWorld + blockDirXWorld * SHIELD_DIST_WORLD + perpX * slotOffset,
        targetYWorld: ownerYWorld + blockDirYWorld * SHIELD_DIST_WORLD + perpY * slotOffset,
      };
    }
  }
}

/**
 * Applies block shield forces to all player particles each tick while blocking.
 * Particles switch to behaviorMode=2 and are spring-pulled toward their shield targets.
 */
export function applyBlockForces(world: WorldState): void {
  const {
    isAliveFlag, ownerEntityId, kindBuffer, clusters,
    positionXWorld, positionYWorld,
    forceX, forceY,
    behaviorMode, isTransientFlag,
    playerBlockDirXWorld, playerBlockDirYWorld,
    isPlayerBlockingFlag,
    particleCount,
  } = world;

  if (isPlayerBlockingFlag === 0) {
    // Blocking just ended — release all block-mode particles back to orbit
    for (let i = 0; i < particleCount; i++) {
      if (behaviorMode[i] === 2) behaviorMode[i] = 0;
    }
    return;
  }

  // Find player cluster
  let playerEntityId = -1;
  let playerX = 0.0;
  let playerY = 0.0;
  for (let ci = 0; ci < clusters.length; ci++) {
    if (clusters[ci].isPlayerFlag === 1 && clusters[ci].isAliveFlag === 1) {
      playerEntityId = clusters[ci].entityId;
      playerX = clusters[ci].positionXWorld;
      playerY = clusters[ci].positionYWorld;
      break;
    }
  }
  if (playerEntityId === -1) return;

  // Count alive player (non-transient) particles per kind for slot indices
  _blockKindCount.fill(0);
  _blockKindSlotIdx.fill(0);
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === playerEntityId && isTransientFlag[i] === 0) {
      const k = kindBuffer[i];
      if (k < PARTICLE_KIND_COUNT) _blockKindCount[k]++;
    }
  }

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== playerEntityId) continue;
    if (isTransientFlag[i] === 1) continue;   // shards and trail fire stay in attack mode

    behaviorMode[i] = 2;

    const kind  = kindBuffer[i];
    const total = _blockKindCount[kind] > 0 ? _blockKindCount[kind] : 1;
    const slot  = _blockKindSlotIdx[kind]++;

    const { targetXWorld, targetYWorld } = computeShieldTarget(
      playerX, playerY,
      playerBlockDirXWorld, playerBlockDirYWorld,
      slot, total, kind,
    );

    // Strong spring toward shield position (overrides normal binding target)
    const dsx = targetXWorld - positionXWorld[i];
    const dsy = targetYWorld - positionYWorld[i];
    forceX[i] += dsx * SHIELD_SPRING_STRENGTH;
    forceY[i] += dsy * SHIELD_SPRING_STRENGTH;
  }
}

/**
 * Main entry point called from tick.ts.
 * Handles attack trigger, attack mode tick-down, and block shield forces.
 */
export function applyCombatForces(world: WorldState): void {
  // ---- Attack trigger (one-shot) -----------------------------------------
  if (world.playerAttackTriggeredFlag === 1) {
    triggerAttackLaunch(world);
    world.playerAttackTriggeredFlag = 0;
  }

  // ---- Per-tick attack mode forces (fire loops, spirals, etc.) -----------
  tickAttackMode(world);

  // ---- Block shield forces (continuous while blocking) -------------------
  applyBlockForces(world);
}
