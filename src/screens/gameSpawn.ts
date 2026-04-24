import { WorldState, MAX_PARTICLES, MAX_SQUARE_STAMPEDE } from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { RngState, nextFloat, nextFloatRange } from '../sim/rng';
import { PlayerWeaveLoadout, WEAVE_SLOT_PRIMARY, WEAVE_SLOT_SECONDARY } from '../sim/weaves/playerLoadout';
import type { RoomEnemyDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { createClusterState } from '../sim/clusters/state';
import { SLIME_HALF_SIZE_WORLD, LARGE_SLIME_HALF_SIZE_WORLD } from '../sim/clusters/slimeAi';
import { WHEEL_ENEMY_HALF_SIZE_WORLD } from '../sim/clusters/wheelEnemyAi';
import { BEETLE_HALF_SIZE_WORLD } from '../sim/clusters/beetleAi';
import { BUBBLE_HALF_SIZE_WORLD, WATER_BUBBLE_REGEN_INTERVAL_TICKS } from '../sim/clusters/bubbleAi';
import { SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD, SQUARE_STAMPEDE_LAYER_COUNT, TRAIL_UPDATE_INTERVAL_TICKS } from '../sim/clusters/squareStampedeAi';
import { GOLDEN_MIMIC_HALF_WIDTH_WORLD, GOLDEN_MIMIC_HALF_HEIGHT_WORLD } from '../sim/clusters/goldenMimicAi';
import { FLYING_EYE_HALF_SIZE_WORLD } from './gameRoom';

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

// ── Dust pile particle spawning ──────────────────────────────────────────────

/** Near-permanent lifetime for dust pile particles — they persist until claimed. */
const DUST_PILE_PARTICLE_LIFETIME_TICKS = 99999;

/**
 * Spawns unowned Gold Dust particles scattered around a dust pile position.
 * These persist until claimed by the Storm Weave.
 */
export function spawnDustPileParticles(
  world: WorldState,
  xWorld: number,
  yWorld: number,
  count: number,
  rng: RngState,
): void {
  const profile = getElementProfile(ParticleKind.Physical);
  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;
    world.positionXWorld[idx] = xWorld + nextFloatRange(rng, -4, 4);
    world.positionYWorld[idx] = yWorld + nextFloatRange(rng, -2, 0);
    world.velocityXWorld[idx] = 0;
    world.velocityYWorld[idx] = 0;
    world.forceX[idx] = 0;
    world.forceY[idx] = 0;
    world.massKg[idx] = profile.massKg;
    world.chargeUnits[idx] = 0;
    world.isAliveFlag[idx] = 1;
    world.kindBuffer[idx] = ParticleKind.Physical;
    world.ownerEntityId[idx] = -1;
    world.anchorAngleRad[idx] = 0;
    world.anchorRadiusWorld[idx] = 0;
    world.lifetimeTicks[idx] = DUST_PILE_PARTICLE_LIFETIME_TICKS;
    world.ageTicks[idx] = 0;
    world.noiseTickSeed[idx] = (nextFloat(rng) * 0xffffffff) >>> 0;
    world.behaviorMode[idx] = 0;
    world.particleDurability[idx] = profile.toughness;
    world.respawnDelayTicks[idx] = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.disturbanceFactor[idx] = 0;
    world.isTransientFlag[idx] = 1;
    world.weaveSlotId[idx] = 0;
  }
}

// ── Enemy cluster initialisation ─────────────────────────────────────────────

/** Initial hop delay for slime enemies (ticks). */
export const SLIME_HOP_INTERVAL_INITIAL_TICKS = 30;
/** Initial hop delay for large slime enemies (ticks). */
export const LARGE_SLIME_HOP_INTERVAL_INITIAL_TICKS = 45;

/**
 * Creates and pushes enemy `ClusterState` objects from `enemyDefs` into
 * `world.clusters`, spawning their particle loadout with `spawnLoadoutParticles`.
 *
 * @param world           Mutable world state — clusters and particles are appended.
 * @param enemyDefs       Array of enemy definitions from the room.
 * @param startEntityId   First entity ID to assign (typically 2; 1 is the player).
 * @param levelRng        Seeded RNG for deterministic particle placement.
 * @returns The next unused entity ID after all enemies have been assigned.
 */
export function spawnEnemyClusters(
  world: WorldState,
  enemyDefs: readonly RoomEnemyDef[],
  startEntityId: number,
  levelRng: RngState,
): number {
  let nextEntityId = startEntityId;
  for (let ei = 0; ei < enemyDefs.length; ei++) {
    const enemyDef = enemyDefs[ei];
    const ex = enemyDef.xBlock * BLOCK_SIZE_MEDIUM;
    const ey = enemyDef.yBlock * BLOCK_SIZE_MEDIUM;
    const hp = enemyDef.isBossFlag === 1 ? enemyDef.particleCount * BOSS_HP_MULTIPLIER : enemyDef.particleCount;
    const enemyCluster = createClusterState(nextEntityId++, ex, ey, 0, hp);

    if (enemyDef.isFlyingEyeFlag === 1) {
      enemyCluster.isFlyingEyeFlag     = 1;
      enemyCluster.flyingEyeElementKind = enemyDef.kinds.length > 0
        ? enemyDef.kinds[0]
        : ParticleKind.Wind;
      enemyCluster.halfWidthWorld  = FLYING_EYE_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld = FLYING_EYE_HALF_SIZE_WORLD;
    } else if (enemyDef.isRollingEnemyFlag === 1) {
      enemyCluster.isRollingEnemyFlag      = 1;
      enemyCluster.rollingEnemySpriteIndex = enemyDef.rollingEnemySpriteIndex ?? 1;
      enemyCluster.rollingEnemyRollAngleRad = 0;
    } else if (enemyDef.isRockElementalFlag === 1) {
      enemyCluster.isRockElementalFlag        = 1;
      enemyCluster.rockElementalSpawnXWorld   = ex;
      enemyCluster.rockElementalSpawnYWorld   = ey;
      enemyCluster.rockElementalState         = 0;
      enemyCluster.halfWidthWorld  = 4.5;
      enemyCluster.halfHeightWorld = 4.5;
    } else if (enemyDef.isRadiantTetherFlag === 1) {
      enemyCluster.isRadiantTetherFlag = 1;
      enemyCluster.radiantTetherState  = 0;
      enemyCluster.halfWidthWorld  = 6.0;
      enemyCluster.halfHeightWorld = 6.0;
    } else if (enemyDef.isGrappleHunterFlag === 1) {
      enemyCluster.isGrappleHunterFlag  = 1;
      enemyCluster.grappleHunterState   = 0;
      enemyCluster.halfWidthWorld  = 5.0;
      enemyCluster.halfHeightWorld = 5.0;
    } else if (enemyDef.isSlimeFlag === 1) {
      enemyCluster.isSlimeFlag          = 1;
      enemyCluster.halfWidthWorld       = SLIME_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld      = SLIME_HALF_SIZE_WORLD;
      enemyCluster.slimeHopTimerTicks   = SLIME_HOP_INTERVAL_INITIAL_TICKS;
    } else if (enemyDef.isLargeSlimeFlag === 1) {
      enemyCluster.isLargeSlimeFlag     = 1;
      enemyCluster.halfWidthWorld       = LARGE_SLIME_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld      = LARGE_SLIME_HALF_SIZE_WORLD;
      enemyCluster.slimeHopTimerTicks   = LARGE_SLIME_HOP_INTERVAL_INITIAL_TICKS;
    } else if (enemyDef.isWheelEnemyFlag === 1) {
      enemyCluster.isWheelEnemyFlag = 1;
      enemyCluster.halfWidthWorld   = WHEEL_ENEMY_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld  = WHEEL_ENEMY_HALF_SIZE_WORLD;
    } else if (enemyDef.isBeetleFlag === 1) {
      enemyCluster.isBeetleFlag              = 1;
      enemyCluster.halfWidthWorld            = BEETLE_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld           = BEETLE_HALF_SIZE_WORLD;
      // Start in a crawl state; AI will pick the first real state on the first tick.
      enemyCluster.beetleAiState             = 2; // idle briefly so it lands on a surface first
      enemyCluster.beetleAiStateTicks        = 30;
      enemyCluster.beetleSurfaceNormalXWorld = 0;
      enemyCluster.beetleSurfaceNormalYWorld = -1; // assume floor initially
      enemyCluster.beetleIsFlightModeFlag    = 0;
      enemyCluster.beetlePrevHealthPoints    = enemyCluster.healthPoints;
    } else if (enemyDef.isBubbleEnemyFlag === 1) {
      enemyCluster.isBubbleEnemyFlag      = 1;
      enemyCluster.isIceBubbleFlag        = (enemyDef.isIceBubbleFlag ?? 0) as 0 | 1;
      enemyCluster.halfWidthWorld         = BUBBLE_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld        = BUBBLE_HALF_SIZE_WORLD;
      enemyCluster.bubbleState            = 0;
      enemyCluster.bubbleMaxParticleCount = enemyDef.particleCount;
      enemyCluster.bubbleOrbitAngleRad    = 0;
      enemyCluster.bubbleRegenTicks       = WATER_BUBBLE_REGEN_INTERVAL_TICKS;
      enemyCluster.bubbleDriftPhaseRad    = 0;
      enemyCluster.bubblePrevHealthPoints = enemyCluster.healthPoints;
    } else if (enemyDef.isSquareStampedeFlag === 1) {
      // Allocate a trail ring-buffer slot for this enemy
      let slotIndex = -1;
      for (let si = 0; si < MAX_SQUARE_STAMPEDE; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].squareStampedeSlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) {
          slotIndex = si;
          // Clear the slot's trail data
          const base = si * world.squareStampedeTrailStride;
          world.squareStampedeTrailXWorld.fill(0, base, base + world.squareStampedeTrailStride);
          world.squareStampedeTrailYWorld.fill(0, base, base + world.squareStampedeTrailStride);
          world.squareStampedeTrailHead[si]  = 0;
          world.squareStampedeTrailCount[si] = 0;
          break;
        }
      }
      enemyCluster.isSquareStampedeFlag            = 1;
      enemyCluster.squareStampedeSlotIndex         = slotIndex;
      enemyCluster.squareStampedeBaseHalfSizeWorld = SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD;
      enemyCluster.halfWidthWorld                  = SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld                 = SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD;
      enemyCluster.healthPoints                    = SQUARE_STAMPEDE_LAYER_COUNT;
      enemyCluster.maxHealthPoints                 = SQUARE_STAMPEDE_LAYER_COUNT;
      enemyCluster.squareStampedeAiState           = 0;
      enemyCluster.squareStampedeAiStateTicks      = 20;
      enemyCluster.squareStampedeTrailTimerTicks   = TRAIL_UPDATE_INTERVAL_TICKS;
    } else if (enemyDef.isGoldenMimicFlag === 1) {
      const isYFlipped = enemyDef.isGoldenMimicYFlippedFlag === 1;
      enemyCluster.isGoldenMimicFlag         = 1;
      enemyCluster.isGoldenMimicYFlippedFlag = isYFlipped ? 1 : 0;
      enemyCluster.halfWidthWorld            = GOLDEN_MIMIC_HALF_WIDTH_WORLD;
      enemyCluster.halfHeightWorld           = GOLDEN_MIMIC_HALF_HEIGHT_WORLD;
      enemyCluster.goldenMimicState          = 0;
      enemyCluster.goldenMimicStateTicks     = 0;
      enemyCluster.goldenMimicFadeAlpha      = 1.0;
      // goldenMimicInitialParticleCount is filled in after spawnLoadoutParticles below
    }

    world.clusters.push(enemyCluster);
    const particleStartIdx = world.particleCount;
    spawnLoadoutParticles(world, enemyCluster.entityId, ex, ey, enemyDef.kinds, enemyDef.particleCount, levelRng);

    // Post-spawn: mark golden mimic particles as non-regenerating (isTransientFlag=1)
    // and record initial particle count for half-dead threshold detection.
    if (enemyCluster.isGoldenMimicFlag === 1) {
      const spawnedCount = world.particleCount - particleStartIdx;
      enemyCluster.goldenMimicInitialParticleCount = spawnedCount;
      enemyCluster.healthPoints    = spawnedCount;
      enemyCluster.maxHealthPoints = spawnedCount;
      for (let pi = particleStartIdx; pi < world.particleCount; pi++) {
        world.isTransientFlag[pi] = 1;
      }
    }
  }
  return nextEntityId;
}
