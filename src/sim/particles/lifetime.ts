/**
 * Particle lifetime and respawn management.
 *
 * Each tick, every alive particle's age increments by 1.
 * When age reaches its lifetime the particle is respawned:
 *   • Owned particles (ownerEntityId ≥ 0) respawn at their owner cluster.
 *   • Fluid background particles (ownerEntityId === -1) respawn at a random
 *     position within the world bounds — keeping the fluid field constant.
 *   • Transient particles (isTransientFlag=1, e.g. stone shards or lava trail
 *     fire embers) die permanently without respawning.
 *
 * Special behavior:
 *   • Lava particles that die naturally spawn 2 short-lived fire trail embers
 *     at their last position, representing residual burning.
 *
 * Respawning uses world.rng so the sequence is deterministic and
 * reproducible given the same initial seed.
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';
import { nextFloat, nextFloatRange } from '../rng';
import { ParticleKind } from './kinds';

/** Lifetime (ticks) for lava trail fire embers spawned on lava natural death. */
const LAVA_FIRE_TRAIL_LIFETIME_TICKS = 55.0;

/** Finds a dead transient slot to reuse, or allocates a new one at the end. */
function _findFreeSlot(world: WorldState): number {
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0 && world.respawnDelayTicks[i] <= 0 && world.isTransientFlag[i] === 1) {
      return i;
    }
  }
  if (world.particleCount < world.positionXWorld.length) {
    return world.particleCount++;
  }
  return -1;
}

/** Spawns 2 short-lived fire embers at the given position as lava trail particles. */
function _spawnLavaTrailFire(world: WorldState, posX: number, posY: number, ownerEntityIdValue: number): void {
  const profile = getElementProfile(ParticleKind.Fire);
  const rng = world.rng;

  for (let s = 0; s < 2; s++) {
    const idx = _findFreeSlot(world);
    if (idx === -1) return;

    const angleRad = nextFloat(rng) * Math.PI * 2.0;
    const speed = 25.0 + nextFloat(rng) * 50.0;

    world.positionXWorld[idx]    = posX;
    world.positionYWorld[idx]    = posY;
    world.velocityXWorld[idx]    = Math.cos(angleRad) * speed;
    world.velocityYWorld[idx]    = Math.sin(angleRad) * speed;
    world.forceX[idx]            = 0;
    world.forceY[idx]            = 0;
    world.massKg[idx]            = profile.massKg;
    world.chargeUnits[idx]       = 0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = ParticleKind.Fire;
    world.ownerEntityId[idx]     = ownerEntityIdValue;
    world.anchorAngleRad[idx]    = 0;
    world.anchorRadiusWorld[idx] = 0;
    world.disturbanceFactor[idx] = 0;
    world.noiseTickSeed[idx]     = ((nextFloat(rng) * 0xffffffff) >>> 0);
    world.lifetimeTicks[idx]     = LAVA_FIRE_TRAIL_LIFETIME_TICKS;
    world.ageTicks[idx]          = 0;
    world.behaviorMode[idx]      = 1;
    world.attackModeTicksLeft[idx] = LAVA_FIRE_TRAIL_LIFETIME_TICKS + 10;
    world.particleDurability[idx] = 1.0;
    world.respawnDelayTicks[idx] = 0;
    world.isTransientFlag[idx]   = 1;
  }
}

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
    isTransientFlag,
    particleCount, rng,
    worldWidthWorld, worldHeightWorld,
  } = world;

  // ---- Respawn delay countdown (combat-killed particles) -----------------
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1) continue;          // only dead particles
    if (respawnDelayTicks[i] <= 0) continue;     // no pending respawn

    respawnDelayTicks[i] -= 1.0;
    if (respawnDelayTicks[i] > 0) continue;

    // Transient particles (shards, trail fire) never respawn
    if (isTransientFlag[i] === 1) continue;

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

    // ── Transient particles (shards, trail fire): die permanently ──────────
    if (isTransientFlag[i] === 1) {
      isAliveFlag[i] = 0;
      // No respawn delay — slot available for immediate reuse
      continue;
    }

    const profile = getElementProfile(kindBuffer[i]);

    // New lifetime with variance
    const newLifetime = profile.lifetimeBaseTicks
      + nextFloatRange(rng,
          -profile.lifetimeVarianceTicks,
           profile.lifetimeVarianceTicks);

    // ── Lava: spawn trail fire embers on natural death ──────────────────────
    if (kindBuffer[i] === ParticleKind.Lava) {
      _spawnLavaTrailFire(world, positionXWorld[i], positionYWorld[i], ownerEntityId[i]);
    }

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

    // ---- Owned particle: persist — cycle the age and refresh anchor -----
    // Owned particles only die from combat, never from natural lifetime expiry.
    // Cycling the age maintains the visual fade-in / fade-out shimmer while
    // keeping the particle alive and the count constant.
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

    // Refresh anchor and lifetime for the next cycle
    const newAngleRad    = nextFloat(rng) * (Math.PI * 2);
    const radiusVariance = profile.orbitRadiusWorld * 0.25;
    const newRadius      = profile.orbitRadiusWorld
      + nextFloatRange(rng, -radiusVariance, radiusVariance);

    anchorAngleRad[i]    = newAngleRad;
    anchorRadiusWorld[i] = newRadius;
    noiseTickSeed[i]     = (nextFloat(rng) * 0xffffffff) >>> 0;

    // Gently nudge toward the refreshed anchor (don't teleport)
    positionXWorld[i] = ownerX + Math.cos(newAngleRad) * newRadius;
    positionYWorld[i] = ownerY + Math.sin(newAngleRad) * newRadius;

    const spawnSpeed = 15.0;
    velocityXWorld[i] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);
    velocityYWorld[i] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);

    forceX[i] = 0.0;
    forceY[i] = 0.0;
    massKg[i] = profile.massKg;

    lifetimeTicks[i] = Math.max(2.0, newLifetime);
    ageTicks[i]      = 0.0;  // restart visual cycle — particle stays alive
    // behaviorMode stays 0 (orbit); durability is not reset (persist until killed)
    attackModeTicksLeft[i] = 0;
  }
}
