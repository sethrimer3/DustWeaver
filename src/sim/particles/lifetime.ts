/**
 * Particle lifetime and respawn management.
 *
 * Each tick, every alive particle's age increments by 1.
 * When age reaches its lifetime the particle is respawned:
 *   • Owned particles (ownerEntityId ≥ 0) respawn at their owner cluster.
 *   • Fluid background particles (ownerEntityId === -1) respawn at a random
 *     position within the world bounds — keeping the fluid field constant.
 *
 * Respawning uses world.rng so the sequence is deterministic and
 * reproducible given the same initial seed.
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';
import { nextFloat, nextFloatRange } from '../rng';
import { ParticleKind } from './kinds';

export function updateParticleLifetimes(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    massKg, isAliveFlag, kindBuffer,
    ownerEntityId, clusters,
    ageTicks, lifetimeTicks,
    anchorAngleRad, anchorRadiusWorld,
    noiseTickSeed, disturbanceFactor,
    behaviorMode, particleDurability, respawnDelayTicks, attackModeTicksLeft,
    particleCount, rng,
    worldWidthWorld, worldHeightWorld,
  } = world;

  // ---- Respawn delay countdown (combat-killed particles) -----------------
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1) continue;          // only dead particles
    if (respawnDelayTicks[i] <= 0) continue;     // no pending respawn

    respawnDelayTicks[i] -= 1.0;
    if (respawnDelayTicks[i] > 0) continue;

    // Delay expired — respawn this particle at its owner
    if (kindBuffer[i] === ParticleKind.Fluid) {
      positionXWorld[i] = nextFloat(rng) * worldWidthWorld;
      positionYWorld[i] = nextFloat(rng) * worldHeightWorld;
      velocityXWorld[i] = 0.0;
      velocityYWorld[i] = 0.0;
      forceX[i] = 0.0;
      forceY[i] = 0.0;
      massKg[i] = getElementProfile(kindBuffer[i]).massKg;
      disturbanceFactor[i] = 0.0;
      noiseTickSeed[i] = (nextFloat(rng) * 0xffffffff) >>> 0;
      lifetimeTicks[i] = Math.max(2.0, getElementProfile(kindBuffer[i]).lifetimeBaseTicks);
      ageTicks[i] = 0.0;
      isAliveFlag[i] = 1;
      behaviorMode[i] = 0;
      particleDurability[i] = getElementProfile(kindBuffer[i]).toughness;
      continue;
    }

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
    if (!ownerFound) continue;

    const profile = getElementProfile(kindBuffer[i]);
    const newAngleRad = nextFloat(rng) * Math.PI * 2.0;
    const newRadius = profile.orbitRadiusWorld
      + nextFloatRange(rng, -profile.orbitRadiusWorld * 0.25, profile.orbitRadiusWorld * 0.25);

    anchorAngleRad[i]    = newAngleRad;
    anchorRadiusWorld[i] = newRadius;
    noiseTickSeed[i]     = (nextFloat(rng) * 0xffffffff) >>> 0;
    positionXWorld[i] = ownerX + Math.cos(newAngleRad) * newRadius;
    positionYWorld[i] = ownerY + Math.sin(newAngleRad) * newRadius;
    velocityXWorld[i] = nextFloatRange(rng, -15.0, 15.0);
    velocityYWorld[i] = nextFloatRange(rng, -15.0, 15.0);
    forceX[i] = 0.0;
    forceY[i] = 0.0;
    massKg[i] = profile.massKg;
    lifetimeTicks[i] = Math.max(2.0, profile.lifetimeBaseTicks
      + nextFloatRange(rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks));
    ageTicks[i] = 0.0;
    isAliveFlag[i] = 1;
    behaviorMode[i] = 0;
    particleDurability[i] = profile.toughness;
    attackModeTicksLeft[i] = 0;
  }

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    ageTicks[i] += 1.0;

    if (ageTicks[i] < lifetimeTicks[i]) continue;

    // ---- Particle has expired -------------------------------------------
    const profile = getElementProfile(kindBuffer[i]);

    // New lifetime with variance
    const newLifetime = profile.lifetimeBaseTicks
      + nextFloatRange(rng,
          -profile.lifetimeVarianceTicks,
           profile.lifetimeVarianceTicks);

    // ---- Fluid background particle: respawn at random world position ----
    if (kindBuffer[i] === ParticleKind.Fluid) {
      positionXWorld[i] = nextFloat(rng) * worldWidthWorld;
      positionYWorld[i] = nextFloat(rng) * worldHeightWorld;
      velocityXWorld[i] = 0.0;
      velocityYWorld[i] = 0.0;
      forceX[i] = 0.0;
      forceY[i] = 0.0;
      massKg[i] = profile.massKg;
      disturbanceFactor[i] = 0.0;
      noiseTickSeed[i] = (nextFloat(rng) * 0xffffffff) >>> 0;
      lifetimeTicks[i] = Math.max(2.0, newLifetime);
      ageTicks[i] = 0.0;
      isAliveFlag[i] = 1;
      behaviorMode[i] = 0;
      particleDurability[i] = profile.toughness;
      attackModeTicksLeft[i] = 0;
      continue;
    }

    // ---- Owned particle: respawn at owner --------------------------------
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

    lifetimeTicks[i] = Math.max(2.0, newLifetime);
    ageTicks[i]      = 0.0;
    isAliveFlag[i]   = 1;
    behaviorMode[i] = 0;
    particleDurability[i] = profile.toughness;
    attackModeTicksLeft[i] = 0;
  }
}
