import {
  WorldState,
  MAX_SQUARE_STAMPEDE,
  MAX_BEE_SWARMS,
  BEES_PER_SWARM,
  MAX_DUST_CONSTELLATIONS,
  MAX_MOTES_PER_CONSTELLATION,
  MAX_ORBITAL_DUST_CORES,
  MOTES_PER_ODC_SLOT,
  MAX_DUST_BLOCK_MIMICS,
  MAX_DUST_WEAVER_ARCHITECTS,
  MAX_MOTES_PER_DWA,
  MAX_VOID_SINGULARITIES,
  MAX_MOTES_PER_VS,
  MAX_PROJS_PER_VSP,
} from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { RngState } from '../sim/rng';
import type { RoomEnemyDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { createClusterState } from '../sim/clusters/state';
import { SLIME_HALF_SIZE_WORLD, LARGE_SLIME_HALF_SIZE_WORLD } from '../sim/clusters/slimeAi';
import { WHEEL_ENEMY_HALF_SIZE_WORLD } from '../sim/clusters/wheelEnemyAi';
import { BEETLE_HALF_HEIGHT_WORLD, BEETLE_HALF_WIDTH_WORLD } from '../sim/clusters/beetleAi';
import { BUBBLE_HALF_SIZE_WORLD, WATER_BUBBLE_REGEN_INTERVAL_TICKS } from '../sim/clusters/bubbleAi';
import {
  SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD,
  SQUARE_STAMPEDE_LAYER_COUNT,
  TRAIL_UPDATE_INTERVAL_TICKS,
} from '../sim/clusters/squareStampedeAi';
import { GOLDEN_MIMIC_HALF_WIDTH_WORLD, GOLDEN_MIMIC_HALF_HEIGHT_WORLD } from '../sim/clusters/goldenMimicAi';
import { getGridBlockFootprintSize, GRID_BLOCK_HALF_SIZE } from '../sim/clusters/gridBlockEnemyAi';
import { BEE_HALF_WIDTH_WORLD, BEE_HALF_HEIGHT_WORLD } from '../sim/clusters/beeSwarmAi';
import {
  DC_SMALL_HP,
  DC_LARGE_HP,
  DC_HIT_RADIUS_WORLD,
  DC_ATTACK_COOLDOWN_TICKS,
} from '../sim/clusters/dustConstellationConfig';
import { DC_STATE_IDLE } from '../sim/clusters/dustConstellationAi';
import {
  ODC_SMALL_RING_COUNT,
  ODC_LARGE_RING_COUNT,
  ODC_SMALL_MOTES_PER_RING,
  ODC_LARGE_MOTES_PER_RING,
  ODC_SMALL_RING_RADII,
  ODC_LARGE_RING_RADII,
  ODC_SMALL_RING_HEALTH,
  ODC_LARGE_RING_HEALTH,
  ODC_SMALL_CORE_HP,
  ODC_LARGE_CORE_HP,
  ODC_CORE_HIT_RADIUS_WORLD,
  ODC_ATTACK_COOLDOWN_TICKS,
  MAX_MOTES_PER_RING_ODC,
} from '../sim/clusters/orbitalDustCoreConfig';
import { ODC_STATE_IDLE } from '../sim/clusters/orbitalDustCoreAi';
import {
  DBM_SMALL_HP,
  DBM_LARGE_HP,
  DBM_SMALL_BLOCK_HALF_W,
  DBM_LARGE_BLOCK_HALF_W,
  DBM_SMALL_BLOCK_HALF_H,
  DBM_LARGE_BLOCK_HALF_H,
  DBM_SMALL_MOTE_COUNT,
  DBM_LARGE_MOTE_COUNT,
  DBM_SMALL_FORMATION_X,
  DBM_SMALL_FORMATION_Y,
  DBM_LARGE_FORMATION_X,
  DBM_LARGE_FORMATION_Y,
  MAX_MOTES_PER_DBM,
} from '../sim/clusters/dustBlockMimicConfig';
import { DBM_STATE_DORMANT } from '../sim/clusters/dustBlockMimicAi';
import {
  DWA_SMALL_HP,
  DWA_LARGE_HP,
  DWA_HALF_W,
  DWA_HALF_H,
  DWA_SMALL_MOTE_COUNT,
  DWA_LARGE_MOTE_COUNT,
  DWA_BUILD_COOLDOWN_TICKS,
} from '../sim/clusters/dustWeaverArchitectConfig';
import { DWA_STATE_IDLE } from '../sim/clusters/dustWeaverArchitectAi';
import {
  VS_HP,
  VSP_HP,
  VS_HALF_W,
  VS_HALF_H,
  VS_MOTE_START_RADIUS_WORLD,
} from '../sim/clusters/voidSingularityConfig';
import { VS_STATE_IDLE as VS_IDLE } from '../sim/clusters/voidSingularityAi';
import {
  DL_HP,
  DL_HALF_W,
  DL_HALF_H,
  MAX_DUST_LEECHES,
  MAX_MOTES_PER_DL,
} from '../sim/clusters/dustLeechConfig';
import { DL_STATE_IDLE as DL_IDLE } from '../sim/clusters/dustLeechAi';
import { WEB_SPIDER_HALF_SIZE_WORLD } from '../sim/clusters/webSpiderAi';
import {
  BIG_SNAKE_HALF_HEIGHT_WORLD,
  BIG_SNAKE_HALF_WIDTH_WORLD,
  BIG_SNAKE_HP,
  NEEDLE_SNAKE_HALF_HEIGHT_WORLD,
  NEEDLE_SNAKE_HALF_WIDTH_WORLD,
  NEEDLE_SNAKE_HP,
  initializeSnakeSegments,
} from '../sim/clusters/snakeAi';
import { FLYING_EYE_HALF_SIZE_WORLD } from './gameRoom';
import { spawnLoadoutParticles } from './gameSpawn';

/** Boss clusters receive this multiplier on their base HP for extra durability. */
export const BOSS_HP_MULTIPLIER = 2;

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
    } else if (enemyDef.isRadiantWebFlag === 1) {
      enemyCluster.isRadiantWebFlag = 1;
      enemyCluster.radiantWebState  = 0;
      enemyCluster.halfWidthWorld   = 6.0;
      enemyCluster.halfHeightWorld  = 6.0;
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
      enemyCluster.halfWidthWorld            = BEETLE_HALF_WIDTH_WORLD;
      enemyCluster.halfHeightWorld           = BEETLE_HALF_HEIGHT_WORLD;
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
    } else if (enemyDef.isWallSnakeFlag === 1) {
      enemyCluster.isWallSnakeFlag          = 1;
      enemyCluster.halfWidthWorld           = BIG_SNAKE_HALF_WIDTH_WORLD;
      enemyCluster.halfHeightWorld          = BIG_SNAKE_HALF_HEIGHT_WORLD;
      enemyCluster.healthPoints             = BIG_SNAKE_HP;
      enemyCluster.maxHealthPoints          = BIG_SNAKE_HP;
      enemyCluster.snakeAiState             = 0;
      enemyCluster.snakeAiStateTicks        = 0;
      enemyCluster.snakeRepathCooldownTicks = 0;
      enemyCluster.snakeIsOnWallFlag        = 0;
      enemyCluster.snakeHeadDirXWorld       = 1;
      enemyCluster.snakeHeadDirYWorld       = 0;
      enemyCluster.snakeSlitherPhaseRad     = 0;
      enemyCluster.snakeSpawnXWorld         = ex;
      enemyCluster.snakeSpawnYWorld         = ey;
      initializeSnakeSegments(enemyCluster.entityId, ex, ey, 18, 5.5, 1, 0);
    } else if (enemyDef.isNeedleSnakeFlag === 1) {
      enemyCluster.isNeedleSnakeFlag        = 1;
      enemyCluster.halfWidthWorld           = NEEDLE_SNAKE_HALF_WIDTH_WORLD;
      enemyCluster.halfHeightWorld          = NEEDLE_SNAKE_HALF_HEIGHT_WORLD;
      enemyCluster.healthPoints             = NEEDLE_SNAKE_HP;
      enemyCluster.maxHealthPoints          = NEEDLE_SNAKE_HP;
      enemyCluster.snakeAiState             = 0;
      enemyCluster.snakeAiStateTicks        = 0;
      enemyCluster.snakeRepathCooldownTicks = 0;
      enemyCluster.snakeIsOnWallFlag        = 0;
      enemyCluster.snakeHeadDirXWorld       = 1;
      enemyCluster.snakeHeadDirYWorld       = 0;
      enemyCluster.snakeSlitherPhaseRad     = 0;
      enemyCluster.snakeSpawnXWorld         = ex;
      enemyCluster.snakeSpawnYWorld         = ey;
      initializeSnakeSegments(enemyCluster.entityId, ex, ey, 14, 3.5, 1, 0);
    } else if (enemyDef.isBeeSwarmFlag === 1) {
      // Allocate a bee-swarm slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_BEE_SWARMS; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].beeSwarmSlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      enemyCluster.isBeeSwarmFlag       = 1;
      enemyCluster.beeSwarmSlotIndex    = slotIndex;
      enemyCluster.halfWidthWorld       = BEE_HALF_WIDTH_WORLD;
      enemyCluster.halfHeightWorld      = BEE_HALF_HEIGHT_WORLD;
      enemyCluster.healthPoints         = BEES_PER_SWARM;
      enemyCluster.maxHealthPoints      = BEES_PER_SWARM;
      enemyCluster.beeSwarmSpawnXWorld  = ex;
      enemyCluster.beeSwarmSpawnYWorld  = ey;
      enemyCluster.beeSwarmState        = 0;
      enemyCluster.beeSwarmStateTicks   = 0;
      enemyCluster.beeSwarmPrevHealthPoints = BEES_PER_SWARM;
      enemyCluster.beeSwarmOrbitAngleRad    = 0;

      // Initialise individual bee positions in a ring around the spawn point
      if (slotIndex >= 0) {
        const base = slotIndex * BEES_PER_SWARM;
        for (let bi = 0; bi < BEES_PER_SWARM; bi++) {
          const phase = (bi / BEES_PER_SWARM) * Math.PI * 2;
          world.beeSwarmBeePhaseRad[base + bi]  = phase;
          world.beeSwarmBeeXWorld[base + bi]    = ex + Math.cos(phase) * 20;
          world.beeSwarmBeeYWorld[base + bi]    = ey + Math.sin(phase) * 12;
          world.beeSwarmBeeVelXWorld[base + bi] = 0;
          world.beeSwarmBeeVelYWorld[base + bi] = 0;
        }
      }
    } else if (enemyDef.isWebSpiderFlag === 1) {
      enemyCluster.isWebSpiderFlag            = 1;
      enemyCluster.halfWidthWorld             = WEB_SPIDER_HALF_SIZE_WORLD;
      enemyCluster.halfHeightWorld            = WEB_SPIDER_HALF_SIZE_WORLD;
      enemyCluster.healthPoints               = 4;
      enemyCluster.maxHealthPoints            = 4;
      enemyCluster.webSpiderState             = 0;
      enemyCluster.webSpiderStateTicks        = 0;
      enemyCluster.webSpiderAnchorXWorld      = 0;
      enemyCluster.webSpiderAnchorYWorld      = 0;
      enemyCluster.webSpiderRopeLengthWorld   = 0;
      enemyCluster.webSpiderCooldownTicks     = 0;
      enemyCluster.webSpiderAnchorSearchTicks = 0;
    } else if (enemyDef.isDustConstellationFlag === 1) {
      // Allocate a constellation slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_DUST_CONSTELLATIONS; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].dustConstellationSlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      const isLarge = (enemyDef.isDustConstellationLargeFlag ?? 0) as 0 | 1;
      const hp = isLarge === 1 ? DC_LARGE_HP : DC_SMALL_HP;

      enemyCluster.isDustConstellationFlag        = 1;
      enemyCluster.isDustConstellationLargeFlag   = isLarge;
      enemyCluster.dustConstellationSlotIndex     = slotIndex;
      enemyCluster.dustConstellationState         = DC_STATE_IDLE;
      enemyCluster.dustConstellationStateTicks    = 0;
      enemyCluster.dustConstellationAttackCooldownTicks = DC_ATTACK_COOLDOWN_TICKS;
      enemyCluster.dustConstellationPatternIndex  = 0;
      enemyCluster.dustConstellationActiveBeamIndex = 0;
      enemyCluster.dustConstellationSpawnXWorld   = ex;
      enemyCluster.dustConstellationSpawnYWorld   = ey;
      enemyCluster.dustConstellationBobPhaseRad   = 0;
      enemyCluster.halfWidthWorld                 = DC_HIT_RADIUS_WORLD;
      enemyCluster.halfHeightWorld                = DC_HIT_RADIUS_WORLD;
      enemyCluster.healthPoints                   = hp;
      enemyCluster.maxHealthPoints                = hp;

      // Initialise mote positions in a ring around the spawn point
      if (slotIndex >= 0) {
        const moteCount = isLarge === 1 ? 10 : 6;
        const base = slotIndex * MAX_MOTES_PER_CONSTELLATION;
        for (let mi = 0; mi < moteCount; mi++) {
          const phase = (mi / moteCount) * Math.PI * 2;
          const r     = 16.0;
          world.constellationMoteXWorld[base + mi]        = ex + Math.cos(phase) * r;
          world.constellationMoteYWorld[base + mi]        = ey + Math.sin(phase) * r * 0.6;
          world.constellationMoteVelXWorld[base + mi]     = 0;
          world.constellationMoteVelYWorld[base + mi]     = 0;
          world.constellationMoteTargetLocalX[base + mi]  = Math.cos(phase) * r;
          world.constellationMoteTargetLocalY[base + mi]  = Math.sin(phase) * r * 0.6;
          world.constellationMotePulsePhaseRad[base + mi] = phase;
        }
      }
    } else if (enemyDef.isOrbitalDustCoreFlag === 1) {
      // Allocate an ODC slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_ORBITAL_DUST_CORES; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].orbitalDustCoreSlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      const isLarge = (enemyDef.isOrbitalDustCoreLargeFlag ?? 0) as 0 | 1;
      const ringCount  = isLarge === 1 ? ODC_LARGE_RING_COUNT : ODC_SMALL_RING_COUNT;
      const mprArr     = isLarge === 1 ? ODC_LARGE_MOTES_PER_RING : ODC_SMALL_MOTES_PER_RING;
      const radiiArr   = isLarge === 1 ? ODC_LARGE_RING_RADII : ODC_SMALL_RING_RADII;
      const healthArr  = isLarge === 1 ? ODC_LARGE_RING_HEALTH : ODC_SMALL_RING_HEALTH;
      const coreHp     = isLarge === 1 ? ODC_LARGE_CORE_HP : ODC_SMALL_CORE_HP;

      enemyCluster.isOrbitalDustCoreFlag           = 1;
      enemyCluster.isOrbitalDustCoreLargeFlag       = isLarge;
      enemyCluster.orbitalDustCoreSlotIndex         = slotIndex;
      enemyCluster.orbitalDustCoreState             = ODC_STATE_IDLE;
      enemyCluster.orbitalDustCoreStateTicks        = 0;
      enemyCluster.orbitalDustCoreSpawnXWorld       = ex;
      enemyCluster.orbitalDustCoreSpawnYWorld       = ey;
      enemyCluster.orbitalDustCoreBobPhaseRad       = 0;
      enemyCluster.orbitalDustCoreAttackCooldownTicks = ODC_ATTACK_COOLDOWN_TICKS;
      enemyCluster.orbitalDustCoreExposedRing       = 0;
      enemyCluster.orbitalDustCoreRing0Health       = healthArr[0] ?? -1;
      enemyCluster.orbitalDustCoreRing1Health       = healthArr[1] ?? -1;
      enemyCluster.orbitalDustCoreRing2Health       = healthArr[2] ?? -1;
      enemyCluster.orbitalDustCoreRing3Health       = healthArr[3] ?? -1;
      enemyCluster.orbitalDustCorePulseRadius       = 0;
      enemyCluster.orbitalDustCorePulseActiveFlag   = 0;
      enemyCluster.orbitalDustCorePulseHitPlayerFlag = 0;
      enemyCluster.orbitalDustCoreShieldFlashTicks  = 0;
      enemyCluster.orbitalDustCoreCorePulseTicks    = 0;
      enemyCluster.halfWidthWorld                   = ODC_CORE_HIT_RADIUS_WORLD;
      enemyCluster.halfHeightWorld                  = ODC_CORE_HIT_RADIUS_WORLD;
      enemyCluster.healthPoints                     = coreHp;
      enemyCluster.maxHealthPoints                  = coreHp;

      // Initialise mote arrays: evenly-spaced angles per ring
      if (slotIndex >= 0) {
        for (let r = 0; r < ringCount; r++) {
          const mpr = mprArr[r];
          const radius = radiiArr[r];
          for (let m = 0; m < mpr; m++) {
            const idx = slotIndex * MOTES_PER_ODC_SLOT + r * MAX_MOTES_PER_RING_ODC + m;
            const angle = (m / mpr) * Math.PI * 2;
            world.odcMoteAngleRad[idx]      = angle;
            world.odcMoteRadiusWorld[idx]   = radius;
            world.odcMoteAliveFlag[idx]     = 1;
            world.odcMotePulsePhaseRad[idx] = angle;
          }
        }
      }
    } else if (enemyDef.isDustBlockMimicFlag === 1) {
      // Allocate a DBM slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_DUST_BLOCK_MIMICS; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].dustBlockMimicSlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      const isLarge = (enemyDef.isDustBlockMimicLargeFlag ?? 0) as 0 | 1;
      const hw = isLarge === 1 ? DBM_LARGE_BLOCK_HALF_W : DBM_SMALL_BLOCK_HALF_W;
      const hh = isLarge === 1 ? DBM_LARGE_BLOCK_HALF_H : DBM_SMALL_BLOCK_HALF_H;
      const hp = isLarge === 1 ? DBM_LARGE_HP : DBM_SMALL_HP;
      const moteCount = isLarge === 1 ? DBM_LARGE_MOTE_COUNT : DBM_SMALL_MOTE_COUNT;
      const formX = isLarge === 1 ? DBM_LARGE_FORMATION_X : DBM_SMALL_FORMATION_X;
      const formY = isLarge === 1 ? DBM_LARGE_FORMATION_Y : DBM_SMALL_FORMATION_Y;

      enemyCluster.isDustBlockMimicFlag               = 1;
      enemyCluster.isDustBlockMimicLargeFlag          = isLarge;
      enemyCluster.dustBlockMimicSlotIndex            = slotIndex;
      enemyCluster.dustBlockMimicState                = DBM_STATE_DORMANT;
      enemyCluster.dustBlockMimicStateTicks           = 0;
      enemyCluster.dustBlockMimicSpawnXWorld          = ex;
      enemyCluster.dustBlockMimicSpawnYWorld          = ey;
      enemyCluster.dustBlockMimicBobPhaseRad          = 0;
      enemyCluster.dustBlockMimicAttackCooldownTicks  = 0;
      enemyCluster.dustBlockMimicLungeDirXWorld       = 1;
      enemyCluster.dustBlockMimicLungeDirYWorld       = 0;
      enemyCluster.dustBlockMimicLungeDistCovered     = 0;
      enemyCluster.dustBlockMimicLungeHitPlayerFlag   = 0;
      enemyCluster.dustBlockMimicHitFlashTicks        = 0;
      enemyCluster.halfWidthWorld                     = hw;
      enemyCluster.halfHeightWorld                    = hh;
      enemyCluster.healthPoints                       = hp;
      enemyCluster.maxHealthPoints                    = hp;

      // Initialise mote positions at the spawn point
      if (slotIndex >= 0) {
        const base = slotIndex * MAX_MOTES_PER_DBM;
        for (let m = 0; m < moteCount; m++) {
          const idx = base + m;
          world.dbmMoteXWorld[idx]          = ex + formX[m] * hw;
          world.dbmMoteYWorld[idx]          = ey + formY[m] * hh;
          world.dbmMoteVelXWorld[idx]       = 0;
          world.dbmMoteVelYWorld[idx]       = 0;
          world.dbmMoteTargetLocalX[idx]    = formX[m] * hw * 0.85;
          world.dbmMoteTargetLocalY[idx]    = formY[m] * hh * 0.85;
          world.dbmMotePulsePhaseRad[idx]   = (m / moteCount) * Math.PI * 2;
        }
      }
    } else if (enemyDef.isDustWeaverArchitectFlag === 1) {
      // Allocate a DWA slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_DUST_WEAVER_ARCHITECTS; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].dustWeaverArchitectSlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      const isLarge = (enemyDef.isDustWeaverArchitectLargeFlag ?? 0) as 0 | 1;
      const hp       = isLarge === 1 ? DWA_LARGE_HP : DWA_SMALL_HP;
      const moteCount = isLarge === 1 ? DWA_LARGE_MOTE_COUNT : DWA_SMALL_MOTE_COUNT;

      enemyCluster.isDustWeaverArchitectFlag              = 1;
      enemyCluster.isDustWeaverArchitectLargeFlag         = isLarge;
      enemyCluster.dustWeaverArchitectSlotIndex           = slotIndex;
      enemyCluster.dustWeaverArchitectState               = DWA_STATE_IDLE;
      enemyCluster.dustWeaverArchitectStateTicks          = 0;
      enemyCluster.dustWeaverArchitectSpawnXWorld         = ex;
      enemyCluster.dustWeaverArchitectSpawnYWorld         = ey;
      enemyCluster.dustWeaverArchitectBobPhaseRad         = 0;
      enemyCluster.dustWeaverArchitectAttackCooldownTicks = DWA_BUILD_COOLDOWN_TICKS;
      enemyCluster.dustWeaverArchitectBuildSiteXWorld     = ex;
      enemyCluster.dustWeaverArchitectBuildSiteYWorld     = ey;
      enemyCluster.dustWeaverArchitectBuildPatternIndex   = 0;
      enemyCluster.dustWeaverArchitectHitFlashTicks       = 0;
      enemyCluster.halfWidthWorld                         = DWA_HALF_W;
      enemyCluster.halfHeightWorld                        = DWA_HALF_H;
      enemyCluster.healthPoints                           = hp;
      enemyCluster.maxHealthPoints                        = hp;

      // Initialise mote orbit angles
      if (slotIndex >= 0) {
        const base = slotIndex * MAX_MOTES_PER_DWA;
        for (let m = 0; m < moteCount; m++) {
          const mi = base + m;
          world.dwaMoteAngleRad[mi]      = (m / moteCount) * Math.PI * 2;
          world.dwaMotePulsePhaseRad[mi] = (m / moteCount) * Math.PI * 2;
        }
      }
    } else if (enemyDef.isVoidSingularityFlag === 1) {
      // Allocate a Void Singularity slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_VOID_SINGULARITIES; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].voidSingularitySlotIndex === si) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      const isPair = (enemyDef.isVoidSingularityPairFlag ?? 0) as 0 | 1;
      const hp     = isPair === 1 ? VSP_HP : VS_HP;

      enemyCluster.isVoidSingularityFlag         = 1;
      enemyCluster.isVoidSingularityPairFlag      = isPair;
      enemyCluster.voidSingularitySlotIndex       = slotIndex;
      enemyCluster.voidSingularityState           = VS_IDLE;
      enemyCluster.voidSingularityStateTicks      = 0;
      enemyCluster.voidSingularitySpawnXWorld     = ex;
      enemyCluster.voidSingularitySpawnYWorld     = ey;
      enemyCluster.voidSingularityBobPhaseRad     = 0;
      enemyCluster.voidSingularityAbsorbedEnergy  = 0;
      enemyCluster.voidSingularityPulseRadius     = 0;
      enemyCluster.voidSingularityPulseActiveFlag = 0;
      enemyCluster.voidSingularityPulseHitPlayerFlag = 0;
      enemyCluster.voidSingularityHitFlashTicks   = 0;
      enemyCluster.voidSingularityPairAngleRad    = 0;
      enemyCluster.voidSingularityWholeCharge     = 0;
      enemyCluster.voidSingularityWholeState      = 0;
      enemyCluster.voidSingularityWholeStateTicks = 0;
      enemyCluster.halfWidthWorld                 = VS_HALF_W;
      enemyCluster.halfHeightWorld                = VS_HALF_H;
      enemyCluster.healthPoints                   = hp;
      enemyCluster.maxHealthPoints                = hp;

      // Initialise mote positions
      if (slotIndex >= 0) {
        const base = slotIndex * MAX_MOTES_PER_VS;
        for (let m = 0; m < MAX_MOTES_PER_VS; m++) {
          const mi = base + m;
          world.vsMoteAngleRad[mi]      = (m / MAX_MOTES_PER_VS) * Math.PI * 2;
          world.vsMoteRadiusWorld[mi]   = VS_MOTE_START_RADIUS_WORLD + (m / MAX_MOTES_PER_VS) * 6.0;
          world.vsMotePulsePhaseRad[mi] = (m / MAX_MOTES_PER_VS) * Math.PI * 2;
        }
        // Clear projectile slots
        if (isPair === 1) {
          const projBase = slotIndex * MAX_PROJS_PER_VSP;
          for (let p = 0; p < MAX_PROJS_PER_VSP; p++) world.vspProjAliveFlag[projBase + p] = 0;
        }
      }
    } else if (enemyDef.isDustLeechFlag === 1) {
      // Allocate a Dust Leech slot
      let slotIndex = -1;
      for (let si = 0; si < MAX_DUST_LEECHES; si++) {
        let taken = false;
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].dustLeechSlotIndex === si && world.clusters[ci2].isDustLeechFlag === 1) {
            taken = true;
            break;
          }
        }
        if (!taken) { slotIndex = si; break; }
      }

      enemyCluster.isDustLeechFlag              = 1;
      enemyCluster.dustLeechState               = DL_IDLE;
      enemyCluster.dustLeechStateTicks          = 0;
      enemyCluster.dustLeechSlotIndex           = slotIndex;
      enemyCluster.dustLeechSpawnXWorld         = ex;
      enemyCluster.dustLeechSpawnYWorld         = ey;
      enemyCluster.dustLeechBobPhaseRad         = 0;
      enemyCluster.dustLeechSiphonCharge        = 0;
      enemyCluster.dustLeechAttackCooldownTicks = 0;
      enemyCluster.dustLeechHitFlashTicks       = 0;
      enemyCluster.halfWidthWorld               = DL_HALF_W;
      enemyCluster.halfHeightWorld              = DL_HALF_H;
      enemyCluster.healthPoints                 = DL_HP;
      enemyCluster.maxHealthPoints              = DL_HP;

      if (slotIndex >= 0) {
        const base = slotIndex * MAX_MOTES_PER_DL;
        for (let m = 0; m < MAX_MOTES_PER_DL; m++) {
          const mi = base + m;
          world.dlMoteAngleRad[mi]      = (m / MAX_MOTES_PER_DL) * Math.PI * 2;
          world.dlMotePulsePhaseRad[mi] = (m / MAX_MOTES_PER_DL) * Math.PI * 2;
        }
      }
    } else if (enemyDef.isGridBlockEnemyFlag === 1) {
      const sizeIndex  = enemyDef.gridBlockSizeIndex === 1 ? 1 : 0;
      const speedIndex = enemyDef.gridBlockSpeedIndex === 1 ? 1 : enemyDef.gridBlockSpeedIndex === 2 ? 2 : 0;
      const hw         = GRID_BLOCK_HALF_SIZE[sizeIndex];
      const bs         = BLOCK_SIZE_MEDIUM;
      const footprint  = getGridBlockFootprintSize(sizeIndex);
      const roomW      = Math.ceil(world.worldWidthWorld / bs);
      const roomH      = Math.ceil(world.worldHeightWorld / bs);
      const maxGridX   = Math.max(0, roomW - footprint.w);
      const maxGridY   = Math.max(0, roomH - footprint.h);

      // Snap spawn position to the nearest grid cell that keeps the full footprint in bounds.
      const gridX = Math.max(0, Math.min(maxGridX, Math.round((ex - hw) / bs)));
      const gridY = Math.max(0, Math.min(maxGridY, Math.round((ey - hw) / bs)));

      enemyCluster.isGridBlockEnemyFlag          = 1;
      enemyCluster.gridBlockSizeIndex            = sizeIndex;
      enemyCluster.gridBlockSpeedIndex           = speedIndex;
      enemyCluster.gridBlockGridX                = gridX;
      enemyCluster.gridBlockGridY                = gridY;
      enemyCluster.gridBlockTargetGridX          = gridX;
      enemyCluster.gridBlockTargetGridY          = gridY;
      enemyCluster.gridBlockMoveTicks            = 0;
      enemyCluster.gridBlockRepathCooldownTicks  = 0;
      enemyCluster.gridBlockNextDirX             = 0;
      enemyCluster.gridBlockNextDirY             = 0;
      enemyCluster.gridBlockGlintPhase           = 0;
      enemyCluster.gridBlockHitFlashTicks        = 0;
      enemyCluster.gridBlockPrevHealthPoints     = 6;
      enemyCluster.positionXWorld                = gridX * bs + hw;
      enemyCluster.positionYWorld                = gridY * bs + hw;
      enemyCluster.halfWidthWorld                = hw;
      enemyCluster.halfHeightWorld               = hw;
      enemyCluster.healthPoints                  = 6;
      enemyCluster.maxHealthPoints               = 6;
    }
    world.clusters.push(enemyCluster);
    const particleStartIdx = world.particleCount;
    // Radiant Tether and Radiant Web manage their own visuals — do not spawn a
    // particle loadout for them.  Their HP is still derived from particleCount.
    const skipParticleSpawn =
      enemyCluster.isRadiantTetherFlag === 1 ||
      enemyCluster.isRadiantWebFlag    === 1 ||
      enemyCluster.isDustConstellationFlag === 1 ||
      enemyCluster.isOrbitalDustCoreFlag === 1 ||
      enemyCluster.isDustBlockMimicFlag === 1 ||
      enemyCluster.isDustWeaverArchitectFlag === 1 ||
      enemyCluster.isVoidSingularityFlag === 1 ||
      enemyCluster.isDustLeechFlag === 1 ||
      enemyCluster.isGridBlockEnemyFlag === 1;
    if (!skipParticleSpawn) {
      spawnLoadoutParticles(world, enemyCluster.entityId, ex, ey, enemyDef.kinds, enemyDef.particleCount, levelRng);
    }

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
