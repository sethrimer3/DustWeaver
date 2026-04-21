/**
 * Bubble Enemy AI — water and ice floating bubble variants.
 *
 * Water bubble:
 *   • Ring of Water particles orbiting the cluster center at BUBBLE_ORBIT_RADIUS_WORLD.
 *   • Drifts slowly in 2D via a slow Lissajous-curve velocity target.
 *   • Repelled by nearby walls and other bubble clusters.
 *   • Regenerates lost Water particles one by one every WATER_BUBBLE_REGEN_INTERVAL_TICKS.
 *   • Pops when HP < 75% of max: orbit particles get outward velocity and become
 *     transient heat-seeking + gravity-affected projectiles; shrink/disappear on settling.
 *
 * Ice bubble:
 *   • Ring of Ice particles orbiting at the same radius.
 *   • Pops immediately when any damage is taken (HP decreases by even 1).
 *   • Each popped ice particle spawns 2 spike clones staggered outward, forming a
 *     3-particle spike. No gravity on ice particles.
 *
 * Pipeline integration:
 *   applyBubbleAI()        step 0.5j — before force clear:
 *                          anchor-angle refresh, drift velocity, regen, pop detection.
 *   applyBubblePopForces() step 1.5  — after force clear:
 *                          gravity + heat-seeking for popped water particles; settle check.
 */

import { WorldState, MAX_PARTICLES } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';

// ── Tuning ────────────────────────────────────────────────────────────────────

const BUBBLE_ORBIT_RADIUS_WORLD = 18.0;
const BUBBLE_ORBIT_SPEED_RAD_PER_TICK = 0.022;

const WATER_BUBBLE_POP_HP_RATIO = 0.75;

const WATER_POP_SPEED_WORLD = 120.0;
const ICE_POP_SPEED_WORLD = 190.0;

const WATER_POP_PARTICLE_LIFETIME_TICKS = 260.0;
const ICE_SPIKE_0_LIFETIME_TICKS = 200.0;
const ICE_SPIKE_1_LIFETIME_TICKS = 175.0;
const ICE_SPIKE_2_LIFETIME_TICKS = 150.0;
const ICE_SPIKE_SPACING_WORLD = 9.0;

const WATER_POP_GRAVITY_WORLD_PER_SEC2 = 380.0;
const WATER_POP_HEATSEEKING_WORLD_PER_SEC2 = 85.0;
const WATER_POP_MIN_FLIGHT_TICKS = 55.0;
const WATER_POP_SETTLE_SPEED_WORLD = 20.0;

/** Ticks between water-bubble particle regenerations. Also used by gameScreen at spawn. */
export const WATER_BUBBLE_REGEN_INTERVAL_TICKS = 110;

const BUBBLE_DRIFT_SPEED_WORLD = 27.0;
const BUBBLE_DRIFT_PHASE_SPEED = 0.006;

const BUBBLE_WALL_REPEL_DIST_WORLD = 30.0;
const BUBBLE_WALL_REPEL_VEL_WORLD = 40.0;

const BUBBLE_INTER_REPEL_DIST_WORLD = 55.0;
const BUBBLE_INTER_REPEL_VEL_WORLD = 35.0;

/** Half-size (world units) of the bubble cluster collision/render box. */
export const BUBBLE_HALF_SIZE_WORLD = BUBBLE_ORBIT_RADIUS_WORLD + 4.0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _findFreeSlot(world: WorldState): number {
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0 && world.respawnDelayTicks[i] <= 0 && world.isTransientFlag[i] === 1) {
      return i;
    }
  }
  if (world.particleCount < MAX_PARTICLES) {
    return world.particleCount++;
  }
  return -1;
}

function _spawnBubbleRingParticle(
  world: WorldState,
  clusterEntityId: number,
  cx: number,
  cy: number,
  kind: ParticleKind,
  slotAngleRad: number,
): void {
  const profile = getElementProfile(kind);
  const idx = _findFreeSlot(world);
  if (idx === -1) return;

  world.positionXWorld[idx]     = cx + Math.cos(slotAngleRad) * BUBBLE_ORBIT_RADIUS_WORLD;
  world.positionYWorld[idx]     = cy + Math.sin(slotAngleRad) * BUBBLE_ORBIT_RADIUS_WORLD;
  world.velocityXWorld[idx]     = 0.0;
  world.velocityYWorld[idx]     = 0.0;
  world.forceX[idx]             = 0.0;
  world.forceY[idx]             = 0.0;
  world.massKg[idx]             = profile.massKg;
  world.chargeUnits[idx]        = 0.0;
  world.isAliveFlag[idx]        = 1;
  world.kindBuffer[idx]         = kind;
  world.ownerEntityId[idx]      = clusterEntityId;
  world.anchorAngleRad[idx]     = slotAngleRad;
  world.anchorRadiusWorld[idx]  = BUBBLE_ORBIT_RADIUS_WORLD;
  world.noiseTickSeed[idx]      = 0;
  world.lifetimeTicks[idx]      = profile.lifetimeBaseTicks;
  world.ageTicks[idx]           = 0.0;
  world.behaviorMode[idx]       = 0;
  world.particleDurability[idx] = profile.toughness;
  world.respawnDelayTicks[idx]  = 0.0;
  world.attackModeTicksLeft[idx] = 0.0;
  world.isTransientFlag[idx]    = 0;
  world.disturbanceFactor[idx]  = 0.0;
  world.weaveSlotId[idx]        = 0;
}

function _spawnIceSpike(
  world: WorldState,
  ownerEntityId: number,
  px: number, py: number,
  vx: number, vy: number,
  lifetimeTicks: number,
): void {
  const profile = getElementProfile(ParticleKind.Ice);
  const idx = _findFreeSlot(world);
  if (idx === -1) return;

  world.positionXWorld[idx]     = px;
  world.positionYWorld[idx]     = py;
  world.velocityXWorld[idx]     = vx;
  world.velocityYWorld[idx]     = vy;
  world.forceX[idx]             = 0.0;
  world.forceY[idx]             = 0.0;
  world.massKg[idx]             = profile.massKg;
  world.chargeUnits[idx]        = 0.0;
  world.isAliveFlag[idx]        = 1;
  world.kindBuffer[idx]         = ParticleKind.Ice;
  world.ownerEntityId[idx]      = ownerEntityId;
  world.anchorAngleRad[idx]     = 0.0;
  world.anchorRadiusWorld[idx]  = 0.0;
  world.noiseTickSeed[idx]      = 0;
  world.lifetimeTicks[idx]      = lifetimeTicks;
  world.ageTicks[idx]           = 0.0;
  world.behaviorMode[idx]       = 1;
  world.attackModeTicksLeft[idx] = lifetimeTicks + 10.0;
  world.particleDurability[idx] = profile.toughness;
  world.respawnDelayTicks[idx]  = 0.0;
  world.isTransientFlag[idx]    = 1;
  world.disturbanceFactor[idx]  = 0.0;
  world.weaveSlotId[idx]        = 0;
}

// ── Pop ───────────────────────────────────────────────────────────────────────

function _popWaterBubble(world: WorldState, clusterIndex: number): void {
  const cluster = world.clusters[clusterIndex];
  const cx = cluster.positionXWorld;
  const cy = cluster.positionYWorld;
  const entityId = cluster.entityId;

  cluster.bubbleState  = 1;
  cluster.healthPoints = 0;

  const { isAliveFlag, ownerEntityId, isTransientFlag,
          positionXWorld, positionYWorld, velocityXWorld, velocityYWorld,
          behaviorMode, attackModeTicksLeft, lifetimeTicks, ageTicks, particleCount } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (ownerEntityId[i] !== entityId) continue;
    if (isTransientFlag[i] === 1) continue;

    const dx = positionXWorld[i] - cx;
    const dy = positionYWorld[i] - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const invDist = dist > 0.5 ? 1.0 / dist : 1.0;

    velocityXWorld[i] = dx * invDist * WATER_POP_SPEED_WORLD;
    velocityYWorld[i] = dy * invDist * WATER_POP_SPEED_WORLD;

    behaviorMode[i]        = 1;
    attackModeTicksLeft[i] = WATER_POP_PARTICLE_LIFETIME_TICKS + 10.0;
    isTransientFlag[i]     = 1;
    lifetimeTicks[i]       = WATER_POP_PARTICLE_LIFETIME_TICKS;
    ageTicks[i]            = 0.0;
  }
}

function _popIceBubble(world: WorldState, clusterIndex: number): void {
  const cluster = world.clusters[clusterIndex];
  const cx = cluster.positionXWorld;
  const cy = cluster.positionYWorld;
  const entityId = cluster.entityId;

  cluster.bubbleState  = 1;
  cluster.healthPoints = 0;

  const { isAliveFlag, ownerEntityId, isTransientFlag,
          positionXWorld, positionYWorld, velocityXWorld, velocityYWorld,
          behaviorMode, attackModeTicksLeft, lifetimeTicks, ageTicks, particleCount } = world;

  // Collect orbit particle indices before spawning spikes (spikes may extend particleCount)
  const orbitIndices: number[] = [];
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1 && ownerEntityId[i] === entityId && isTransientFlag[i] === 0) {
      orbitIndices.push(i);
    }
  }

  for (let oi = 0; oi < orbitIndices.length; oi++) {
    const i = orbitIndices[oi];

    const dx = positionXWorld[i] - cx;
    const dy = positionYWorld[i] - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const invDist = dist > 0.5 ? 1.0 / dist : 1.0;
    const dirX = dx * invDist;
    const dirY = dy * invDist;

    const vx = dirX * ICE_POP_SPEED_WORLD;
    const vy = dirY * ICE_POP_SPEED_WORLD;

    velocityXWorld[i] = vx;
    velocityYWorld[i] = vy;
    behaviorMode[i]        = 1;
    attackModeTicksLeft[i] = ICE_SPIKE_0_LIFETIME_TICKS + 10.0;
    isTransientFlag[i]     = 1;
    lifetimeTicks[i]       = ICE_SPIKE_0_LIFETIME_TICKS;
    ageTicks[i]            = 0.0;

    _spawnIceSpike(world, entityId,
      positionXWorld[i] + dirX * ICE_SPIKE_SPACING_WORLD,
      positionYWorld[i] + dirY * ICE_SPIKE_SPACING_WORLD,
      vx, vy, ICE_SPIKE_1_LIFETIME_TICKS);

    _spawnIceSpike(world, entityId,
      positionXWorld[i] + dirX * ICE_SPIKE_SPACING_WORLD * 2.0,
      positionYWorld[i] + dirY * ICE_SPIKE_SPACING_WORLD * 2.0,
      vx, vy, ICE_SPIKE_2_LIFETIME_TICKS);
  }
}

// ── Main AI step (step 0.5j) ─────────────────────────────────────────────────

export function applyBubbleAI(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;
  const {
    clusters,
    isAliveFlag, ownerEntityId, isTransientFlag,
    anchorAngleRad, anchorRadiusWorld,
    behaviorMode,
    wallXWorld, wallYWorld, wallWWorld, wallHWorld, wallCount,
    particleCount,
  } = world;

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    if (cluster.isBubbleEnemyFlag === 0) continue;
    if (cluster.isAliveFlag === 0) continue;

    const cx      = cluster.positionXWorld;
    const cy      = cluster.positionYWorld;
    const entityId = cluster.entityId;
    const isIce   = cluster.isIceBubbleFlag === 1;

    // ── Popped state: wait for all particles to expire, then mark dead ────────
    if (cluster.bubbleState === 1) {
      let hasAny = false;
      for (let i = 0; i < particleCount; i++) {
        if (isAliveFlag[i] === 1 && ownerEntityId[i] === entityId) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny) cluster.isAliveFlag = 0;
      cluster.bubblePrevHealthPoints = cluster.healthPoints;
      continue;
    }

    // ── State 0: alive ────────────────────────────────────────────────────────

    cluster.bubbleOrbitAngleRad += BUBBLE_ORBIT_SPEED_RAD_PER_TICK;

    // Count alive orbit particles and assign evenly-spaced ring slots
    let orbitCount = 0;
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 1 && ownerEntityId[i] === entityId
          && isTransientFlag[i] === 0 && behaviorMode[i] === 0) {
        orbitCount++;
      }
    }
    if (orbitCount > 0) {
      let slot = 0;
      for (let i = 0; i < particleCount; i++) {
        if (isAliveFlag[i] === 0) continue;
        if (ownerEntityId[i] !== entityId) continue;
        if (isTransientFlag[i] === 1) continue;
        if (behaviorMode[i] !== 0) continue;
        anchorAngleRad[i]    = cluster.bubbleOrbitAngleRad + (slot / orbitCount) * Math.PI * 2.0;
        anchorRadiusWorld[i] = BUBBLE_ORBIT_RADIUS_WORLD;
        slot++;
      }
    }

    // ── Pop detection ─────────────────────────────────────────────────────────
    if (!isIce) {
      if (cluster.healthPoints < cluster.maxHealthPoints * WATER_BUBBLE_POP_HP_RATIO) {
        _popWaterBubble(world, ci);
        continue;
      }
    } else {
      if (cluster.healthPoints < cluster.bubblePrevHealthPoints) {
        _popIceBubble(world, ci);
        continue;
      }
    }
    cluster.bubblePrevHealthPoints = cluster.healthPoints;

    // ── Water regen ───────────────────────────────────────────────────────────
    if (!isIce) {
      if (orbitCount < cluster.bubbleMaxParticleCount) {
        cluster.bubbleRegenTicks -= 1;
        if (cluster.bubbleRegenTicks <= 0) {
          cluster.bubbleRegenTicks = WATER_BUBBLE_REGEN_INTERVAL_TICKS;
          const newAngle = cluster.bubbleOrbitAngleRad
            + (orbitCount / cluster.bubbleMaxParticleCount) * Math.PI * 2.0;
          _spawnBubbleRingParticle(world, entityId, cx, cy, ParticleKind.Water, newAngle);
        }
      } else {
        cluster.bubbleRegenTicks = WATER_BUBBLE_REGEN_INTERVAL_TICKS;
      }
    }

    // ── Drift (Lissajous) ─────────────────────────────────────────────────────
    cluster.bubbleDriftPhaseRad += BUBBLE_DRIFT_PHASE_SPEED;
    const targetVX = Math.cos(cluster.bubbleDriftPhaseRad) * BUBBLE_DRIFT_SPEED_WORLD;
    const targetVY = Math.sin(cluster.bubbleDriftPhaseRad * 0.71 + 1.3) * BUBBLE_DRIFT_SPEED_WORLD * 0.65;
    cluster.velocityXWorld += (targetVX - cluster.velocityXWorld) * 0.04;
    cluster.velocityYWorld += (targetVY - cluster.velocityYWorld) * 0.04;

    // ── Wall repulsion ────────────────────────────────────────────────────────
    for (let wi = 0; wi < wallCount; wi++) {
      const wx = wallXWorld[wi];
      const wy = wallYWorld[wi];
      const ww = wallWWorld[wi];
      const wh = wallHWorld[wi];

      const dLeft = cx - wx;
      if (dLeft >= 0 && dLeft < BUBBLE_WALL_REPEL_DIST_WORLD
          && cy >= wy - BUBBLE_HALF_SIZE_WORLD && cy <= wy + wh + BUBBLE_HALF_SIZE_WORLD) {
        cluster.velocityXWorld -= BUBBLE_WALL_REPEL_VEL_WORLD * (1.0 - dLeft / BUBBLE_WALL_REPEL_DIST_WORLD) * dtSec;
      }
      const dRight = wx + ww - cx;
      if (dRight >= 0 && dRight < BUBBLE_WALL_REPEL_DIST_WORLD
          && cy >= wy - BUBBLE_HALF_SIZE_WORLD && cy <= wy + wh + BUBBLE_HALF_SIZE_WORLD) {
        cluster.velocityXWorld += BUBBLE_WALL_REPEL_VEL_WORLD * (1.0 - dRight / BUBBLE_WALL_REPEL_DIST_WORLD) * dtSec;
      }
      const dTop = cy - wy;
      if (dTop >= 0 && dTop < BUBBLE_WALL_REPEL_DIST_WORLD
          && cx >= wx - BUBBLE_HALF_SIZE_WORLD && cx <= wx + ww + BUBBLE_HALF_SIZE_WORLD) {
        cluster.velocityYWorld -= BUBBLE_WALL_REPEL_VEL_WORLD * (1.0 - dTop / BUBBLE_WALL_REPEL_DIST_WORLD) * dtSec;
      }
      const dBottom = wy + wh - cy;
      if (dBottom >= 0 && dBottom < BUBBLE_WALL_REPEL_DIST_WORLD
          && cx >= wx - BUBBLE_HALF_SIZE_WORLD && cx <= wx + ww + BUBBLE_HALF_SIZE_WORLD) {
        cluster.velocityYWorld += BUBBLE_WALL_REPEL_VEL_WORLD * (1.0 - dBottom / BUBBLE_WALL_REPEL_DIST_WORLD) * dtSec;
      }
    }

    // ── Inter-bubble repulsion ────────────────────────────────────────────────
    for (let cj = 0; cj < clusters.length; cj++) {
      if (cj === ci) continue;
      const other = clusters[cj];
      if (other.isBubbleEnemyFlag === 0 || other.isAliveFlag === 0) continue;
      const dxB = cx - other.positionXWorld;
      const dyB = cy - other.positionYWorld;
      const dSq = dxB * dxB + dyB * dyB;
      if (dSq > 0.01 && dSq < BUBBLE_INTER_REPEL_DIST_WORLD * BUBBLE_INTER_REPEL_DIST_WORLD) {
        const d = Math.sqrt(dSq);
        const t = 1.0 - d / BUBBLE_INTER_REPEL_DIST_WORLD;
        cluster.velocityXWorld += (dxB / d) * BUBBLE_INTER_REPEL_VEL_WORLD * t * dtSec;
        cluster.velocityYWorld += (dyB / d) * BUBBLE_INTER_REPEL_VEL_WORLD * t * dtSec;
      }
    }
  }
}

// ── Pop forces step (step 1.5) ────────────────────────────────────────────────

/**
 * Applies gravity and heat-seeking forces to popped water bubble particles.
 * Also triggers ground-settle expiry for water particles that have nearly stopped.
 * Called after step 1 (force clear) so forces survive to integration.
 */
export function applyBubblePopForces(world: WorldState): void {
  const {
    clusters,
    isAliveFlag, ownerEntityId, isTransientFlag, kindBuffer,
    positionXWorld, positionYWorld,
    velocityYWorld,
    forceX, forceY,
    massKg, ageTicks, lifetimeTicks,
    particleCount,
  } = world;

  // Locate player position once
  let playerXWorld = 0.0;
  let playerYWorld = 0.0;
  let playerFound  = false;
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerYWorld = c.positionYWorld;
      playerFound  = true;
      break;
    }
  }

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (isTransientFlag[i] === 0) continue;
    if (kindBuffer[i] !== ParticleKind.Water) continue;

    // Owned by a popped water bubble?
    const ownerId = ownerEntityId[i];
    let isPoppedWater = false;
    for (let ci = 0; ci < clusters.length; ci++) {
      const c = clusters[ci];
      if (c.entityId === ownerId
          && c.isBubbleEnemyFlag === 1
          && c.isIceBubbleFlag === 0
          && c.bubbleState === 1) {
        isPoppedWater = true;
        break;
      }
    }
    if (!isPoppedWater) continue;

    const mass = massKg[i];

    // Gravity
    forceY[i] += WATER_POP_GRAVITY_WORLD_PER_SEC2 * mass;

    // Heat-seeking toward player
    if (playerFound) {
      const dx = playerXWorld - positionXWorld[i];
      const dy = playerYWorld - positionYWorld[i];
      const dSq = dx * dx + dy * dy;
      if (dSq > 1.0) {
        const invD = 1.0 / Math.sqrt(dSq);
        forceX[i] += dx * invD * WATER_POP_HEATSEEKING_WORLD_PER_SEC2 * mass;
        forceY[i] += dy * invD * WATER_POP_HEATSEEKING_WORLD_PER_SEC2 * mass;
      }
    }

    // Settle: expire the particle when it has been in flight long enough and
    // its vertical speed is low (has bounced on the floor and nearly stopped).
    if (ageTicks[i] > WATER_POP_MIN_FLIGHT_TICKS) {
      const absVY = velocityYWorld[i] < 0 ? -velocityYWorld[i] : velocityYWorld[i];
      if (absVY < WATER_POP_SETTLE_SPEED_WORLD) {
        lifetimeTicks[i] = ageTicks[i]; // force expiry this tick
      }
    }
  }
}
