/**
 * Inter-particle forces using the shared spatial grid.
 *
 * Two categories are handled in a single neighbor-query pass:
 *
 *  A) Same-owner pairs — boid-like forces for visual personality:
 *       • Cohesion   — slow pull toward the neighbor centroid
 *       • Separation — hard push away from very-close neighbors
 *       • Alignment  — gentle velocity matching
 *     Weights come from each particle's ElementProfile so, e.g.,
 *     ice particles cluster tightly while fire particles spread loosely.
 *
 *  B) Different-owner pairs — gameplay combat:
 *       • Repulsion  — push away within a range
 *       • Destruction on contact — both particles die, owner loses HP
 *
 * Special mechanics:
 *   • Metal (block mode=2): reflects incoming damage back to attacker.
 *   • Stone: shatters into small fragments on contact kill.
 *   • Lava: spawns short-lived fire trail particles when combat-killed.
 */

import { WorldState } from '../world';
import { createSpatialGrid, clearGrid, insertParticle, queryNeighbors } from '../spatial/grid';
import type { SpatialGrid } from '../spatial/grid';
import { getElementProfile } from './elementProfiles';
import { getElementalMultiplier } from './negation';
import { ParticleKind } from './kinds';
import { nextFloat } from '../rng';
import {
  _spawnStoneShards, _spawnLavaTrailFire,
  _spawnCrystalShards, _spawnPoisonCloud, _spawnChainLightning,
} from './elementEffectSpawners';
import { MAX_PARTICLES } from './state';
import { resetBoidAccumulators, accumulateBoidPair, applyBoidForces } from './boidForces';
import {
  resetEffectCounters,
  recordIceChillEvent, recordShadowKillEvent, recordWindScatterEvent,
  applyIceChillEffects, applyShadowLifestealEffects, applyWindScatterEffects,
  applyHolyHealingAura,
} from './elementEffectHandlers';

// Particle half-size: 1/6th of the player's full width (8 world units) divided by 2.
// Square hitbox side = 8/6 ≈ 1.333 wu; radius = side/2 ≈ 0.667 wu.
export const PARTICLE_RADIUS_WORLD = 4.0 / 6.0;

// ---- Spatial grid --------------------------------------------------------

const REPEL_RANGE_WORLD  = 20.0;
const CONTACT_DIST_WORLD = PARTICLE_RADIUS_WORLD * 2.0;

// Boid neighbor range — larger than repulsion so cohesion/alignment can act
// across a wider neighbourhood without requiring a second grid pass.
export const BOID_RANGE_WORLD = 36.0;

// Single grid covers the larger of the two query radii.
const GRID_CELL_SIZE = BOID_RANGE_WORLD * 2.0;

// Module-level singleton — allocated once, never per-frame.
const sharedSpatialGrid: SpatialGrid = createSpatialGrid(GRID_CELL_SIZE);

// Pre-allocated scratch for pending destruction (avoids mutation mid-loop)
const scratchDestroyA = new Int32Array(1024);
const scratchDestroyB = new Int32Array(1024);
let scratchDestroyCount = 0;

// Pre-allocated scratch for post-contact stone shatter events
const _shatterPosX  = new Float32Array(256);
const _shatterPosY  = new Float32Array(256);
const _shatterVelX  = new Float32Array(256);
const _shatterVelY  = new Float32Array(256);
const _shatterOwner = new Int32Array(256);
let _shatterCount   = 0;

// Pre-allocated scratch for post-contact lava trail fire spawns
const _lavaTrailPosX  = new Float32Array(64);
const _lavaTrailPosY  = new Float32Array(64);
const _lavaTrailOwner = new Int32Array(64);
let _lavaTrailCount   = 0;

// Pre-allocated scratch for crystal shard spawn events
const _crystalShardPosX  = new Float32Array(128);
const _crystalShardPosY  = new Float32Array(128);
const _crystalShardVelX  = new Float32Array(128);
const _crystalShardVelY  = new Float32Array(128);
const _crystalShardOwner = new Int32Array(128);
let _crystalShardCount = 0;

// Pre-allocated scratch for poison cloud spawn events
const _poisonCloudPosX  = new Float32Array(64);
const _poisonCloudPosY  = new Float32Array(64);
const _poisonCloudOwner = new Int32Array(64);
let _poisonCloudCount = 0;

// Pre-allocated scratch for chain lightning arc events
const _chainLightningPosX        = new Float32Array(32);
const _chainLightningPosY        = new Float32Array(32);
const _chainLightningKillerOwner = new Int32Array(32);
const _chainLightningVictimOwner = new Int32Array(32);
let _chainLightningCount = 0;

// ---- Main export --------------------------------------------------------

export function applyInterParticleForces(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    isAliveFlag, ownerEntityId, kindBuffer,
    particleCount, clusters,
    particleDurability, respawnDelayTicks, behaviorMode, isTransientFlag,
  } = world;

  // ---- Rebuild spatial grid -------------------------------------------
  clearGrid(sharedSpatialGrid);
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1) {
      insertParticle(sharedSpatialGrid, i, positionXWorld[i], positionYWorld[i]);
    }
  }

  // ---- Reset boid accumulators (trivial fill) -------------------------
  resetBoidAccumulators(particleCount);

  scratchDestroyCount = 0;

  // ---- Per-particle neighbour pass ------------------------------------
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const px = positionXWorld[i];
    const py = positionYWorld[i];
    const ownerI = ownerEntityId[i];
    const profileI = getElementProfile(kindBuffer[i]);

    const neighborCount = queryNeighbors(sharedSpatialGrid, px, py, BOID_RANGE_WORLD);

    for (let ni = 0; ni < neighborCount; ni++) {
      const j = sharedSpatialGrid.queryResult[ni];
      if (j <= i) continue;
      if (isAliveFlag[j] === 0) continue;

      const ownerJ = ownerEntityId[j];
      const dx = positionXWorld[j] - px;
      const dy = positionYWorld[j] - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < 0.0001) continue;
      const dist = Math.sqrt(distSq);

      if (ownerI !== ownerJ) {
        // ---- Different-owner interaction -----------------------------------
        // Fluid particles (background) are never destroyed on contact.
        // Their physical interaction is handled by the disturbance system.
        if (kindBuffer[i] === ParticleKind.Fluid || kindBuffer[j] === ParticleKind.Fluid) {
          continue;
        }

        // ---- Non-Fluid different-owner: repulsion + contact destruction ----
        if (dist < CONTACT_DIST_WORLD) {
          if (scratchDestroyCount < MAX_PARTICLES) {
            scratchDestroyA[scratchDestroyCount] = i;
            scratchDestroyB[scratchDestroyCount] = j;
            scratchDestroyCount++;
          }
          continue;
        }
        if (dist < REPEL_RANGE_WORLD) {
          // Void attack-mode particles pull enemies toward them (gravity well)
          // instead of pushing them away.
          const isVoidAttackingI = kindBuffer[i] === ParticleKind.Void && behaviorMode[i] === 1;
          const isVoidAttackingJ = kindBuffer[j] === ParticleKind.Void && behaviorMode[j] === 1;
          if (isVoidAttackingI || isVoidAttackingJ) {
            const force = 40.0 * (1.0 - dist / REPEL_RANGE_WORLD) / dist;
            const fx = dx * force;
            const fy = dy * force;
            if (isVoidAttackingI) {
              // i is Void: pull j toward i
              forceX[j] -= fx;
              forceY[j] -= fy;
            } else {
              // j is Void: pull i toward j
              forceX[i] += fx;
              forceY[i] += fy;
            }
          } else {
            const force = 50.0 * (1.0 - dist / REPEL_RANGE_WORLD) / dist;
            const fx = -dx * force;
            const fy = -dy * force;
            forceX[i] += fx;
            forceY[i] += fy;
            forceX[j] -= fx;
            forceY[j] -= fy;
          }
        }
      } else if (ownerI !== -1) {
        // ---- Same-owner, non-Fluid: boid accumulation (within boid range) --
        // ownerI === -1 means both are unowned Fluid particles; skip boid.
        if (dist < BOID_RANGE_WORLD) {
          accumulateBoidPair(
            i, j,
            positionXWorld, positionYWorld,
            velocityXWorld, velocityYWorld,
            forceX, forceY,
            dist, dx, dy,
            profileI.separation,
            BOID_RANGE_WORLD,
          );
        }
      }
    }

    // ---- Holy healing aura -----------------------------------------------
    // Orbit-mode Holy particles slowly restore durability to nearby wounded
    // allies, reusing the neighbor query already computed above.
    if (kindBuffer[i] === ParticleKind.Holy && behaviorMode[i] === 0 && ownerI !== -1) {
      applyHolyHealingAura(
        i, neighborCount, sharedSpatialGrid.queryResult,
        kindBuffer, isAliveFlag, ownerEntityId,
        isTransientFlag, particleDurability,
        ownerI,
      );
    }
  }

  // ---- Apply accumulated boid forces ----------------------------------
  applyBoidForces(
    particleCount, isAliveFlag, kindBuffer,
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
  );

  // ---- Apply deferred contact resolution (elemental durability model) ----
  _shatterCount = 0;
  _lavaTrailCount = 0;
  resetEffectCounters();
  _crystalShardCount = 0;
  _poisonCloudCount = 0;
  _chainLightningCount = 0;

  for (let k = 0; k < scratchDestroyCount; k++) {
    const ai = scratchDestroyA[k];
    const bi = scratchDestroyB[k];
    if (isAliveFlag[ai] === 0 || isAliveFlag[bi] === 0) continue;
    // Grapple chain particles (behaviorMode=3) are not part of combat — skip.
    if (behaviorMode[ai] === 3 || behaviorMode[bi] === 3) continue;

    const kindA = kindBuffer[ai];
    const kindB = kindBuffer[bi];
    const profileA = getElementProfile(kindA);
    const profileB = getElementProfile(kindB);

    const multAvsB = getElementalMultiplier(kindA, kindB);
    const multBvsA = getElementalMultiplier(kindB, kindA);

    // ── Metal block-mode reflection ──────────────────────────────────────────
    // When a Metal particle is in block mode (behaviorMode=2), incoming attacks
    // deal greatly reduced damage to the metal and are reflected back to the
    // attacker at double power.
    let dmgAtoB = profileA.attackPower * multAvsB;
    let dmgBtoA = profileB.attackPower * multBvsA;

    if (kindB === ParticleKind.Metal && behaviorMode[bi] === 2) {
      // B is blocking metal — reflect A's damage back, metal takes minimal hit
      dmgBtoA = dmgBtoA * 2.0;  // reflected damage to A
      dmgAtoB = dmgAtoB * 0.15; // only 15% gets through metal's block
    } else if (kindA === ParticleKind.Metal && behaviorMode[ai] === 2) {
      // A is blocking metal
      dmgAtoB = dmgAtoB * 2.0;
      dmgBtoA = dmgBtoA * 0.15;
    }

    // Each particle deals damage to the other
    particleDurability[bi] -= dmgAtoB;
    particleDurability[ai] -= dmgBtoA;

    // ── Record kill events for B dying ───────────────────────────────────────
    if (particleDurability[bi] <= 0) {
      isAliveFlag[bi] = 0;
      respawnDelayTicks[bi] = profileB.regenerationRateTicks;

      // Stone shatter
      if (kindB === ParticleKind.Stone && isTransientFlag[bi] === 0 && _shatterCount < _shatterPosX.length) {
        _shatterPosX[_shatterCount] = positionXWorld[bi];
        _shatterPosY[_shatterCount] = positionYWorld[bi];
        _shatterVelX[_shatterCount] = velocityXWorld[bi];
        _shatterVelY[_shatterCount] = velocityYWorld[bi];
        _shatterOwner[_shatterCount] = ownerEntityId[bi];
        _shatterCount++;
      }
      // Lava fire trail
      if (kindB === ParticleKind.Lava && isTransientFlag[bi] === 0 && _lavaTrailCount < _lavaTrailPosX.length) {
        _lavaTrailPosX[_lavaTrailCount] = positionXWorld[bi];
        _lavaTrailPosY[_lavaTrailCount] = positionYWorld[bi];
        _lavaTrailOwner[_lavaTrailCount] = ownerEntityId[bi];
        _lavaTrailCount++;
      }
      // Crystal shatter — burst into 3 shards
      if (kindB === ParticleKind.Crystal && isTransientFlag[bi] === 0 && _crystalShardCount < _crystalShardPosX.length) {
        _crystalShardPosX[_crystalShardCount] = positionXWorld[bi];
        _crystalShardPosY[_crystalShardCount] = positionYWorld[bi];
        _crystalShardVelX[_crystalShardCount] = velocityXWorld[bi];
        _crystalShardVelY[_crystalShardCount] = velocityYWorld[bi];
        _crystalShardOwner[_crystalShardCount] = ownerEntityId[bi];
        _crystalShardCount++;
      }
      // Poison cloud — dying poison particle leaves a lingering cloud
      if (kindB === ParticleKind.Poison && isTransientFlag[bi] === 0 && _poisonCloudCount < _poisonCloudPosX.length) {
        _poisonCloudPosX[_poisonCloudCount] = positionXWorld[bi];
        _poisonCloudPosY[_poisonCloudCount] = positionYWorld[bi];
        _poisonCloudOwner[_poisonCloudCount] = ownerEntityId[bi];
        _poisonCloudCount++;
      }
      // Ice chill — ice kill area-slows nearby enemies
      if (kindA === ParticleKind.Ice) {
        recordIceChillEvent(positionXWorld[bi], positionYWorld[bi], ownerEntityId[ai]);
      }
      // Shadow lifesteal — shadow killer heals its most-wounded particle
      if (kindA === ParticleKind.Shadow && isTransientFlag[ai] === 0) {
        recordShadowKillEvent(ownerEntityId[ai]);
      }
      // Wind scatter — wind kill knocks back nearby enemies
      if (kindA === ParticleKind.Wind && isTransientFlag[ai] === 0) {
        recordWindScatterEvent(positionXWorld[bi], positionYWorld[bi], ownerEntityId[ai]);
      }
      // Lightning chain arc — only from non-transient lightning kills
      if (kindA === ParticleKind.Lightning && isTransientFlag[ai] === 0 && _chainLightningCount < _chainLightningPosX.length) {
        _chainLightningPosX[_chainLightningCount] = positionXWorld[bi];
        _chainLightningPosY[_chainLightningCount] = positionYWorld[bi];
        _chainLightningKillerOwner[_chainLightningCount] = ownerEntityId[ai];
        _chainLightningVictimOwner[_chainLightningCount] = ownerEntityId[bi];
        _chainLightningCount++;
      }
    }

    // ── Record kill events for A dying ───────────────────────────────────────
    if (particleDurability[ai] <= 0) {
      isAliveFlag[ai] = 0;
      respawnDelayTicks[ai] = profileA.regenerationRateTicks;

      // Stone shatter
      if (kindA === ParticleKind.Stone && isTransientFlag[ai] === 0 && _shatterCount < _shatterPosX.length) {
        _shatterPosX[_shatterCount] = positionXWorld[ai];
        _shatterPosY[_shatterCount] = positionYWorld[ai];
        _shatterVelX[_shatterCount] = velocityXWorld[ai];
        _shatterVelY[_shatterCount] = velocityYWorld[ai];
        _shatterOwner[_shatterCount] = ownerEntityId[ai];
        _shatterCount++;
      }
      // Lava fire trail
      if (kindA === ParticleKind.Lava && isTransientFlag[ai] === 0 && _lavaTrailCount < _lavaTrailPosX.length) {
        _lavaTrailPosX[_lavaTrailCount] = positionXWorld[ai];
        _lavaTrailPosY[_lavaTrailCount] = positionYWorld[ai];
        _lavaTrailOwner[_lavaTrailCount] = ownerEntityId[ai];
        _lavaTrailCount++;
      }
      // Crystal shatter — burst into 3 shards
      if (kindA === ParticleKind.Crystal && isTransientFlag[ai] === 0 && _crystalShardCount < _crystalShardPosX.length) {
        _crystalShardPosX[_crystalShardCount] = positionXWorld[ai];
        _crystalShardPosY[_crystalShardCount] = positionYWorld[ai];
        _crystalShardVelX[_crystalShardCount] = velocityXWorld[ai];
        _crystalShardVelY[_crystalShardCount] = velocityYWorld[ai];
        _crystalShardOwner[_crystalShardCount] = ownerEntityId[ai];
        _crystalShardCount++;
      }
      // Poison cloud — dying poison particle leaves a lingering cloud
      if (kindA === ParticleKind.Poison && isTransientFlag[ai] === 0 && _poisonCloudCount < _poisonCloudPosX.length) {
        _poisonCloudPosX[_poisonCloudCount] = positionXWorld[ai];
        _poisonCloudPosY[_poisonCloudCount] = positionYWorld[ai];
        _poisonCloudOwner[_poisonCloudCount] = ownerEntityId[ai];
        _poisonCloudCount++;
      }
      // Ice chill — ice kill area-slows nearby enemies
      if (kindB === ParticleKind.Ice) {
        recordIceChillEvent(positionXWorld[ai], positionYWorld[ai], ownerEntityId[bi]);
      }
      // Shadow lifesteal — shadow killer heals its most-wounded particle
      if (kindB === ParticleKind.Shadow && isTransientFlag[bi] === 0) {
        recordShadowKillEvent(ownerEntityId[bi]);
      }
      // Wind scatter — wind kill knocks back nearby enemies
      if (kindB === ParticleKind.Wind && isTransientFlag[bi] === 0) {
        recordWindScatterEvent(positionXWorld[ai], positionYWorld[ai], ownerEntityId[bi]);
      }
      // Lightning chain arc — only from non-transient lightning kills
      if (kindB === ParticleKind.Lightning && isTransientFlag[bi] === 0 && _chainLightningCount < _chainLightningPosX.length) {
        _chainLightningPosX[_chainLightningCount] = positionXWorld[ai];
        _chainLightningPosY[_chainLightningCount] = positionYWorld[ai];
        _chainLightningKillerOwner[_chainLightningCount] = ownerEntityId[bi];
        _chainLightningVictimOwner[_chainLightningCount] = ownerEntityId[ai];
        _chainLightningCount++;
      }
    }
    // NOTE: Cluster HP damage is now only dealt via core contact (see below).
  }

  // ── Spawn stone shards from recorded shatter events ──────────────────────
  for (let s = 0; s < _shatterCount; s++) {
    _spawnStoneShards(world, _shatterPosX[s], _shatterPosY[s], _shatterVelX[s], _shatterVelY[s], _shatterOwner[s]);
  }

  // ── Spawn lava trail fire from recorded kill events ───────────────────────
  for (let l = 0; l < _lavaTrailCount; l++) {
    _spawnLavaTrailFire(world, _lavaTrailPosX[l], _lavaTrailPosY[l], _lavaTrailOwner[l]);
  }

  // ── Spawn crystal shards from crystal kill events ─────────────────────────
  for (let c = 0; c < _crystalShardCount; c++) {
    _spawnCrystalShards(
      world,
      _crystalShardPosX[c], _crystalShardPosY[c],
      _crystalShardVelX[c], _crystalShardVelY[c],
      _crystalShardOwner[c],
    );
  }

  // ── Spawn poison clouds from poison particle deaths ───────────────────────
  for (let p = 0; p < _poisonCloudCount; p++) {
    _spawnPoisonCloud(world, _poisonCloudPosX[p], _poisonCloudPosY[p], _poisonCloudOwner[p]);
  }

  // ── Spawn chain lightning arcs from lightning kill events ─────────────────
  for (let cl = 0; cl < _chainLightningCount; cl++) {
    _spawnChainLightning(
      world,
      _chainLightningPosX[cl], _chainLightningPosY[cl],
      _chainLightningKillerOwner[cl], _chainLightningVictimOwner[cl],
    );
  }

  // ── Ice chill — area-slow enemy particles near ice kill location ──────────
  applyIceChillEffects(world);

  // ── Shadow lifesteal — heal most-wounded player particle after shadow kill ─
  applyShadowLifestealEffects(world);

  // ── Wind scatter — knockback burst to nearby enemies after wind kill ───────
  applyWindScatterEffects(world);
  // A particle that enters an enemy cluster's core radius deals attackPower
  // damage to that cluster and is consumed.
  // Special case: Enemy-to-player damage is random 1-4 minus armor (dust containers).
  const CORE_RADIUS_WORLD = 14.0;
  const ENEMY_MIN_DAMAGE = 1;
  const ENEMY_MAX_DAMAGE = 4;
  const DUST_PARTICLES_PER_ARMOR = 4;

  // Pre-compute cluster lookups to avoid O(n²) within particle loop
  const ownerIsPlayerMap = new Map<number, boolean>();
  for (let ci = 0; ci < clusters.length; ci++) {
    ownerIsPlayerMap.set(clusters[ci].entityId, clusters[ci].isPlayerFlag === 1);
  }

  // Pre-compute player's dust count for armor calculation (only once per tick)
  let playerDustCount = 0;
  const playerCluster = clusters[0];
  if (playerCluster !== undefined && playerCluster.isPlayerFlag === 1) {
    for (let pi = 0; pi < particleCount; pi++) {
      if (ownerEntityId[pi] === playerCluster.entityId && isAliveFlag[pi] === 1 && isTransientFlag[pi] === 0) {
        playerDustCount++;
      }
    }
  }
  const playerArmor = Math.floor(playerDustCount / DUST_PARTICLES_PER_ARMOR);

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    const ownerI = ownerEntityId[i];
    if (ownerI === -1) continue; // unowned (Fluid)

    // Fast lookup for attacker's player status
    const attackerIsPlayer = ownerIsPlayerMap.get(ownerI) ?? false;

    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      if (cluster.entityId === ownerI) continue;  // own cluster
      if (cluster.isAliveFlag === 0) continue;

      const dxc = positionXWorld[i] - cluster.positionXWorld;
      const dyc = positionYWorld[i] - cluster.positionYWorld;
      if (dxc * dxc + dyc * dyc < CORE_RADIUS_WORLD * CORE_RADIUS_WORLD) {
        const profile = getElementProfile(kindBuffer[i]);
        if (cluster.healthPoints > 0) {
          let damage: number;

          if (!attackerIsPlayer && cluster.isPlayerFlag === 1) {
            // Enemy-to-player damage: random 1-4 minus armor
            const rngValue = nextFloat(world.rng);
            const baseDamage = ENEMY_MIN_DAMAGE + Math.floor(rngValue * (ENEMY_MAX_DAMAGE - ENEMY_MIN_DAMAGE + 1));
            // Clamp to ensure baseDamage is within bounds (guards against rngValue edge cases)
            const clampedBaseDamage = Math.min(baseDamage, ENEMY_MAX_DAMAGE);

            damage = Math.max(0, clampedBaseDamage - playerArmor);
          } else {
            // Player-to-enemy or enemy-to-enemy: use standard attackPower
            damage = profile.attackPower;
          }

          cluster.healthPoints -= damage;
          if (cluster.healthPoints <= 0) {
            cluster.healthPoints = 0;
            cluster.isAliveFlag = 0;
          }
          // Rolling enemies become aggressive when hit — chase player even
          // if outside normal sight range for a short duration.
          if (cluster.isRollingEnemyFlag === 1) {
            cluster.rollingEnemyAggressiveTicks = 180; // ~3 seconds at 60 fps
          }
        }
        // Consume the attacking particle
        isAliveFlag[i] = 0;
        respawnDelayTicks[i] = profile.regenerationRateTicks;
        break;
      }
    }
  }
}
