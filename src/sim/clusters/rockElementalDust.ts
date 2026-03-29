/**
 * Rock Elemental dust orbit and projectile system.
 *
 * Manages the orbiting brown-rock dust particles around each Rock Elemental:
 *  - Positions orbit-mode dust in a rotating ring
 *  - Fires one dust projectile at the player when the elemental attacks
 *  - Spawns new dust particles when the elemental regenerates
 *
 * Dust particles use ParticleKind.Earth and are owned by the elemental's entityId.
 * Orbit-mode particles (behaviorMode=0) are repositioned each tick.
 * Attack-mode particles (behaviorMode=1) fly toward the player as projectiles.
 *
 * Called from tick.ts after applyRockElementalAI (step 0.5c).
 */

import { WorldState, MAX_PARTICLES } from '../world';
import { nextFloat } from '../rng';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import {
  RE_STATE_ATTACKING,
  RE_STATE_ACTIVE,
  RE_STATE_REGENERATING,
  RE_ORBIT_RADIUS_WORLD,
  RE_PROJECTILE_SPEED_WORLD_PER_SEC,
  RE_PROJECTILE_LIFETIME_TICKS,
} from './rockElementalAi';

// ── Constants ────────────────────────────────────────────────────────────────

/** Spring strength pulling orbit-mode dust toward target position. */
const ORBIT_SPRING_STRENGTH = 500.0;

/** Damping applied to orbit-mode dust to prevent oscillation. */
const ORBIT_DAMPING = 12.0;

/** Effectively-infinite lifetime for orbit-managed dust (system controls removal). */
const ORBIT_DUST_LIFETIME_TICKS = 9999;

/** Minimum distance for safe normalization to avoid division by near-zero. */
const MIN_NORMALIZE_DIST_WORLD = 0.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Reuses a dead transient slot or appends a new particle. Returns -1 if full. */
function _findFreeSlot(world: WorldState): number {
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0
        && world.respawnDelayTicks[i] <= 0
        && world.isTransientFlag[i] === 1) {
      return i;
    }
  }
  if (world.particleCount < MAX_PARTICLES) {
    return world.particleCount++;
  }
  return -1;
}

// ── Main update ──────────────────────────────────────────────────────────────

export function updateRockElementalDust(world: WorldState): void {
  const {
    clusters, particleCount,
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    isAliveFlag, ownerEntityId,
    behaviorMode, attackModeTicksLeft,
    isTransientFlag,
  } = world;

  // Find player position for projectile targeting
  let playerX = 0.0;
  let playerY = 0.0;
  let hasPlayer = false;
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      hasPlayer = true;
      break;
    }
  }

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    if (cluster.isRockElementalFlag !== 1 || cluster.isAliveFlag === 0) continue;

    const entityId = cluster.entityId;
    const state = cluster.rockElementalState;
    const orbitAngle = cluster.rockElementalOrbitAngleRad;
    const cx = cluster.positionXWorld;
    const cy = cluster.positionYWorld;

    // ── Count alive orbit-mode dust owned by this elemental ────────────────
    let aliveOrbitCount = 0;
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 1
          && ownerEntityId[i] === entityId
          && behaviorMode[i] === 0
          && isTransientFlag[i] === 0) {
        aliveOrbitCount++;
      }
    }

    // ── Reconcile dustCount with alive particles ───────────────────────────
    // If dustCount > aliveOrbitCount the AI incremented it (regen) → spawn.
    // If dustCount < aliveOrbitCount shouldn't happen, but clamp to be safe.
    const toSpawn = cluster.rockElementalDustCount - aliveOrbitCount;

    if (toSpawn < 0) {
      // Dust particles were killed; sync count down so the AI regen rebuilds them
      cluster.rockElementalDustCount = aliveOrbitCount;
    } else if (toSpawn > 0 && state >= RE_STATE_ACTIVE && state <= RE_STATE_REGENERATING) {
      const profile = getElementProfile(ParticleKind.Earth);
      const targetTotal = cluster.rockElementalDustCount;

      for (let s = 0; s < toSpawn; s++) {
        const idx = _findFreeSlot(world);
        if (idx === -1) break;

        const spawnAngle = orbitAngle
          + ((aliveOrbitCount + s) / Math.max(1, targetTotal)) * Math.PI * 2.0;

        world.positionXWorld[idx]      = cx + Math.cos(spawnAngle) * RE_ORBIT_RADIUS_WORLD;
        world.positionYWorld[idx]      = cy + Math.sin(spawnAngle) * RE_ORBIT_RADIUS_WORLD;
        world.velocityXWorld[idx]      = 0;
        world.velocityYWorld[idx]      = 0;
        world.forceX[idx]              = 0;
        world.forceY[idx]              = 0;
        world.massKg[idx]              = profile.massKg;
        world.chargeUnits[idx]         = 0;
        world.isAliveFlag[idx]         = 1;
        world.kindBuffer[idx]          = ParticleKind.Earth;
        world.ownerEntityId[idx]       = entityId;
        world.anchorAngleRad[idx]      = spawnAngle;
        world.anchorRadiusWorld[idx]   = RE_ORBIT_RADIUS_WORLD;
        world.disturbanceFactor[idx]   = 0;
        world.lifetimeTicks[idx]       = ORBIT_DUST_LIFETIME_TICKS;
        world.ageTicks[idx]            = 0;
        world.noiseTickSeed[idx]       = (nextFloat(world.rng) * 0xffffffff) >>> 0;
        world.behaviorMode[idx]        = 0; // orbit mode
        world.particleDurability[idx]  = profile.toughness;
        world.respawnDelayTicks[idx]   = 0;
        world.attackModeTicksLeft[idx] = 0;
        world.isTransientFlag[idx]     = 0;
        world.weaveSlotId[idx]         = 0;
      }
    }

    // ── Position orbit-mode dust with spring forces ────────────────────────
    if (state >= RE_STATE_ACTIVE && state <= RE_STATE_REGENERATING) {
      // Count current orbit particles (may include freshly spawned ones)
      let currentOrbitCount = 0;
      for (let i = 0; i < world.particleCount; i++) {
        if (isAliveFlag[i] === 1
            && ownerEntityId[i] === entityId
            && behaviorMode[i] === 0
            && isTransientFlag[i] === 0) {
          currentOrbitCount++;
        }
      }

      const totalOrbiting = currentOrbitCount > 0 ? currentOrbitCount : 1;
      let orbitSlot = 0;

      for (let i = 0; i < world.particleCount; i++) {
        if (isAliveFlag[i] === 0) continue;
        if (ownerEntityId[i] !== entityId) continue;
        if (isTransientFlag[i] === 1) continue;
        if (behaviorMode[i] !== 0) continue;

        const slotAngle = orbitAngle + (orbitSlot / totalOrbiting) * Math.PI * 2.0;
        const targetX = cx + Math.cos(slotAngle) * RE_ORBIT_RADIUS_WORLD;
        const targetY = cy + Math.sin(slotAngle) * RE_ORBIT_RADIUS_WORLD;

        const dx = targetX - positionXWorld[i];
        const dy = targetY - positionYWorld[i];

        forceX[i] += dx * ORBIT_SPRING_STRENGTH - velocityXWorld[i] * ORBIT_DAMPING;
        forceY[i] += dy * ORBIT_SPRING_STRENGTH - velocityYWorld[i] * ORBIT_DAMPING;

        orbitSlot++;
      }
    }

    // ── Fire projectile when attacking ─────────────────────────────────────
    if (state === RE_STATE_ATTACKING
        && cluster.rockElementalStateTicks === 1
        && hasPlayer) {
      for (let i = 0; i < world.particleCount; i++) {
        if (isAliveFlag[i] === 1
            && ownerEntityId[i] === entityId
            && behaviorMode[i] === 0
            && isTransientFlag[i] === 0) {
          const dx = playerX - positionXWorld[i];
          const dy = playerY - positionYWorld[i];
          const dist = Math.sqrt(dx * dx + dy * dy);
          const invDist = dist > MIN_NORMALIZE_DIST_WORLD ? 1.0 / dist : 0.0;

          velocityXWorld[i] = dx * invDist * RE_PROJECTILE_SPEED_WORLD_PER_SEC;
          velocityYWorld[i] = dy * invDist * RE_PROJECTILE_SPEED_WORLD_PER_SEC;
          behaviorMode[i] = 1; // attack mode — uses existing combat damage flow
          attackModeTicksLeft[i] = RE_PROJECTILE_LIFETIME_TICKS;

          cluster.rockElementalDustCount -= 1;
          break; // Fire one projectile per attack
        }
      }
    }
  }
}
