/**
 * Element effect particle spawners.
 *
 * These helper functions spawn short-lived transient particles (stone shards,
 * lava fire trails, crystal shards, poison clouds, chain lightning bolts) as
 * side effects of inter-particle combat contacts.  They are called by
 * applyInterParticleForces in forces.ts after the main contact loop.
 *
 * All logic is unchanged from the original forces.ts — only the location moved.
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';
import { ParticleKind } from './kinds';
import { nextFloat } from '../rng';

// ---- Spawn constants --------------------------------------------------------

/** Stone shard lifetime (ticks) — kept short to flag as transient. */
export const STONE_SHARD_LIFETIME_TICKS = 35.0;
/** Fire trail lifetime (ticks) — brief burning embers from lava. */
export const LAVA_FIRE_TRAIL_LIFETIME_TICKS = 55.0;
/** Crystal shard lifetime (ticks) — sharp fragments from shattered crystal. */
export const CRYSTAL_SHARD_LIFETIME_TICKS = 28.0;
/** Poison cloud lifetime (ticks) — lingering toxic burst from dying poison particle. */
export const POISON_CLOUD_LIFETIME_TICKS = 52.0;
/** Chain lightning bolt speed (world units/tick). */
export const LIGHTNING_CHAIN_SPEED_WORLD = 700.0;

// ---- Shared helper ----------------------------------------------------------

/** Finds a dead transient slot to reuse, or allocates a new one at the end. */
export function _findFreeSlot(world: WorldState): number {
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

// ---- Per-element spawners ---------------------------------------------------

/** Spawns 2 stone shard particles at the given impact position/velocity. */
export function _spawnStoneShards(
  world: WorldState,
  posX: number, posY: number,
  impactVelX: number, impactVelY: number,
  ownerEntityIdValue: number,
): void {
  const profile = getElementProfile(ParticleKind.Stone);
  const rng = world.rng;

  for (let s = 0; s < 2; s++) {
    const idx = _findFreeSlot(world);
    if (idx === -1) return;

    const angleRad = nextFloat(rng) * Math.PI * 2.0;
    const speed = 100.0 + nextFloat(rng) * 100.0;

    world.positionXWorld[idx]    = posX;
    world.positionYWorld[idx]    = posY;
    world.velocityXWorld[idx]    = Math.cos(angleRad) * speed + impactVelX * 0.3;
    world.velocityYWorld[idx]    = Math.sin(angleRad) * speed + impactVelY * 0.3;
    world.forceX[idx]            = 0;
    world.forceY[idx]            = 0;
    world.massKg[idx]            = profile.massKg * 0.35;
    world.chargeUnits[idx]       = 0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = ParticleKind.Stone;
    world.ownerEntityId[idx]     = ownerEntityIdValue;
    world.anchorAngleRad[idx]    = 0;
    world.anchorRadiusWorld[idx] = 0;
    world.disturbanceFactor[idx] = 0;
    world.noiseTickSeed[idx]     = ((nextFloat(rng) * 0xffffffff) >>> 0);
    world.lifetimeTicks[idx]     = STONE_SHARD_LIFETIME_TICKS;
    world.ageTicks[idx]          = 0;
    world.behaviorMode[idx]      = 1;   // attack mode — suppresses binding
    world.attackModeTicksLeft[idx] = STONE_SHARD_LIFETIME_TICKS + 10;
    world.particleDurability[idx] = 1.0;
    world.respawnDelayTicks[idx] = 0;
    world.isTransientFlag[idx]   = 1;   // transient — no respawn
  }
}

/** Spawns 2 short-lived fire particles as lava trail embers at given position. */
export function _spawnLavaTrailFire(
  world: WorldState,
  posX: number, posY: number,
  ownerEntityIdValue: number,
): void {
  const profile = getElementProfile(ParticleKind.Fire);
  const rng = world.rng;

  for (let s = 0; s < 2; s++) {
    const idx = _findFreeSlot(world);
    if (idx === -1) return;

    const angleRad = nextFloat(rng) * Math.PI * 2.0;
    const speed = 30.0 + nextFloat(rng) * 60.0;

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
    world.behaviorMode[idx]      = 1;   // attack mode — flies freely
    world.attackModeTicksLeft[idx] = LAVA_FIRE_TRAIL_LIFETIME_TICKS + 10;
    world.particleDurability[idx] = 1.0;
    world.respawnDelayTicks[idx] = 0;
    world.isTransientFlag[idx]   = 1;   // transient — no respawn
  }
}

/** Spawns 3 crystal shard particles at the given impact position/velocity. */
export function _spawnCrystalShards(
  world: WorldState,
  posX: number, posY: number,
  impactVelX: number, impactVelY: number,
  ownerEntityIdValue: number,
): void {
  const profile = getElementProfile(ParticleKind.Crystal);
  const rng = world.rng;

  for (let s = 0; s < 3; s++) {
    const idx = _findFreeSlot(world);
    if (idx === -1) return;

    const angleRad = nextFloat(rng) * Math.PI * 2.0;
    const speed = 120.0 + nextFloat(rng) * 100.0;

    world.positionXWorld[idx]      = posX;
    world.positionYWorld[idx]      = posY;
    world.velocityXWorld[idx]      = Math.cos(angleRad) * speed + impactVelX * 0.2;
    world.velocityYWorld[idx]      = Math.sin(angleRad) * speed + impactVelY * 0.2;
    world.forceX[idx]              = 0;
    world.forceY[idx]              = 0;
    world.massKg[idx]              = profile.massKg * 0.25;
    world.chargeUnits[idx]         = 0;
    world.isAliveFlag[idx]         = 1;
    world.kindBuffer[idx]          = ParticleKind.Crystal;
    world.ownerEntityId[idx]       = ownerEntityIdValue;
    world.anchorAngleRad[idx]      = 0;
    world.anchorRadiusWorld[idx]   = 0;
    world.disturbanceFactor[idx]   = 0;
    world.noiseTickSeed[idx]       = ((nextFloat(rng) * 0xffffffff) >>> 0);
    world.lifetimeTicks[idx]       = CRYSTAL_SHARD_LIFETIME_TICKS;
    world.ageTicks[idx]            = 0;
    world.behaviorMode[idx]        = 1;   // attack mode — flies freely
    world.attackModeTicksLeft[idx] = CRYSTAL_SHARD_LIFETIME_TICKS + 10;
    world.particleDurability[idx]  = 1.0;
    world.respawnDelayTicks[idx]   = 0;
    world.isTransientFlag[idx]     = 1;   // transient — no respawn
  }
}

/** Spawns a slow-drifting poison cloud particle at the given position. */
export function _spawnPoisonCloud(
  world: WorldState,
  posX: number, posY: number,
  ownerEntityIdValue: number,
): void {
  const profile = getElementProfile(ParticleKind.Poison);
  const rng = world.rng;

  const idx = _findFreeSlot(world);
  if (idx === -1) return;

  const angleRad = nextFloat(rng) * Math.PI * 2.0;
  const speed = 5.0 + nextFloat(rng) * 15.0;

  world.positionXWorld[idx]      = posX;
  world.positionYWorld[idx]      = posY;
  world.velocityXWorld[idx]      = Math.cos(angleRad) * speed;
  world.velocityYWorld[idx]      = Math.sin(angleRad) * speed;
  world.forceX[idx]              = 0;
  world.forceY[idx]              = 0;
  world.massKg[idx]              = profile.massKg * 1.5;  // heavier — drifts slowly
  world.chargeUnits[idx]         = 0;
  world.isAliveFlag[idx]         = 1;
  world.kindBuffer[idx]          = ParticleKind.Poison;
  world.ownerEntityId[idx]       = ownerEntityIdValue;
  world.anchorAngleRad[idx]      = 0;
  world.anchorRadiusWorld[idx]   = 0;
  world.disturbanceFactor[idx]   = 0;
  world.noiseTickSeed[idx]       = ((nextFloat(rng) * 0xffffffff) >>> 0);
  world.lifetimeTicks[idx]       = POISON_CLOUD_LIFETIME_TICKS;
  world.ageTicks[idx]            = 0;
  world.behaviorMode[idx]        = 1;   // attack mode — can harm enemies
  world.attackModeTicksLeft[idx] = POISON_CLOUD_LIFETIME_TICKS + 5;
  world.particleDurability[idx]  = 0.5; // cloud is fragile
  world.respawnDelayTicks[idx]   = 0;
  world.isTransientFlag[idx]     = 1;   // transient — no respawn
}

/**
 * Spawns a fast transient lightning bolt aimed at the given victim cluster.
 * Called when a (non-transient) lightning particle kills an enemy — chain arc.
 */
export function _spawnChainLightning(
  world: WorldState,
  posX: number, posY: number,
  killerOwner: number,
  victimOwner: number,
): void {
  // Find victim cluster center to aim toward
  let targetX = posX;
  let targetY = posY;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cl = world.clusters[ci];
    if (cl.entityId === victimOwner && cl.isAliveFlag === 1) {
      targetX = cl.positionXWorld;
      targetY = cl.positionYWorld;
      break;
    }
  }

  const dx = targetX - posX;
  const dy = targetY - posY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1.0) return;  // nothing to chain to

  const idx = _findFreeSlot(world);
  if (idx === -1) return;

  const profile = getElementProfile(ParticleKind.Lightning);
  const rng = world.rng;
  const invDist = 1.0 / dist;

  world.positionXWorld[idx]      = posX;
  world.positionYWorld[idx]      = posY;
  world.velocityXWorld[idx]      = (dx * invDist) * LIGHTNING_CHAIN_SPEED_WORLD
                                     + (nextFloat(rng) - 0.5) * 80.0;
  world.velocityYWorld[idx]      = (dy * invDist) * LIGHTNING_CHAIN_SPEED_WORLD
                                     + (nextFloat(rng) - 0.5) * 80.0;
  world.forceX[idx]              = 0;
  world.forceY[idx]              = 0;
  world.massKg[idx]              = profile.massKg;
  world.chargeUnits[idx]         = 0;
  world.isAliveFlag[idx]         = 1;
  world.kindBuffer[idx]          = ParticleKind.Lightning;
  world.ownerEntityId[idx]       = killerOwner;
  world.anchorAngleRad[idx]      = 0;
  world.anchorRadiusWorld[idx]   = 0;
  world.disturbanceFactor[idx]   = 0;
  world.noiseTickSeed[idx]       = ((nextFloat(rng) * 0xffffffff) >>> 0);
  world.lifetimeTicks[idx]       = 14.0;   // short-lived chain bolt
  world.ageTicks[idx]            = 0;
  world.behaviorMode[idx]        = 1;      // attack mode
  world.attackModeTicksLeft[idx] = 14.0 + 5;
  world.particleDurability[idx]  = 1.5;
  world.respawnDelayTicks[idx]   = 0;
  world.isTransientFlag[idx]     = 1;      // transient — no respawn
}
