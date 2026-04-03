/**
 * Enemy combat forces — enemy attack launch and enemy block shield positioning.
 *
 * Extracted from combat.ts; see that file for the orchestrator.
 */

import { WorldState } from '../world';
import { PARTICLE_KIND_COUNT, ParticleKind } from './kinds';
import {
  getAttackParams,
  getAttackDurationTicks,
  computeShieldTarget,
  SHIELD_DIST_WORLD,
  SHIELD_SPRING_STRENGTH,
} from './playerCombat';

// ---- Pre-allocated scratch buffers (no per-tick allocations) ------------
// Per-kind counters reused for enemy attack launch (same purpose as player ones)
const _enemyKindIndex = new Uint16Array(PARTICLE_KIND_COUNT);
const _enemyKindTotal = new Uint16Array(PARTICLE_KIND_COUNT);

// Per-kind counters reused for enemy block forces
const _eBlockKindCount   = new Uint16Array(PARTICLE_KIND_COUNT);
const _eBlockKindSlotIdx = new Uint16Array(PARTICLE_KIND_COUNT);

// ---- Enemy attack launch --------------------------------------------------

/**
 * Launches all alive, orbit-mode particles belonging to the given enemy cluster.
 * Works identically to triggerAttackLaunch but targets the player cluster position.
 */
export function triggerEnemyAttackLaunch(
  world: WorldState,
  enemyEntityId: number,
  attackDirX: number,
  attackDirY: number,
): void {
  const {
    isAliveFlag, ownerEntityId, kindBuffer,
    velocityXWorld, velocityYWorld,
    behaviorMode, attackModeTicksLeft, isTransientFlag,
    particleCount,
  } = world;

  _enemyKindIndex.fill(0);
  _enemyKindTotal.fill(0);
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === enemyEntityId && isTransientFlag[i] === 0) {
      const k = kindBuffer[i];
      if (k < PARTICLE_KIND_COUNT) _enemyKindTotal[k]++;
    }
  }

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== enemyEntityId) continue;
    if (isTransientFlag[i] === 1) continue;
    if (behaviorMode[i] !== 0) continue;

    const kind = kindBuffer[i];
    const { speedWorld, halfSpreadRad, loopStrength } = getAttackParams(kind);

    const total = _enemyKindTotal[kind] > 0 ? _enemyKindTotal[kind] : 1;
    const idx   = _enemyKindIndex[kind]++;

    let angleOffsetRad: number;
    if (total === 1) {
      angleOffsetRad = 0.0;
    } else {
      if (kind === ParticleKind.Holy) {
        angleOffsetRad = (idx / total) * Math.PI * 2.0;
      } else {
        angleOffsetRad = -halfSpreadRad + (idx / (total - 1)) * halfSpreadRad * 2.0;
      }
    }

    const baseAngleRad = Math.atan2(attackDirY, attackDirX);
    const launchAngleRad = baseAngleRad + angleOffsetRad;

    velocityXWorld[i] = Math.cos(launchAngleRad) * speedWorld;
    velocityYWorld[i] = Math.sin(launchAngleRad) * speedWorld;

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

/**
 * Applies block shield forces to all particles of blocking enemy clusters.
 * Mirror of applyBlockForces but reads the block state from ClusterState fields.
 */
export function applyEnemyBlockForces(world: WorldState): void {
  const {
    isAliveFlag, ownerEntityId, kindBuffer, clusters,
    positionXWorld, positionYWorld,
    forceX, forceY,
    behaviorMode, isTransientFlag,
    particleCount,
  } = world;

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    if (cluster.isPlayerFlag === 1 || cluster.isAliveFlag === 0) continue;
    if (cluster.enemyAiIsBlockingFlag === 0) {
      // Blocking just ended — release block-mode particles of this enemy back to orbit
      for (let i = 0; i < particleCount; i++) {
        if (ownerEntityId[i] === cluster.entityId && behaviorMode[i] === 2) {
          behaviorMode[i] = 0;
        }
      }
      continue;
    }

    const enemyEntityId  = cluster.entityId;
    const blockDirX      = cluster.enemyAiBlockDirXWorld;
    const blockDirY      = cluster.enemyAiBlockDirYWorld;
    const enemyX         = cluster.positionXWorld;
    const enemyY         = cluster.positionYWorld;
    const isFlyingEye    = cluster.isFlyingEyeFlag === 1;

    _eBlockKindCount.fill(0);
    _eBlockKindSlotIdx.fill(0);
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 1 && ownerEntityId[i] === enemyEntityId && isTransientFlag[i] === 0) {
        const k = kindBuffer[i];
        if (k < PARTICLE_KIND_COUNT) _eBlockKindCount[k]++;
      }
    }

    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      if (ownerEntityId[i] !== enemyEntityId) continue;
      if (isTransientFlag[i] === 1) continue;

      behaviorMode[i] = 2;

      const kind  = kindBuffer[i];
      const total = _eBlockKindCount[kind] > 0 ? _eBlockKindCount[kind] : 1;
      const slot  = _eBlockKindSlotIdx[kind]++;

      let targetXWorld: number;
      let targetYWorld: number;

      if (isFlyingEye) {
        // Flying eye block: spin all particles in a tight protective circle
        const angle = (slot / total) * Math.PI * 2.0;
        targetXWorld = enemyX + Math.cos(angle) * SHIELD_DIST_WORLD;
        targetYWorld = enemyY + Math.sin(angle) * SHIELD_DIST_WORLD;
      } else if (cluster.isRollingEnemyFlag === 1) {
        // Rolling enemy block: wide crescent arc facing the player.
        // blockDirX/Y was set to point TOWARD the player in enemyAi.ts,
        // so the crescent forms between this enemy and the player.
        const crescentAngle = Math.atan2(blockDirY, blockDirX);
        const halfSpread = Math.PI * 0.75; // ±135° → nearly a full semicircle
        const t = total > 1 ? slot / (total - 1) : 0.5;
        const angle = crescentAngle - halfSpread * 0.5 + t * halfSpread;
        targetXWorld = enemyX + Math.cos(angle) * SHIELD_DIST_WORLD;
        targetYWorld = enemyY + Math.sin(angle) * SHIELD_DIST_WORLD;
      } else {
        ({ targetXWorld, targetYWorld } = computeShieldTarget(
          enemyX, enemyY,
          blockDirX, blockDirY,
          slot, total, kind,
        ));
      }

      const dsx = targetXWorld - positionXWorld[i];
      const dsy = targetYWorld - positionYWorld[i];
      forceX[i] += dsx * SHIELD_SPRING_STRENGTH;
      forceY[i] += dsy * SHIELD_SPRING_STRENGTH;
    }
  }
}
