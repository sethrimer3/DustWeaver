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
 */

import { WorldState } from '../world';
import { createSpatialGrid, clearGrid, insertParticle, queryNeighbors } from '../spatial/grid';
import type { SpatialGrid } from '../spatial/grid';
import { getElementProfile } from './elementProfiles';
import { getElementalMultiplier } from './negation';
import { ParticleKind } from './kinds';

export const PARTICLE_RADIUS_WORLD = 4.0;

// ---- Spatial grid --------------------------------------------------------

const REPEL_RANGE_WORLD  = 20.0;
const CONTACT_DIST_WORLD = PARTICLE_RADIUS_WORLD * 2.0;

// Boid neighbor range — larger than repulsion so cohesion/alignment can act
// across a wider neighbourhood without requiring a second grid pass.
const BOID_RANGE_WORLD = 36.0;

// Single grid covers the larger of the two query radii.
const GRID_CELL_SIZE = BOID_RANGE_WORLD * 2.0;

// Module-level singleton — allocated once, never per-frame.
const sharedSpatialGrid: SpatialGrid = createSpatialGrid(GRID_CELL_SIZE);

// Pre-allocated scratch for pending destruction (avoids mutation mid-loop)
const scratchDestroyA = new Int32Array(1024);
const scratchDestroyB = new Int32Array(1024);
let scratchDestroyCount = 0;

// ---- Boid accumulator scratch -------------------------------------------
// Per-particle accumulators for same-owner neighbour sums.
// Re-used each tick; indexed by particleIndex — pre-allocated once.
import { MAX_PARTICLES } from './state';

const _cohesionX   = new Float32Array(MAX_PARTICLES);
const _cohesionY   = new Float32Array(MAX_PARTICLES);
const _alignX      = new Float32Array(MAX_PARTICLES);
const _alignY      = new Float32Array(MAX_PARTICLES);
const _neighborCount = new Uint16Array(MAX_PARTICLES);

// ---- Main export --------------------------------------------------------

export function applyInterParticleForces(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    isAliveFlag, ownerEntityId, kindBuffer,
    particleCount, clusters,
    particleDurability, respawnDelayTicks,
  } = world;

  // ---- Rebuild spatial grid -------------------------------------------
  clearGrid(sharedSpatialGrid);
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1) {
      insertParticle(sharedSpatialGrid, i, positionXWorld[i], positionYWorld[i]);
    }
  }

  // ---- Reset boid accumulators (trivial fill) -------------------------
  _cohesionX.fill(0, 0, particleCount);
  _cohesionY.fill(0, 0, particleCount);
  _alignX.fill(0, 0, particleCount);
  _alignY.fill(0, 0, particleCount);
  _neighborCount.fill(0, 0, particleCount);

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
          const force = 50.0 * (1.0 - dist / REPEL_RANGE_WORLD) / dist;
          const fx = -dx * force;
          const fy = -dy * force;
          forceX[i] += fx;
          forceY[i] += fy;
          forceX[j] -= fx;
          forceY[j] -= fy;
        }
      } else if (ownerI !== -1) {
        // ---- Same-owner, non-Fluid: boid accumulation (within boid range) --
        // ownerI === -1 means both are unowned Fluid particles; skip boid.
        if (dist < BOID_RANGE_WORLD) {
          _cohesionX[i] += positionXWorld[j];
          _cohesionY[i] += positionYWorld[j];
          _cohesionX[j] += px;
          _cohesionY[j] += py;
          _alignX[i]  += velocityXWorld[j];
          _alignY[i]  += velocityYWorld[j];
          _alignX[j]  += velocityXWorld[i];
          _alignY[j]  += velocityYWorld[i];
          _neighborCount[i]++;
          _neighborCount[j]++;

          // Separation: profile.separation weight; repel inside half range
          if (dist < BOID_RANGE_WORLD * 0.45) {
            const sep = profileI.separation * (1.0 - dist / (BOID_RANGE_WORLD * 0.45)) / dist;
            const sfx = -dx * sep * 30.0;
            const sfy = -dy * sep * 30.0;
            forceX[i] += sfx;
            forceY[i] += sfy;
            forceX[j] -= sfx;
            forceY[j] -= sfy;
          }
        }
      }
    }
  }

  // ---- Apply accumulated boid forces ----------------------------------
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    const nc = _neighborCount[i];
    if (nc === 0) continue;

    const profile = getElementProfile(kindBuffer[i]);
    const invNc = 1.0 / nc;

    // Cohesion: steer toward average neighbor position
    if (profile.cohesion > 0.0) {
      const avgX = _cohesionX[i] * invNc;
      const avgY = _cohesionY[i] * invNc;
      forceX[i] += (avgX - positionXWorld[i]) * profile.cohesion * 2.0;
      forceY[i] += (avgY - positionYWorld[i]) * profile.cohesion * 2.0;
    }

    // Alignment: match average neighbor velocity
    if (profile.alignment > 0.0) {
      const avgVx = _alignX[i] * invNc;
      const avgVy = _alignY[i] * invNc;
      forceX[i] += (avgVx - velocityXWorld[i]) * profile.alignment * 0.5;
      forceY[i] += (avgVy - velocityYWorld[i]) * profile.alignment * 0.5;
    }
  }

  // ---- Apply deferred contact resolution (elemental durability model) ----
  for (let k = 0; k < scratchDestroyCount; k++) {
    const ai = scratchDestroyA[k];
    const bi = scratchDestroyB[k];
    if (isAliveFlag[ai] === 0 || isAliveFlag[bi] === 0) continue;

    const kindA = kindBuffer[ai];
    const kindB = kindBuffer[bi];
    const profileA = getElementProfile(kindA);
    const profileB = getElementProfile(kindB);

    const multAvsB = getElementalMultiplier(kindA, kindB);
    const multBvsA = getElementalMultiplier(kindB, kindA);

    // Each particle deals damage to the other
    particleDurability[bi] -= profileA.attackPower * multAvsB;
    particleDurability[ai] -= profileB.attackPower * multBvsA;

    if (particleDurability[bi] <= 0) {
      isAliveFlag[bi] = 0;
      respawnDelayTicks[bi] = profileB.regenerationRateTicks;
    }
    if (particleDurability[ai] <= 0) {
      isAliveFlag[ai] = 0;
      respawnDelayTicks[ai] = profileA.regenerationRateTicks;
    }
    // NOTE: Cluster HP damage is now only dealt via core contact (see below).
  }

  // ---- Core-contact damage -----------------------------------------------
  // A particle that enters an enemy cluster's core radius deals attackPower
  // damage to that cluster and is consumed.
  const CORE_RADIUS_WORLD = 14.0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    const ownerI = ownerEntityId[i];
    if (ownerI === -1) continue; // unowned (Fluid)

    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      if (cluster.entityId === ownerI) continue;  // own cluster
      if (cluster.isAliveFlag === 0) continue;

      const dxc = positionXWorld[i] - cluster.positionXWorld;
      const dyc = positionYWorld[i] - cluster.positionYWorld;
      if (dxc * dxc + dyc * dyc < CORE_RADIUS_WORLD * CORE_RADIUS_WORLD) {
        const profile = getElementProfile(kindBuffer[i]);
        if (cluster.healthPoints > 0) {
          cluster.healthPoints -= profile.attackPower;
          if (cluster.healthPoints <= 0) {
            cluster.healthPoints = 0;
            cluster.isAliveFlag = 0;
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
