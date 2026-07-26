/**
 * Player-death disintegration burst — spawns a cloud of warm-gold dust motes
 * at the player's position, blown outward to the left, in place of the old
 * instant-vanish on death.
 *
 * Reuses the core particle system (ParticleKind.Golden, unowned) so the burst
 * gets the same gravity, wall-collision/floor-settle, and lifetime behavior
 * as every other gold dust particle — no bespoke physics needed.
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { nextFloat, nextFloatRange } from '../rng';

/** Number of motes spawned on player death. */
export const PLAYER_DEATH_MOTE_COUNT = 80;

/** Center direction of the outward blow, in radians (180° = straight left). */
const BLOW_DIRECTION_RAD = Math.PI;

/** Half-angle of the leftward spread cone (radians). ±60°. */
const BLOW_SPREAD_RAD = Math.PI / 3;

/** Outward speed range (world units/s) imparted to each mote. */
const BLOW_SPEED_MIN_WORLD = 60.0;
const BLOW_SPEED_MAX_WORLD = 220.0;

/** Finds a dead, non-pending, transient slot to reuse, or grows the pool. */
function findFreeTransientSlot(world: WorldState): number {
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

/**
 * Spawns the player-death disintegration burst at (xWorld, yWorld).
 * Each mote is an unowned, transient Golden particle blown left within a
 * ±60° cone — it falls under normal gravity, bounces/settles on walls, and
 * dies permanently (no respawn) once its lifetime expires.
 */
export function spawnPlayerDeathDisintegration(world: WorldState, xWorld: number, yWorld: number): void {
  const profile = getElementProfile(ParticleKind.Golden);
  const rng = world.rng;

  for (let m = 0; m < PLAYER_DEATH_MOTE_COUNT; m++) {
    const idx = findFreeTransientSlot(world);
    if (idx === -1) return; // pool at capacity — drop remaining motes gracefully

    const angleRad = BLOW_DIRECTION_RAD + nextFloatRange(rng, -BLOW_SPREAD_RAD, BLOW_SPREAD_RAD);
    const speed = nextFloatRange(rng, BLOW_SPEED_MIN_WORLD, BLOW_SPEED_MAX_WORLD);

    world.positionXWorld[idx]      = xWorld;
    world.positionYWorld[idx]      = yWorld;
    world.velocityXWorld[idx]      = Math.cos(angleRad) * speed;
    world.velocityYWorld[idx]      = Math.sin(angleRad) * speed;
    world.forceX[idx]              = 0;
    world.forceY[idx]              = 0;
    world.massKg[idx]              = profile.massKg;
    world.chargeUnits[idx]         = 0;
    world.isAliveFlag[idx]         = 1;
    world.kindBuffer[idx]          = ParticleKind.Golden;
    world.ownerEntityId[idx]       = -1;
    world.anchorAngleRad[idx]      = 0;
    world.anchorRadiusWorld[idx]   = 0;
    world.disturbanceFactor[idx]   = 0;
    world.noiseTickSeed[idx]       = (nextFloat(rng) * 0xffffffff) >>> 0;
    world.lifetimeTicks[idx]       = Math.max(2.0, profile.lifetimeBaseTicks
      + nextFloatRange(rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks));
    world.ageTicks[idx]            = 0;
    world.behaviorMode[idx]        = 1; // attack mode — suppresses binding forces (unowned anyway)
    world.particleDurability[idx]  = profile.toughness;
    world.respawnDelayTicks[idx]   = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.isTransientFlag[idx]     = 1;
    world.weaveSlotId[idx]         = 0;
  }
}
