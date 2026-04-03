import { WorldState, MAX_PARTICLES } from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { RngState, nextFloat, nextFloatRange } from '../sim/rng';
import { PlayerWeaveLoadout, WEAVE_SLOT_PRIMARY, WEAVE_SLOT_SECONDARY } from '../sim/weaves/playerLoadout';

/** Total particles spawned for the player cluster — distributed across loadout kinds. */
export const PARTICLE_COUNT_PER_CLUSTER = 20;
/** Number of background Fluid particles filling the entire arena. */
export const BACKGROUND_FLUID_COUNT = 300;

/** Boss clusters receive this multiplier on their base HP for extra durability. */
export const BOSS_HP_MULTIPLIER = 2;

/** Initial player health (HP). */
export const PLAYER_INITIAL_HEALTH = 10;
/** Number of particles per dust container for armor calculation. */
export const DUST_PARTICLES_PER_CONTAINER = 4;

/**
 * Spawns `count` particles of `kind` orbiting the given cluster position.
 * Sets all new particle buffer fields including anchor, lifetime, and noise seed.
 */
export function spawnClusterParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  kind: ParticleKind,
  count: number,
  rng: RngState,
): void {
  const profile = getElementProfile(kind);

  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;

    // Evenly-spaced anchor angles with a small random offset
    const baseAngleRad = (i / count) * Math.PI * 2;
    const jitter = nextFloatRange(rng, -0.3, 0.3);
    const anchorAngleRad = baseAngleRad + jitter;

    const radiusVariance = profile.orbitRadiusWorld * 0.25;
    const anchorRadius   = profile.orbitRadiusWorld
      + nextFloatRange(rng, -radiusVariance, radiusVariance);

    // Spawn position at anchor target
    world.positionXWorld[idx] = clusterXWorld + Math.cos(anchorAngleRad) * anchorRadius;
    world.positionYWorld[idx] = clusterYWorld + Math.sin(anchorAngleRad) * anchorRadius;

    const spawnSpeed = 15.0;
    world.velocityXWorld[idx] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);
    world.velocityYWorld[idx] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);

    world.forceX[idx]            = 0;
    world.forceY[idx]            = 0;
    world.massKg[idx]            = profile.massKg;
    world.chargeUnits[idx]       = 0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = kind;
    world.ownerEntityId[idx]     = clusterEntityId;
    world.anchorAngleRad[idx]    = anchorAngleRad;
    world.anchorRadiusWorld[idx] = anchorRadius;

    // Stagger initial age so particles don't all respawn simultaneously
    const ageOffsetTicks = nextFloatRange(rng, 0, profile.lifetimeBaseTicks);
    const lifetimeVariance = nextFloatRange(
      rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks,
    );
    world.lifetimeTicks[idx] = Math.max(2.0, profile.lifetimeBaseTicks + lifetimeVariance);
    world.ageTicks[idx]      = ageOffsetTicks;

    // Unique per-particle noise phase so particles don't all jitter in unison
    world.noiseTickSeed[idx] = (nextFloat(rng) * 0xffffffff) >>> 0;

    world.behaviorMode[idx]        = 0;
    world.particleDurability[idx]  = profile.toughness;
    world.respawnDelayTicks[idx]   = 0;
    world.attackModeTicksLeft[idx] = 0;
  }
}

/**
 * Distributes `totalCount` particles across the kinds in `loadout`,
 * spreading them as evenly as possible.
 */
export function spawnLoadoutParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  loadout: ParticleKind[],
  totalCount: number,
  rng: RngState,
): void {
  if (loadout.length === 0) {
    // Empty loadout — spawn no particles (brand new profile with nothing)
    return;
  }

  const baseCount = Math.floor(totalCount / loadout.length);
  let remainder   = totalCount - baseCount * loadout.length;

  for (let k = 0; k < loadout.length; k++) {
    const extraCount = remainder > 0 ? 1 : 0;
    remainder -= extraCount;
    spawnClusterParticles(
      world,
      clusterEntityId,
      clusterXWorld,
      clusterYWorld,
      loadout[k],
      baseCount + extraCount,
      rng,
    );
  }
}

/**
 * Spawns particles for a Weave loadout, assigning weaveSlotId to each particle
 * based on which Weave binding owns the dust type.
 */
export function spawnWeaveLoadoutParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  weaveLoadout: PlayerWeaveLoadout,
  totalCount: number,
  rng: RngState,
): void {
  // Collect all dust from both bindings
  const allDust = [...weaveLoadout.primary.boundDust, ...weaveLoadout.secondary.boundDust];
  if (allDust.length === 0) {
    return;
  }

  // Distribute totalCount across all bound dust types
  const baseCount = Math.floor(totalCount / allDust.length);
  let remainder = totalCount - baseCount * allDust.length;

  // Track the particle index range for each dust entry so we can assign weave slots
  const primaryCount = weaveLoadout.primary.boundDust.length;

  for (let k = 0; k < allDust.length; k++) {
    const extraCount = remainder > 0 ? 1 : 0;
    remainder -= extraCount;
    const count = baseCount + extraCount;

    const startIdx = world.particleCount;
    spawnClusterParticles(world, clusterEntityId, clusterXWorld, clusterYWorld, allDust[k], count, rng);
    const endIdx = world.particleCount;

    // Assign weave slot based on which binding this dust came from
    const weaveSlot = k < primaryCount ? WEAVE_SLOT_PRIMARY : WEAVE_SLOT_SECONDARY;
    for (let i = startIdx; i < endIdx; i++) {
      world.weaveSlotId[i] = weaveSlot;
    }
  }
}

/**
 * Scatters `count` background Fluid particles randomly across the world area.
 */
export function spawnBackgroundFluidParticles(
  world: WorldState,
  count: number,
  rng: RngState,
): void {
  const profile = getElementProfile(ParticleKind.Fluid);

  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;

    world.positionXWorld[idx] = nextFloat(rng) * world.worldWidthWorld;
    world.positionYWorld[idx] = nextFloat(rng) * world.worldHeightWorld;
    world.velocityXWorld[idx] = 0.0;
    world.velocityYWorld[idx] = 0.0;
    world.forceX[idx]            = 0.0;
    world.forceY[idx]            = 0.0;
    world.massKg[idx]            = profile.massKg;
    world.chargeUnits[idx]       = 0.0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = ParticleKind.Fluid;
    world.ownerEntityId[idx]     = -1;
    world.anchorAngleRad[idx]    = 0.0;
    world.anchorRadiusWorld[idx] = 0.0;
    world.disturbanceFactor[idx] = 0.0;

    const lifetimeVariance = nextFloatRange(rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks);
    world.lifetimeTicks[idx] = Math.max(2.0, profile.lifetimeBaseTicks + lifetimeVariance);
    world.ageTicks[idx]      = nextFloat(rng) * profile.lifetimeBaseTicks;

    world.noiseTickSeed[idx] = (nextFloat(rng) * 0xffffffff) >>> 0;
  }
}
