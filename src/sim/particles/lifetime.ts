/**
 * Particle lifetime and respawn management.
 *
 * Each tick, every alive particle's age increments by 1.
 * When age reaches its lifetime the particle is respawned at its owner
 * with a fresh random anchor offset — keeping the particle count constant
 * and element-specific decay rates (fire dies and rebirths quickly;
 * ice persists much longer).
 *
 * Respawning uses world.rng so the sequence is deterministic and
 * reproducible given the same initial seed.
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';
import { nextFloat, nextFloatRange } from '../rng';

export function updateParticleLifetimes(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    massKg, isAliveFlag, kindBuffer,
    ownerEntityId, clusters,
    ageTicks, lifetimeTicks,
    anchorAngleRad, anchorRadiusWorld,
    noiseTickSeed,
    particleCount, rng,
  } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    ageTicks[i] += 1.0;

    if (ageTicks[i] < lifetimeTicks[i]) continue;

    // ---- Particle has expired: respawn at owner -------------------------
    const ownerId = ownerEntityId[i];
    let ownerX = 0.0;
    let ownerY = 0.0;
    let ownerFound = false;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusters[ci].entityId === ownerId && clusters[ci].isAliveFlag === 1) {
        ownerX = clusters[ci].positionXWorld;
        ownerY = clusters[ci].positionYWorld;
        ownerFound = true;
        break;
      }
    }

    if (!ownerFound) {
      // Owner is dead — leave the particle dead too
      isAliveFlag[i] = 0;
      continue;
    }

    const profile = getElementProfile(kindBuffer[i]);

    // New random anchor angle and radius (small variance around base orbit)
    const newAngleRad    = nextFloat(rng) * (Math.PI * 2);
    const radiusVariance = profile.orbitRadiusWorld * 0.25;
    const newRadius      = profile.orbitRadiusWorld
      + nextFloatRange(rng, -radiusVariance, radiusVariance);

    anchorAngleRad[i]    = newAngleRad;
    anchorRadiusWorld[i] = newRadius;
    noiseTickSeed[i]     = (nextFloat(rng) * 0xffffffff) >>> 0;

    // Reset position to anchor target
    positionXWorld[i] = ownerX + Math.cos(newAngleRad) * newRadius;
    positionYWorld[i] = ownerY + Math.sin(newAngleRad) * newRadius;

    // Small spawn velocity for natural "birth" scatter
    const spawnSpeed = 15.0;
    velocityXWorld[i] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);
    velocityYWorld[i] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);

    forceX[i] = 0.0;
    forceY[i] = 0.0;
    massKg[i] = profile.massKg;

    // New lifetime with variance
    const newLifetime = profile.lifetimeBaseTicks
      + nextFloatRange(rng,
          -profile.lifetimeVarianceTicks,
           profile.lifetimeVarianceTicks);
    lifetimeTicks[i] = Math.max(2.0, newLifetime);
    ageTicks[i]      = 0.0;
    isAliveFlag[i]   = 1;
  }
}
